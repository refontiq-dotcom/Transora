import { NextFunction, Request, Response, Router } from "express";
import { body, param, query, validationResult } from "express-validator";
import { PoolClient } from "pg";
import { pool } from "../../db/pool";
import { authorize } from "../../middleware/auth";

const router = Router();
const controllerRoles = authorize(["administrateur", "controleur", "chauffeur"]);
const validate = (req: Request, res: Response, next: NextFunction) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ success: false, message: "Données invalides", errors: errors.array() });
  next();
};

router.get("/scan/:billetId", controllerRoles, [param("billetId").isUUID()], validate,
  async (req: Request, res: Response, next: NextFunction) => {
    if (!req.tenantId) return res.status(401).json({ success: false, message: "Tenant non identifié" });
    try {
      const result = await pool.query(
        `SELECT b.id AS "billetId", b.passenger_name AS "passager",
                b.seat_number AS "siege", b.status AS "statutReservation",
                d.origin AS "origine", d.destination AS "destination",
                d.departure_at AS "departLe", d.vehicle_code AS "vehicule",
                d.status AS "statutDepart", t.name AS "compagnie",
                COALESCE(p.status, 'NOT_INITIATED') AS "statutPaiement",
                be.boarded_at AS "embarqueLe",
                (b.status = 'PAID' AND p.status = 'CONFIRMED'
                  AND b.status <> 'CANCELLED' AND d.status <> 'CANCELLED'
                  AND d.status = 'BOARDING'
                  AND d.departure_at > NOW() - INTERVAL '2 hours'
                  AND be.id IS NULL) AS "peutEmbarquer"
         FROM bookings b
         JOIN departures d ON d.id = b.departure_id AND d.tenant_id = b.tenant_id
         JOIN tenants t ON t.id = b.tenant_id
         LEFT JOIN payments p ON p.booking_id = b.id AND p.tenant_id = b.tenant_id
         LEFT JOIN boarding_events be ON be.booking_id = b.id AND be.tenant_id = b.tenant_id
         WHERE (b.id = $1 OR b.ticket_token = $1) AND b.tenant_id = $2`,
        [req.params.billetId, req.tenantId]
      );
      if (!result.rowCount) return res.status(404).json({ success: false, message: "Billet introuvable dans cette compagnie" });
      const ticket = result.rows[0];
      const motif = ticket.embarqueLe ? "Ce billet a déjà été utilisé."
        : ticket.statutReservation !== "PAID" || ticket.statutPaiement !== "CONFIRMED" ? "Le règlement de ce billet n'est pas confirmé."
        : ticket.statutDepart === "CANCELLED" ? "Ce départ a été annulé."
        : ticket.statutDepart !== "BOARDING" ? "L’embarquement n’est pas encore ouvert."
        : new Date(ticket.departLe).getTime() <= Date.now() - 2 * 60 * 60 * 1000 ? "L'heure de départ est dépassée."
        : null;
      return res.json({ success: true, data: { ...ticket, motif } });
    } catch (error) { return next(error); }
  }
);

