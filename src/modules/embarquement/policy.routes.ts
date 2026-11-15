import { NextFunction, Request, Response, Router } from "express";
import { body, param, query, validationResult } from "express-validator";
import { PoolClient } from "pg";
import { pool } from "../../db/pool";
import { authorize } from "../../middleware/auth";

const router = Router();
const policyEditors = authorize(["administrateur", "responsable_exploitation"]);
const controllerRoles = authorize(["administrateur", "responsable_exploitation", "controleur", "chauffeur"]);

const validate = (req: Request, res: Response, next: NextFunction) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ success: false, message: "Données invalides", errors: errors.array() });
  next();
};

const policySelect = `SELECT version,
  boarding_open_minutes_before AS "boardingOpenMinutesBefore",
  boarding_deadline_minutes_before AS "boardingDeadlineMinutesBefore",
  grace_period_minutes AS "gracePeriodMinutes",
  allow_rebooking_after_no_show AS "allowRebookingAfterNoShow",
  max_rebookings AS "maxRebookings",
  rebooking_fee_amount AS "rebookingFeeAmount",
  refund_policy AS "refundPolicy",
  refund_percentage AS "refundPercentage",
  auto_find_next_departure AS "autoFindNextDeparture",
  updated_at AS "updatedAt"
  FROM company_boarding_policies WHERE tenant_id = $1`;

router.get("/policy", policyEditors, async (req: Request, res: Response, next: NextFunction) => {
  if (!req.tenantId) return res.status(401).json({ success: false, message: "Tenant non identifié" });
  try {
    await pool.query("INSERT INTO company_boarding_policies (tenant_id) VALUES ($1) ON CONFLICT (tenant_id) DO NOTHING", [req.tenantId]);
    const result = await pool.query(policySelect, [req.tenantId]);
    return res.json({ success: true, data: result.rows[0] });
  } catch (error) { return next(error); }
});

