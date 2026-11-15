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
                COALESCE(rs.stop_order, 0) AS "stopOrder",
                COALESCE(p.status, 'NOT_INITIATED') AS "statutPaiement",
                be.boarded_at AS "embarqueLe",
                (NOW() >= COALESCE(sae.arrived_at, d.departure_at + COALESCE(rs.duration_from_origin_minutes, 0) * INTERVAL '1 minute') - COALESCE((b.boarding_policy_snapshot->>'boardingOpenMinutesBefore')::int, 60) * INTERVAL '1 minute'
                 AND NOW() <= COALESCE(sae.arrived_at, d.departure_at + COALESCE(rs.duration_from_origin_minutes, 0) * INTERVAL '1 minute') + COALESCE((b.boarding_policy_snapshot->>'gracePeriodMinutes')::int, 15) * INTERVAL '1 minute') AS "boardingWindowOpen",
                EXISTS (
                  SELECT 1 FROM bookings previous
                  JOIN boarding_events previous_boarding ON previous_boarding.booking_id = previous.id AND previous_boarding.tenant_id = previous.tenant_id
                  LEFT JOIN alighting_events previous_alighting ON previous_alighting.booking_id = previous.id AND previous_alighting.tenant_id = previous.tenant_id
                  WHERE previous.tenant_id = b.tenant_id AND previous.departure_id = b.departure_id
                    AND previous.seat_number = b.seat_number
                    AND upper(previous.segment_range) <= lower(b.segment_range)
                    AND previous_alighting.id IS NULL
                ) AS "seatBlockedByPreviousPassenger",
                (b.status = 'PAID' AND p.status = 'CONFIRMED'
                  AND b.status <> 'CANCELLED' AND d.status <> 'CANCELLED'
                  AND ((COALESCE(rs.stop_order, 0) = 0 AND d.status = 'BOARDING')
                    OR (COALESCE(rs.stop_order, 0) > 0 AND d.status IN ('DEPARTED', 'IN_TRANSIT') AND sae.id IS NOT NULL))
                  AND NOW() >= COALESCE(sae.arrived_at, d.departure_at + COALESCE(rs.duration_from_origin_minutes, 0) * INTERVAL '1 minute') - COALESCE((b.boarding_policy_snapshot->>'boardingOpenMinutesBefore')::int, 60) * INTERVAL '1 minute'
                  AND NOW() <= COALESCE(sae.arrived_at, d.departure_at + COALESCE(rs.duration_from_origin_minutes, 0) * INTERVAL '1 minute') + COALESCE((b.boarding_policy_snapshot->>'gracePeriodMinutes')::int, 15) * INTERVAL '1 minute'
                  AND be.id IS NULL
                  AND NOT EXISTS (
                    SELECT 1 FROM bookings previous
                    JOIN boarding_events previous_boarding ON previous_boarding.booking_id = previous.id AND previous_boarding.tenant_id = previous.tenant_id
                    LEFT JOIN alighting_events previous_alighting ON previous_alighting.booking_id = previous.id AND previous_alighting.tenant_id = previous.tenant_id
                    WHERE previous.tenant_id = b.tenant_id AND previous.departure_id = b.departure_id
                      AND previous.seat_number = b.seat_number
                      AND upper(previous.segment_range) <= lower(b.segment_range)
                      AND previous_alighting.id IS NULL
                  )) AS "peutEmbarquer"
         FROM bookings b
         JOIN departures d ON d.id = b.departure_id AND d.tenant_id = b.tenant_id
         JOIN tenants t ON t.id = b.tenant_id
         LEFT JOIN payments p ON p.booking_id = b.id AND p.tenant_id = b.tenant_id
         LEFT JOIN boarding_events be ON be.booking_id = b.id AND be.tenant_id = b.tenant_id
         LEFT JOIN route_stops rs ON rs.id = b.origin_stop_id AND rs.tenant_id = b.tenant_id
         LEFT JOIN stop_arrival_events sae ON sae.departure_id = d.id AND sae.tenant_id = d.tenant_id AND sae.stop_id = rs.id
         WHERE (b.id = $1 OR b.ticket_token = $1) AND b.tenant_id = $2`,
        [req.params.billetId, req.tenantId]
      );
      if (!result.rowCount) return res.status(404).json({ success: false, message: "Billet introuvable dans cette compagnie" });
      const ticket = result.rows[0];
      const motif = ticket.embarqueLe ? "Ce billet a déjà été utilisé."
        : ticket.statutReservation !== "PAID" || ticket.statutPaiement !== "CONFIRMED" ? "Le règlement de ce billet n'est pas confirmé."
        : ticket.statutDepart === "CANCELLED" ? "Ce départ a été annulé."
        : ticket.seatBlockedByPreviousPassenger ? "Le passager précédent n’a pas encore été confirmé comme descendu de ce siège."
        : !ticket.boardingWindowOpen ? "La période d’embarquement définie par la compagnie n’est pas ouverte ou est terminée."
        : ticket.stopOrder === 0 && ticket.statutDepart !== "BOARDING" ? "L’embarquement à la gare de départ n’est pas ouvert."
        : ticket.stopOrder > 0 && !["DEPARTED", "IN_TRANSIT"].includes(ticket.statutDepart) ? "Le car n’est pas encore arrivé à cet arrêt ou n’a pas commencé son trajet."
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
              d.status AS departure_status, d.departure_at, b.seat_number,
              COALESCE(rs.stop_order, 0) AS stop_order,
              sae.arrived_at AS actual_arrival_at,
              b.boarding_policy_snapshot,
              (NOW() >= COALESCE(sae.arrived_at, d.departure_at + COALESCE(rs.duration_from_origin_minutes, 0) * INTERVAL '1 minute') - COALESCE((b.boarding_policy_snapshot->>'boardingOpenMinutesBefore')::int, 60) * INTERVAL '1 minute'
               AND NOW() <= COALESCE(sae.arrived_at, d.departure_at + COALESCE(rs.duration_from_origin_minutes, 0) * INTERVAL '1 minute') + COALESCE((b.boarding_policy_snapshot->>'gracePeriodMinutes')::int, 15) * INTERVAL '1 minute') AS boarding_window_open,
              EXISTS (
                SELECT 1 FROM bookings previous
                JOIN boarding_events previous_boarding ON previous_boarding.booking_id = previous.id AND previous_boarding.tenant_id = previous.tenant_id
                LEFT JOIN alighting_events previous_alighting ON previous_alighting.booking_id = previous.id AND previous_alighting.tenant_id = previous.tenant_id
                WHERE previous.tenant_id = b.tenant_id AND previous.departure_id = b.departure_id
                  AND previous.seat_number = b.seat_number
                  AND upper(previous.segment_range) <= lower(b.segment_range)
                  AND previous_alighting.id IS NULL
              ) AS seat_blocked,
              p.status AS payment_status
       FROM bookings b
       JOIN departures d ON d.id = b.departure_id AND d.tenant_id = b.tenant_id
       LEFT JOIN payments p ON p.booking_id = b.id AND p.tenant_id = b.tenant_id
       LEFT JOIN route_stops rs ON rs.id = b.origin_stop_id AND rs.tenant_id = b.tenant_id
       LEFT JOIN stop_arrival_events sae ON sae.departure_id = d.id AND sae.tenant_id = d.tenant_id AND sae.stop_id = rs.id
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
    if (ticket.seat_blocked) {
      await client.query("ROLLBACK");
      return res.status(409).json({ success: false, message: "Embarquement refusé : le passager précédent n’a pas encore été confirmé comme descendu de ce siège." });
    }
    const boardingStateAllowed = Number(ticket.stop_order) === 0
      ? ticket.departure_status === "BOARDING"
      : ["DEPARTED", "IN_TRANSIT"].includes(ticket.departure_status) && Boolean(ticket.actual_arrival_at);
    if (!boardingStateAllowed || !ticket.boarding_window_open) {
      await client.query("ROLLBACK");
      return res.status(409).json({ success: false, message: "La période d’embarquement de cet arrêt n’est pas ouverte ou est terminée. Vérifiez aussi que l’arrivée réelle du car a été enregistrée." });
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