router.post("/valider", controllerRoles, [
  body("billetId").isUUID(),
  body("scannerId").optional().isString().trim().isLength({ max: 120 }),
  body("commentaires").optional().isString().trim().isLength({ max: 500 })
], validate, async (req: Request, res: Response, next: NextFunction) => {
  if (!req.tenantId || !req.user) return res.status(401).json({ success: false, message: "Session entreprise manquante" });
  const client: PoolClient = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await client.query(
      `SELECT b.id, b.status AS booking_status, d.id AS departure_id,
              d.status AS departure_status, d.departure_at,
              p.status AS payment_status
       FROM bookings b
       JOIN departures d ON d.id = b.departure_id AND d.tenant_id = b.tenant_id
       LEFT JOIN payments p ON p.booking_id = b.id AND p.tenant_id = b.tenant_id
       WHERE (b.id = $1 OR b.ticket_token = $1) AND b.tenant_id = $2
       FOR UPDATE OF b, d`,
      [req.body.billetId, req.tenantId]
    );
    if (!result.rowCount) { await client.query("ROLLBACK"); return res.status(404).json({ success: false, message: "Billet introuvable dans cette compagnie" }); }
    const ticket = result.rows[0];
    if (ticket.booking_status !== "PAID" || ticket.payment_status !== "CONFIRMED") {
      await client.query("ROLLBACK");
      return res.status(409).json({ success: false, message: "Embarquement refusé : paiement non confirmé" });
    }
    if (ticket.departure_status !== "BOARDING") {
      await client.query("ROLLBACK");
      return res.status(409).json({ success: false, message: "Embarquement non ouvert pour ce départ" });
    }
    if (new Date(ticket.departure_at).getTime() <= Date.now() - 2 * 60 * 60 * 1000) {
      await client.query("ROLLBACK");
      return res.status(409).json({ success: false, message: "L'heure de départ est dépassée" });
    }
    const inserted = await client.query(
      `INSERT INTO boarding_events (tenant_id, booking_id, departure_id, boarded_by, scanner_id, comments)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (booking_id) DO NOTHING
       RETURNING id, boarded_at AS "embarqueLe", scanner_id AS "scannerId"`,
      [req.tenantId, ticket.id, ticket.departure_id, req.user.id, req.body.scannerId || null, req.body.commentaires || null]
    );
    if (!inserted.rowCount) {
      await client.query("ROLLBACK");
      return res.status(409).json({ success: false, message: "Ce billet a déjà été utilisé pour l'embarquement" });
    }
    await client.query("COMMIT");
    return res.json({ success: true, data: { billetId: ticket.id, ...inserted.rows[0], statut: "BOARDED" }, message: "Embarquement validé" });
  } catch (error) {
    await client.query("ROLLBACK");
    return next(error);
  } finally { client.release(); }
});

router.get("/stats", controllerRoles, [
  query("startDate").optional().isISO8601(),
  query("endDate").optional().isISO8601(),
  query("departureId").optional().isUUID()
], validate, async (req: Request, res: Response, next: NextFunction) => {
  if (!req.tenantId) return res.status(401).json({ success: false, message: "Tenant non identifié" });
  try {
    const startDate = typeof req.query.startDate === "string" ? req.query.startDate : null;
    const endDate = typeof req.query.endDate === "string" ? req.query.endDate : null;
    const departureId = typeof req.query.departureId === "string" ? req.query.departureId : null;
    const summary = await pool.query(
      `SELECT COUNT(*)::int AS "totalEmbarquements",
              COUNT(DISTINCT departure_id)::int AS "departuresCount"
       FROM boarding_events
       WHERE tenant_id = $1
         AND ($2::date IS NULL OR boarded_at >= $2::date)
         AND ($3::date IS NULL OR boarded_at < $3::date + INTERVAL '1 day')
         AND ($4::uuid IS NULL OR departure_id = $4)`,
      [req.tenantId, startDate, endDate, departureId]
    );
    const byDeparture = await pool.query(
      `SELECT d.id AS "departureId", d.origin, d.destination,
              COUNT(be.id)::int AS "totalEmbarquements"
       FROM boarding_events be
       JOIN departures d ON d.id = be.departure_id AND d.tenant_id = be.tenant_id
       WHERE be.tenant_id = $1
         AND ($2::date IS NULL OR be.boarded_at >= $2::date)
         AND ($3::date IS NULL OR be.boarded_at < $3::date + INTERVAL '1 day')
         AND ($4::uuid IS NULL OR be.departure_id = $4)
       GROUP BY d.id ORDER BY COUNT(be.id) DESC LIMIT 20`,
      [req.tenantId, startDate, endDate, departureId]
    );
    return res.json({ success: true, data: {
      periode: { debut: startDate, fin: endDate },
      resume: { ...summary.rows[0] },
      parDepart: byDeparture.rows
    } });
  } catch (error) { return next(error); }
});

export default router;