router.put("/policy", policyEditors, [
  body("boardingOpenMinutesBefore").optional().isInt({ min: 0, max: 360 }),
  body("boardingDeadlineMinutesBefore").optional().isInt({ min: 0, max: 60 }),
  body("gracePeriodMinutes").optional().isInt({ min: 0, max: 180 }),
  body("allowRebookingAfterNoShow").optional().isBoolean(),
  body("maxRebookings").optional().isInt({ min: 0, max: 5 }),
  body("rebookingFeeAmount").optional().isInt({ min: 0, max: 1000000 }),
  body("refundPolicy").optional().isIn(["NONE", "FULL", "PARTIAL"]),
  body("refundPercentage").optional().isInt({ min: 0, max: 100 }),
  body("autoFindNextDeparture").optional().isBoolean()
], validate, async (req: Request, res: Response, next: NextFunction) => {
  if (!req.tenantId || !req.user) return res.status(401).json({ success: false, message: "Session entreprise manquante" });
  const client: PoolClient = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("INSERT INTO company_boarding_policies (tenant_id) VALUES ($1) ON CONFLICT (tenant_id) DO NOTHING", [req.tenantId]);
    const current = await client.query(
      "SELECT * FROM company_boarding_policies WHERE tenant_id = $1 FOR UPDATE", [req.tenantId]
    );
    const value = (key: string, fallback: unknown) => req.body[key] === undefined ? fallback : req.body[key];
    const nextPolicy = {
      boardingOpenMinutesBefore: Number(value("boardingOpenMinutesBefore", current.rows[0].boarding_open_minutes_before)),
      boardingDeadlineMinutesBefore: Number(value("boardingDeadlineMinutesBefore", current.rows[0].boarding_deadline_minutes_before)),
      gracePeriodMinutes: Number(value("gracePeriodMinutes", current.rows[0].grace_period_minutes)),
      allowRebookingAfterNoShow: value("allowRebookingAfterNoShow", current.rows[0].allow_rebooking_after_no_show) === true,
      maxRebookings: Number(value("maxRebookings", current.rows[0].max_rebookings)),
      rebookingFeeAmount: Number(value("rebookingFeeAmount", current.rows[0].rebooking_fee_amount)),
      refundPolicy: String(value("refundPolicy", current.rows[0].refund_policy)),
      refundPercentage: Number(value("refundPercentage", current.rows[0].refund_percentage)),
      autoFindNextDeparture: value("autoFindNextDeparture", current.rows[0].auto_find_next_departure) === true
    };
    if (nextPolicy.allowRebookingAfterNoShow ? nextPolicy.maxRebookings < 1 : nextPolicy.maxRebookings !== 0) {
      await client.query("ROLLBACK");
      return res.status(400).json({ success: false, message: "Le nombre de reports doit être supérieur à zéro si le report après absence est autorisé, et égal à zéro sinon." });
    }
    if ((nextPolicy.refundPolicy === "NONE" && nextPolicy.refundPercentage !== 0) ||
        (nextPolicy.refundPolicy === "FULL" && nextPolicy.refundPercentage !== 100) ||
        (nextPolicy.refundPolicy === "PARTIAL" && (nextPolicy.refundPercentage < 1 || nextPolicy.refundPercentage > 99))) {
      await client.query("ROLLBACK");
      return res.status(400).json({ success: false, message: "Le pourcentage de remboursement ne correspond pas à la règle choisie." });
    }
    await client.query(
      `UPDATE company_boarding_policies SET
        version = version + 1,
        boarding_open_minutes_before = $2,
        boarding_deadline_minutes_before = $3,
        grace_period_minutes = $4,
        allow_rebooking_after_no_show = $5,
        max_rebookings = $6,
        rebooking_fee_amount = $7,
        refund_policy = $8,
        refund_percentage = $9,
        auto_find_next_departure = $10,
        updated_by = $11,
        updated_at = NOW()
       WHERE tenant_id = $1`,
      [req.tenantId, nextPolicy.boardingOpenMinutesBefore, nextPolicy.boardingDeadlineMinutesBefore,
        nextPolicy.gracePeriodMinutes, nextPolicy.allowRebookingAfterNoShow, nextPolicy.maxRebookings,
        nextPolicy.rebookingFeeAmount, nextPolicy.refundPolicy, nextPolicy.refundPercentage,
        nextPolicy.autoFindNextDeparture, req.user.id]
    );
    const updated = await client.query(policySelect, [req.tenantId]);
    await client.query(
      `INSERT INTO audit_events (tenant_id, actor_user_id, type, subject, action, details)
       VALUES ($1, $2, 'modification', 'politique embarquement', 'Mise à jour de la politique compagnie', $3::jsonb)`,
      [req.tenantId, req.user.id, JSON.stringify(updated.rows[0])]
    );
    await client.query("COMMIT");
    return res.json({ success: true, data: updated.rows[0], message: "Politique mise à jour. Les réservations déjà créées conservent leur ancienne version." });
  } catch (error) {
    await client.query("ROLLBACK");
    return next(error);
  } finally { client.release(); }
});

