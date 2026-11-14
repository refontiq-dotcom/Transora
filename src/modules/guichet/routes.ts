import { NextFunction, Request, Response, Router } from "express";
import { body, param, validationResult } from "express-validator";
import { PoolClient } from "pg";
import { pool } from "../../db/pool";
import { authorize } from "../../middleware/auth";

const router = Router();
const cashDeskRoles = authorize(["administrateur", "superviseur", "caissier", "agent_acceuil"]);
const validate = (req: Request, res: Response, next: NextFunction) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ success: false, message: "Données invalides", errors: errors.array() });
  next();
};

router.post("/session", cashDeskRoles, [body("openingAmount").isInt({ min: 0 })], validate,
  async (req: Request, res: Response, next: NextFunction) => {
    if (!req.tenantId || !req.user) return res.status(401).json({ success: false, message: "Session entreprise manquante" });
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const result = await client.query(
        `INSERT INTO guichet_sessions (tenant_id, opened_by, opening_amount)
         VALUES ($1, $2, $3)
         RETURNING id, opening_amount AS "openingAmount", currency, status, opened_at AS "openedAt"`,
        [req.tenantId, req.user.id, Number(req.body.openingAmount)]
      );
      const session = result.rows[0];
      await client.query(
        `INSERT INTO guichet_operations (tenant_id, session_id, type, amount, description, recorded_by)
         VALUES ($1, $2, 'OPENING', $3, 'Fond de caisse initial', $4)`,
        [req.tenantId, session.id, Number(req.body.openingAmount), req.user.id]
      );
      await client.query("COMMIT");
      return res.status(201).json({ success: true, data: session, message: "Session de caisse ouverte" });
    } catch (error) {
      await client.query("ROLLBACK");
      if ((error as { code?: string }).code === "23505") return res.status(409).json({ success: false, message: "Vous avez déjà une caisse ouverte" });
      return next(error);
    } finally { client.release(); }
  }
);

router.get("/session/current", cashDeskRoles, async (req: Request, res: Response, next: NextFunction) => {
  if (!req.tenantId || !req.user) return res.status(401).json({ success: false, message: "Session entreprise manquante" });
  try {
    const result = await pool.query(
      `SELECT s.id, s.opening_amount AS "openingAmount", s.currency, s.status, s.opened_at AS "openedAt",
              s.opening_amount + COALESCE(SUM(o.amount) FILTER (WHERE o.type = 'SALE'), 0)
                - COALESCE(SUM(o.amount) FILTER (WHERE o.type = 'REFUND'), 0) AS "expectedCash"
       FROM guichet_sessions s LEFT JOIN guichet_operations o ON o.session_id = s.id AND o.tenant_id = s.tenant_id
       WHERE s.tenant_id = $1 AND s.opened_by = $2 AND s.status = 'OPEN'
       GROUP BY s.id LIMIT 1`,
      [req.tenantId, req.user.id]
    );
    return res.json({ success: true, data: result.rows[0] || null });
  } catch (error) { return next(error); }
});

router.get("/session/:id", cashDeskRoles, [param("id").isUUID()], validate,
  async (req: Request, res: Response, next: NextFunction) => {
    if (!req.tenantId) return res.status(401).json({ success: false, message: "Tenant non identifié" });
    try {
      const session = await pool.query(
        `SELECT s.id, s.opening_amount AS "openingAmount", s.closing_amount AS "closingAmount",
                s.currency, s.status, s.opened_at AS "openedAt", s.closed_at AS "closedAt",
                s.opening_amount + COALESCE(SUM(o.amount) FILTER (WHERE o.type = 'SALE'), 0)
                  - COALESCE(SUM(o.amount) FILTER (WHERE o.type = 'REFUND'), 0) AS "expectedCash"
         FROM guichet_sessions s LEFT JOIN guichet_operations o ON o.session_id = s.id AND o.tenant_id = s.tenant_id
         WHERE s.id = $1 AND s.tenant_id = $2 GROUP BY s.id`,
        [req.params.id, req.tenantId]
      );
      if (!session.rowCount) return res.status(404).json({ success: false, message: "Session de caisse introuvable" });
      const operations = await pool.query(
        `SELECT id, booking_id AS "bookingId", type, amount, payment_method AS "paymentMethod",
                description, created_at AS "createdAt"
         FROM guichet_operations WHERE session_id = $1 AND tenant_id = $2 ORDER BY created_at, id`,
        [req.params.id, req.tenantId]
      );
      return res.json({ success: true, data: { ...session.rows[0], operations: operations.rows } });
    } catch (error) { return next(error); }
  }
);