// À un arrêt intermédiaire, le délai de grâce commence à l'arrivée réelle du car, jamais à l'heure théorique.
router.post("/arrival", controllerRoles, [
  body("departureId").isUUID(),
  body("stopId").isUUID(),
  body("comments").optional().isString().trim().isLength({ max: 500 })
], validate, async (req: Request, res: Response, next: NextFunction) => {
  if (!req.tenantId || !req.user) return res.status(401).json({ success: false, message: "Session entreprise manquante" });
  const client: PoolClient = await pool.connect();
  try {
    await client.query("BEGIN");
    const departure = await client.query(
      `SELECT d.id, d.status, rs.id AS stop_id, rs.stop_order
       FROM departures d
       JOIN route_stops rs ON rs.route_id = d.route_id AND rs.tenant_id = d.tenant_id
       WHERE d.id = $1 AND d.tenant_id = $2 AND rs.id = $3
       FOR UPDATE OF d`,
      [req.body.departureId, req.tenantId, req.body.stopId]
    );
    if (!departure.rowCount) {
      await client.query("ROLLBACK");
      return res.status(404).json({ success: false, message: "Départ ou arrêt introuvable dans cette compagnie." });
    }
    if (Number(departure.rows[0].stop_order) === 0 || !["DEPARTED", "IN_TRANSIT"].includes(departure.rows[0].status)) {
      await client.query("ROLLBACK");
      return res.status(409).json({ success: false, message: "L'arrivée réelle ne peut être enregistrée que pour un arrêt intermédiaire après le départ du car." });
    }
    const inserted = await client.query(
      `INSERT INTO stop_arrival_events (tenant_id, departure_id, stop_id, arrived_by, comments)
       VALUES ($1,$2,$3,$4,$5)
       ON CONFLICT (departure_id, stop_id) DO NOTHING
       RETURNING id, arrived_at AS "arrivedAt"`,
      [req.tenantId, req.body.departureId, req.body.stopId, req.user.id, req.body.comments || null]
    );
    if (!inserted.rowCount) {
      await client.query("ROLLBACK");
      return res.status(409).json({ success: false, message: "L'arrivée à cet arrêt a déjà été enregistrée." });
    }
    await client.query(
      `INSERT INTO audit_events (tenant_id, actor_user_id, type, subject, action, details)
       VALUES ($1,$2,'création','arrêt','Arrivée réelle du car confirmée',$3::jsonb)`,
      [req.tenantId, req.user.id, JSON.stringify({ departureId: req.body.departureId, stopId: req.body.stopId, arrivedAt: inserted.rows[0].arrivedAt })]
    );
    await client.query("COMMIT");
    return res.status(201).json({ success: true, data: inserted.rows[0], message: "Arrivée réelle enregistrée. Le délai de grâce des passagers à cet arrêt commence maintenant." });
  } catch (error) {
    await client.query("ROLLBACK");
    if ((error as { code?: string }).code === "23505") return res.status(409).json({ success: false, message: "L'arrivée à cet arrêt a déjà été enregistrée." });
    return next(error);
  } finally { client.release(); }
});

// Manifeste numérique : les billets payés non scannés restent « attendus », jamais automatiquement absents.
router.get("/manifest/:departureId", controllerRoles, [
  param("departureId").isUUID(),
  query("stopId").optional().isUUID()
], validate, async (req: Request, res: Response, next: NextFunction) => {
  if (!req.tenantId) return res.status(401).json({ success: false, message: "Tenant non identifié" });
  try {
    const stopId = typeof req.query.stopId === "string" ? req.query.stopId : null;
    const departure = await pool.query(
      `SELECT d.id, d.origin, d.destination, d.departure_at AS "departureAt",
              d.status, d.route_id AS "routeId", d.vehicle_code AS "vehicleCode",
              COALESCE(rs.duration_from_origin_minutes, 0) AS "stopDurationMinutes",
              sae.arrived_at AS "actualArrivalAt",
              rs.id AS "stopId", c.name AS "stopCity", s.name AS "stopStation"
       FROM departures d
       LEFT JOIN route_stops rs ON rs.id = $3 AND rs.route_id = d.route_id AND rs.tenant_id = d.tenant_id
       LEFT JOIN stop_arrival_events sae ON sae.departure_id = d.id AND sae.tenant_id = d.tenant_id AND sae.stop_id = rs.id
       LEFT JOIN stations s ON s.id = rs.station_id AND s.tenant_id = rs.tenant_id
       LEFT JOIN company_cities c ON c.id = s.city_id AND c.tenant_id = s.tenant_id
       WHERE d.id = $1 AND d.tenant_id = $2
         AND ($3::uuid IS NULL OR rs.id IS NOT NULL)`,
      [req.params.departureId, req.tenantId, stopId]
    );
    if (!departure.rowCount) return res.status(404).json({ success: false, message: "Départ ou arrêt introuvable dans cette compagnie" });
    const trip = departure.rows[0];
    const bookings = await pool.query(
      `SELECT b.id AS "bookingId", b.ticket_token AS "ticketToken",
              b.passenger_name AS "passengerName", b.passenger_phone AS "passengerPhone",
              b.seat_number AS "seatNumber", b.origin_stop_id AS "originStopId",
              b.destination_stop_id AS "destinationStopId", b.status AS "bookingStatus",
              b.boarding_status AS "boardingStatus", b.boarding_policy_version AS "policyVersion",
              be.boarded_at AS "boardedAt", ae.confirmed_at AS "absenceConfirmedAt",
              (p.status = 'CONFIRMED') AS "paymentConfirmed"
       FROM bookings b
       LEFT JOIN boarding_events be ON be.booking_id = b.id AND be.tenant_id = b.tenant_id
       LEFT JOIN boarding_absence_events ae ON ae.booking_id = b.id AND ae.tenant_id = b.tenant_id
       LEFT JOIN payments p ON p.booking_id = b.id AND p.tenant_id = b.tenant_id
       WHERE b.tenant_id = $1 AND b.departure_id = $2
         AND b.status IN ('PAID', 'NO_SHOW')
         AND ($3::uuid IS NULL OR b.origin_stop_id = $3)
       ORDER BY b.seat_number NULLS LAST, b.passenger_name`,
      [req.tenantId, req.params.departureId, stopId]
    );
    const rows = bookings.rows.map((booking: Record<string, unknown>) => ({
      ...booking,
      operationalStatus: booking.absenceConfirmedAt ? "ABSENT_CONFIRMED"
        : booking.boardedAt ? "PRESENT" : "EXPECTED"
    }));
    return res.json({ success: true, data: {
      departure: trip,
      manifest: rows,
      summary: {
        totalPaid: rows.filter((item: { paymentConfirmed: boolean }) => item.paymentConfirmed).length,
        present: rows.filter((item: { operationalStatus: string }) => item.operationalStatus === "PRESENT").length,
        expected: rows.filter((item: { operationalStatus: string }) => item.operationalStatus === "EXPECTED").length,
        confirmedAbsences: rows.filter((item: { operationalStatus: string }) => item.operationalStatus === "ABSENT_CONFIRMED").length
      }
    } });
  } catch (error) { return next(error); }
});