router.post("/vente", cashDeskRoles, [
  body("departureId").isUUID(),
  body("passengerName").isString().trim().isLength({ min: 2, max: 160 }),
  body("seatNumber").optional().isInt({ min: 1 })
], validate, async (req: Request, res: Response, next: NextFunction) => {
  if (!req.tenantId || !req.user) return res.status(401).json({ success: false, message: "Session entreprise manquante" });
  const client: PoolClient = await pool.connect();
  try {
    await client.query("BEGIN");
    const session = await client.query(
      "SELECT id FROM guichet_sessions WHERE tenant_id = $1 AND opened_by = $2 AND status = 'OPEN' FOR UPDATE",
      [req.tenantId, req.user.id]
    );
    if (!session.rowCount) { await client.query("ROLLBACK"); return res.status(409).json({ success: false, message: "Ouvrez votre caisse avant de vendre un billet" }); }
    const departure = await client.query(
      `SELECT id, fare_amount, company_booking_fee, capacity, origin, destination, departure_at, vehicle_code
       FROM departures WHERE id = $1 AND tenant_id = $2 AND status = 'SCHEDULED' AND departure_at > NOW() FOR UPDATE`,
      [req.body.departureId, req.tenantId]
    );
    if (!departure.rowCount) { await client.query("ROLLBACK"); return res.status(404).json({ success: false, message: "Départ introuvable ou indisponible" }); }
    const trip = departure.rows[0];
    if (Number(trip.fare_amount) <= 0) { await client.query("ROLLBACK"); return res.status(409).json({ success: false, message: "Définissez le tarif de ce départ avant la vente" }); }
    const taken = await client.query(
      "SELECT seat_number FROM bookings WHERE departure_id = $1 AND tenant_id = $2 AND status <> 'CANCELLED'",
      [trip.id, req.tenantId]
    );
    if (Number(taken.rowCount ?? 0) >= Number(trip.capacity)) {
      await client.query("ROLLBACK");
      return res.status(409).json({ success: false, message: "Ce départ est complet" });
    }
    const occupied = new Set(taken.rows.map((row: { seat_number: number | null }) => Number(row.seat_number)).filter(Boolean));
    const requested = req.body.seatNumber === undefined ? null : Number(req.body.seatNumber);
    const seat = requested ?? Array.from({ length: Number(trip.capacity) }, (_, i) => i + 1).find(n => !occupied.has(n));
    if (!seat || seat > Number(trip.capacity) || occupied.has(seat)) {
      await client.query("ROLLBACK"); return res.status(409).json({ success: false, message: "Place indisponible" });
    }
    const inserted = await client.query(
      `INSERT INTO bookings (tenant_id, departure_id, passenger_name, amount_transport, company_booking_fee, status, seat_number)
       VALUES ($1, $2, $3, $4, $5, 'PAID', $6)
       RETURNING id, ticket_token AS "ticketToken", passenger_name AS "passengerName",
                 amount_transport AS "amountTransport", platform_fee AS "platformFee", company_booking_fee AS "companyBookingFee",
                 seat_number AS "seatNumber", created_at AS "createdAt"`,
      [req.tenantId, trip.id, String(req.body.passengerName).trim(), Number(trip.fare_amount), seat]
    );
    const booking = inserted.rows[0];
    const total = Number(booking.amountTransport) + Number(booking.companyBookingFee) + Number(booking.platformFee);
    await client.query(
      `INSERT INTO payments (tenant_id, booking_id, amount_transport, company_booking_fee, platform_fee, payment_method, status, confirmed_by, confirmed_at)
       VALUES ($1, $2, $3, $4, $5, 'cash', 'CONFIRMED', $6, NOW())`,
      [req.tenantId, booking.id, booking.amountTransport, booking.companyBookingFee, booking.platformFee, req.user.id]
    );
    await client.query(
      `INSERT INTO guichet_operations (tenant_id, session_id, booking_id, type, amount, payment_method, description, recorded_by)
       VALUES ($1, $2, $3, 'SALE', $4, 'cash', $5, $6)`,
      [req.tenantId, session.rows[0].id, booking.id, total, `Billet ${booking.id} · ${trip.origin} → ${trip.destination}`, req.user.id]
    );
    await client.query("COMMIT");
    return res.status(201).json({ success: true, data: {
      ...booking, departureId: trip.id, origin: trip.origin, destination: trip.destination,
      departureAt: trip.departure_at, vehicleCode: trip.vehicle_code, totalPaid: total,
      paymentStatus: "CONFIRMED", companyId: req.tenantId
    }, message: "Billet vendu et règlement en espèces enregistré" });
  } catch (error) {
    await client.query("ROLLBACK");
    if ((error as { code?: string }).code === "23505") return res.status(409).json({ success: false, message: "Cette place vient d'être attribuée" });
    return next(error);
  } finally { client.release(); }
});