// Confirmation manuelle uniquement après l'heure prévue + délai de grâce de la politique figée sur le billet.
router.post("/absence", controllerRoles, [
  body("bookingId").isUUID(),
  body("stopId").optional().isUUID(),
  body("comments").optional().isString().trim().isLength({ max: 500 })
], validate, async (req: Request, res: Response, next: NextFunction) => {
  if (!req.tenantId || !req.user) return res.status(401).json({ success: false, message: "Session entreprise manquante" });
  const client: PoolClient = await pool.connect();
  try {
    await client.query("BEGIN");
    const stopId = typeof req.body.stopId === "string" ? req.body.stopId : null;
    const result = await client.query(
      `SELECT b.id, b.departure_id, b.status AS booking_status,
              b.boarding_policy_version, b.boarding_policy_snapshot,
              b.origin_stop_id, b.seat_number, d.departure_at, d.status AS departure_status,
              COALESCE(rs.duration_from_origin_minutes, 0) AS stop_duration_minutes,
              rs.stop_order,
              sae.arrived_at AS actual_arrival_at,
              p.status AS payment_status,
              EXISTS (SELECT 1 FROM boarding_events be WHERE be.booking_id = b.id AND be.tenant_id = b.tenant_id) AS boarded
       FROM bookings b
       JOIN departures d ON d.id = b.departure_id AND d.tenant_id = b.tenant_id
       LEFT JOIN route_stops rs ON rs.id = $3 AND rs.route_id = d.route_id AND rs.tenant_id = d.tenant_id
       LEFT JOIN stop_arrival_events sae ON sae.departure_id = d.id AND sae.tenant_id = d.tenant_id AND sae.stop_id = rs.id
       LEFT JOIN payments p ON p.booking_id = b.id AND p.tenant_id = b.tenant_id
       WHERE b.id = $1 AND b.tenant_id = $2
         AND ($3::uuid IS NULL OR rs.id IS NOT NULL)
       FOR UPDATE OF b, d`,
      [req.body.bookingId, req.tenantId, stopId]
    );
    if (!result.rowCount) {
      await client.query("ROLLBACK");
      return res.status(404).json({ success: false, message: "Billet ou arrêt introuvable dans cette compagnie" });
    }
    const booking = result.rows[0];
    if (booking.booking_status !== "PAID" || booking.payment_status !== "CONFIRMED") {
      await client.query("ROLLBACK");
      return res.status(409).json({ success: false, message: "Seul un billet payé et confirmé peut être déclaré absent." });
    }
    if (booking.boarded) {
      await client.query("ROLLBACK");
      return res.status(409).json({ success: false, message: "Ce passager a déjà été enregistré comme présent." });
    }
    if (booking.departure_status === "DELAYED" || booking.departure_status === "CANCELLED") {
      await client.query("ROLLBACK");
      return res.status(409).json({ success: false, message: "Départ retardé ou annulé : un problème imputable à la compagnie ne peut pas être traité comme une absence du voyageur." });
    }
    if (booking.origin_stop_id && booking.origin_stop_id !== stopId) {
      await client.query("ROLLBACK");
      return res.status(400).json({ success: false, message: "Sélectionnez l'arrêt de départ indiqué sur le billet." });
    }
    if (!booking.origin_stop_id && stopId) {
      await client.query("ROLLBACK");
      return res.status(400).json({ success: false, message: "Ce billet concerne un trajet sans arrêt intermédiaire." });
    }
    const snapshot = booking.boarding_policy_snapshot || {};
    const graceMinutes = Math.max(0, Math.min(180, Number(snapshot.gracePeriodMinutes ?? 15)));
    if (stopId && Number(booking.stop_order) > 0 && !booking.actual_arrival_at) {
      await client.query("ROLLBACK");
      return res.status(409).json({ success: false, message: "Le car doit d’abord être déclaré arrivé à cet arrêt. Le délai de grâce commencera à l’heure réelle d’arrivée." });
    }
    const scheduledAt = stopId && Number(booking.stop_order) > 0
      ? new Date(booking.actual_arrival_at)
      : new Date(new Date(booking.departure_at).getTime() + Number(booking.stop_duration_minutes || 0) * 60000);
    const eligibleAt = new Date(scheduledAt.getTime() + graceMinutes * 60000);
    if (Date.now() < eligibleAt.getTime()) {
      await client.query("ROLLBACK");
      return res.status(409).json({ success: false, message: `Absence non confirmable avant le ${eligibleAt.toLocaleString("fr-FR")}.` });
    }
    const inserted = await client.query(
      `INSERT INTO boarding_absence_events
        (tenant_id, booking_id, departure_id, stop_id, scheduled_at, grace_period_minutes, policy_version, confirmed_by, comments)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
       ON CONFLICT (booking_id) DO NOTHING
       RETURNING id, confirmed_at AS "confirmedAt"`,
      [req.tenantId, booking.id, booking.departure_id, stopId, scheduledAt, graceMinutes,
        Number(booking.boarding_policy_version || snapshot.version || 1), req.user.id, req.body.comments || null]
    );
    if (!inserted.rowCount) {
      await client.query("ROLLBACK");
      return res.status(409).json({ success: false, message: "L'absence de ce billet a déjà été confirmée." });
    }
    await client.query(
      "UPDATE bookings SET status = 'NO_SHOW', boarding_status = 'NO_SHOW' WHERE id = $1 AND tenant_id = $2",
      [booking.id, req.tenantId]
    );
    await client.query(
      `INSERT INTO audit_events (tenant_id, actor_user_id, type, subject, action, details)
       VALUES ($1,$2,'modification','billet','Absence passager confirmée',$3::jsonb)`,
      [req.tenantId, req.user.id, JSON.stringify({ bookingId: booking.id, departureId: booking.departure_id, stopId, graceMinutes, policyVersion: booking.boarding_policy_version })]
    );
    await client.query("COMMIT");
    return res.json({ success: true, data: { bookingId: booking.id, ...inserted.rows[0], status: "NO_SHOW", seatReleasedForSegment: true }, message: "Absence confirmée. Le siège est libéré uniquement sur le segment réservé." });
  } catch (error) {
    await client.query("ROLLBACK");
    if ((error as { code?: string }).code === "23505") return res.status(409).json({ success: false, message: "L'absence de ce billet a déjà été confirmée." });
    return next(error);
  } finally { client.release(); }
});