router.post("/session/:id/close", cashDeskRoles, [
  param("id").isUUID(), body("closingAmount").isInt({ min: 0 })
], validate, async (req: Request, res: Response, next: NextFunction) => {
  if (!req.tenantId || !req.user) return res.status(401).json({ success: false, message: "Session entreprise manquante" });
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const session = await client.query(
      "SELECT id, opened_by, opening_amount FROM guichet_sessions WHERE id = $1 AND tenant_id = $2 AND status = 'OPEN' FOR UPDATE",
      [req.params.id, req.tenantId]
    );
    if (!session.rowCount) { await client.query("ROLLBACK"); return res.status(404).json({ success: false, message: "Session ouverte introuvable" }); }
    if (session.rows[0].opened_by !== req.user.id && req.user.role !== "administrateur") {
      await client.query("ROLLBACK"); return res.status(403).json({ success: false, message: "Clôture réservée au caissier responsable ou à un administrateur" });
    }
    const movement = await client.query(
      `SELECT COALESCE(SUM(amount) FILTER (WHERE type = 'SALE'), 0)
                - COALESCE(SUM(amount) FILTER (WHERE type = 'REFUND'), 0) AS amount
       FROM guichet_operations WHERE session_id = $1 AND tenant_id = $2`,
      [req.params.id, req.tenantId]
    );
    const expected = Number(session.rows[0].opening_amount) + Number(movement.rows[0].amount);
    const counted = Number(req.body.closingAmount);
    await client.query(
      "UPDATE guichet_sessions SET status = 'CLOSED', closing_amount = $3, closed_by = $4, closed_at = NOW() WHERE id = $1 AND tenant_id = $2",
      [req.params.id, req.tenantId, counted, req.user.id]
    );
    await client.query(
      `INSERT INTO guichet_operations (tenant_id, session_id, type, amount, description, recorded_by)
       VALUES ($1, $2, 'CLOSING', $3, $4, $5)`,
      [req.tenantId, req.params.id, counted, `Clôture · écart ${counted - expected} FCFA`, req.user.id]
    );
    await client.query("COMMIT");
    return res.json({ success: true, data: { sessionId: req.params.id, expectedCash: expected, closingAmount: counted, discrepancy: counted - expected, status: "CLOSED" }, message: "Caisse clôturée" });
  } catch (error) { await client.query("ROLLBACK"); return next(error); }
  finally { client.release(); }
});

export default router;