// Suggestions non engageantes : aucune réservation ni transfert de billet n'est effectué ici.
router.get("/alternatives/:bookingId", controllerRoles, [
  param("bookingId").isUUID()
], validate, async (req: Request, res: Response, next: NextFunction) => {
  if (!req.tenantId) return res.status(401).json({ success: false, message: "Tenant non identifié" });
  try {
    const bookingResult = await pool.query(
      `SELECT b.id, b.departure_id, b.origin_stop_id, b.destination_stop_id,
              b.segment_range, b.boarding_policy_snapshot, b.status,
              b.amount_transport, b.company_booking_fee, b.platform_fee,
              d.route_id, d.origin, d.destination, d.departure_at
       FROM bookings b JOIN departures d ON d.id = b.departure_id AND d.tenant_id = b.tenant_id
       WHERE b.id = $1 AND b.tenant_id = $2`,
      [req.params.bookingId, req.tenantId]
    );
    if (!bookingResult.rowCount) return res.status(404).json({ success: false, message: "Billet introuvable" });
    const booking = bookingResult.rows[0];
    const policy = booking.boarding_policy_snapshot || {};
    if (booking.status !== "NO_SHOW") return res.status(409).json({ success: false, message: "Une alternative n'est proposée qu'après confirmation de l'absence." });
    if (!policy.allowRebookingAfterNoShow || !policy.autoFindNextDeparture) {
      return res.json({ success: true, data: { alternatives: [], rebookingAllowed: false, message: "La politique acceptée pour ce billet ne prévoit pas de recherche automatique de report." } });
    }
    const result = await pool.query(
      `SELECT d.id AS "departureId", d.origin, d.destination,
              d.departure_at AS "departureAt", d.vehicle_code AS "vehicleCode",
              d.fare_amount AS "fareAmount", d.company_booking_fee AS "companyBookingFee",
              seat.seat_number AS "suggestedSeat"
       FROM departures d
       CROSS JOIN LATERAL (
         SELECT candidate.seat_number
         FROM generate_series(1, d.capacity) AS candidate(seat_number)
         WHERE NOT EXISTS (
           SELECT 1 FROM bookings occupied
           WHERE occupied.tenant_id = d.tenant_id
             AND occupied.departure_id = d.id
             AND occupied.seat_number = candidate.seat_number
             AND occupied.status NOT IN ('CANCELLED', 'EXPIRED', 'NO_SHOW')
             AND occupied.segment_range && $3::int4range
         )
         ORDER BY candidate.seat_number
         LIMIT 1
       ) seat
       WHERE d.tenant_id = $1 AND d.id <> $2
         AND d.status = 'SCHEDULED' AND d.departure_at > NOW()
         AND (($4::uuid IS NOT NULL AND d.route_id = $4)
           OR ($4::uuid IS NULL AND d.route_id IS NULL
             AND lower(d.origin) = lower($5) AND lower(d.destination) = lower($6)))
       ORDER BY d.departure_at ASC LIMIT 10`,
      [req.tenantId, booking.departure_id, booking.segment_range, booking.route_id, booking.origin, booking.destination]
    );
    return res.json({ success: true, data: {
      rebookingAllowed: true,
      maxRebookings: Number(policy.maxRebookings || 0),
      rebookingFeeAmount: Number(policy.rebookingFeeAmount || 0),
      refundPolicy: policy.refundPolicy || "NONE",
      refundPercentage: Number(policy.refundPercentage || 0),
      alternatives: result.rows
    } });
  } catch (error) { return next(error); }
});

export default router;
