import { NextFunction, Request, Response, Router } from "express";
import { body, param, validationResult } from "express-validator";
import { PoolClient } from "pg";
import { pool } from "../../db/pool";
import { authorize } from "../../middleware/auth";

const router = Router();
const controllerRoles = authorize(["administrateur", "responsable_exploitation", "controleur", "chauffeur"]);
const validate = (req: Request, res: Response, next: NextFunction) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ success: false, message: "Données invalides", errors: errors.array() });
  next();
};

// Tableau opérationnel d'un arrêt : descentes prévues, montées réservées,
// et contrôle de la libération physique des sièges.
router.get("/:departureId/:stopId", controllerRoles, [
  param("departureId").isUUID(),
  param("stopId").isUUID()
], validate, async (req: Request, res: Response, next: NextFunction) => {
  if (!req.tenantId) return res.status(401).json({ success: false, message: "Tenant non identifié" });
  try {
    const stopResult = await pool.query(
      `SELECT d.id AS "departureId", d.origin, d.destination, d.departure_at AS "departureAt",
              d.vehicle_code AS "vehicleCode", d.capacity, d.status AS "departureStatus",
              rs.id AS "stopId", rs.stop_order AS "stopOrder",
              c.name AS "city", s.name AS "station"
       FROM departures d
       JOIN route_stops rs ON rs.route_id = d.route_id AND rs.tenant_id = d.tenant_id
       JOIN stations s ON s.id = rs.station_id AND s.tenant_id = rs.tenant_id
       JOIN company_cities c ON c.id = s.city_id AND c.tenant_id = s.tenant_id
       WHERE d.id = $1 AND d.tenant_id = $2 AND rs.id = $3`,
      [req.params.departureId, req.tenantId, req.params.stopId]
    );
    if (!stopResult.rowCount) return res.status(404).json({ success: false, message: "Arrêt ou départ introuvable dans cette compagnie" });
    const stop = stopResult.rows[0];

    const descents = await pool.query(
      `SELECT b.id AS "bookingId", b.passenger_name AS "passengerName",
              b.seat_number AS "seatNumber", b.ticket_token AS "ticketToken",
              be.boarded_at AS "boardedAt", ae.alighted_at AS "alightedAt",
              ae.id IS NOT NULL AS "isAlighted"
       FROM bookings b
       JOIN boarding_events be ON be.booking_id = b.id AND be.tenant_id = b.tenant_id
       LEFT JOIN alighting_events ae ON ae.booking_id = b.id AND ae.tenant_id = b.tenant_id
       WHERE b.tenant_id = $1 AND b.departure_id = $2 AND b.destination_stop_id = $3
         AND b.status = 'PAID'
       ORDER BY b.seat_number NULLS LAST, b.passenger_name`,
      [req.tenantId, req.params.departureId, req.params.stopId]
    );

    const boardings = await pool.query(
      `SELECT b.id AS "bookingId", b.passenger_name AS "passengerName",
              b.seat_number AS "seatNumber", b.ticket_token AS "ticketToken",
              be.boarded_at AS "boardedAt",
              EXISTS (
                SELECT 1
                FROM bookings previous
                JOIN boarding_events previous_boarding
                  ON previous_boarding.booking_id = previous.id AND previous_boarding.tenant_id = previous.tenant_id
                LEFT JOIN alighting_events previous_alighting
                  ON previous_alighting.booking_id = previous.id AND previous_alighting.tenant_id = previous.tenant_id
                WHERE previous.tenant_id = b.tenant_id
                  AND previous.departure_id = b.departure_id
                  AND previous.seat_number = b.seat_number
                  AND upper(previous.segment_range) <= lower(b.segment_range)
                  AND previous_alighting.id IS NULL
              ) AS "seatBlockedByPreviousPassenger"
       FROM bookings b
       LEFT JOIN boarding_events be ON be.booking_id = b.id AND be.tenant_id = b.tenant_id
       WHERE b.tenant_id = $1 AND b.departure_id = $2 AND b.origin_stop_id = $3
         AND b.status = 'PAID'
         AND EXISTS (SELECT 1 FROM payments p WHERE p.booking_id = b.id AND p.tenant_id = b.tenant_id AND p.status = 'CONFIRMED')
       ORDER BY b.seat_number NULLS LAST, b.passenger_name`,
      [req.tenantId, req.params.departureId, req.params.stopId]
    );

    const availableSeats = await pool.query(
      `SELECT b.seat_number
       FROM bookings b
       JOIN boarding_events be ON be.booking_id = b.id AND be.tenant_id = b.tenant_id
       LEFT JOIN alighting_events ae ON ae.booking_id = b.id AND ae.tenant_id = b.tenant_id
       WHERE b.tenant_id = $1 AND b.departure_id = $2
         AND b.seat_number IS NOT NULL AND b.status = 'PAID'
         AND ae.stop_id = $3
       ORDER BY b.seat_number`,
      [req.tenantId, req.params.departureId, req.params.stopId]
    );

    return res.json({ success: true, data: {
      departure: {
        id: stop.departureId, origin: stop.origin, destination: stop.destination,
        departureAt: stop.departureAt, vehicleCode: stop.vehicleCode,
        capacity: Number(stop.capacity), status: stop.departureStatus
      },
      stop: { id: stop.stopId, city: stop.city, station: stop.station, order: Number(stop.stopOrder) },
      descents: descents.rows,
      boardings: boardings.rows,
      summary: {
        expectedDescents: descents.rows.length,
        confirmedDescents: descents.rows.filter((item: { isAlighted: boolean }) => item.isAlighted).length,
        expectedBoardings: boardings.rows.length,
        checkedBoardings: boardings.rows.filter((item: { boardedAt: string | null }) => Boolean(item.boardedAt)).length,
        seatsConfirmedReleased: [...new Set(availableSeats.rows.map((item: { seat_number: number }) => Number(item.seat_number)))].length,
        seatsBlockedByPreviousPassenger: boardings.rows.filter((item: { seatBlockedByPreviousPassenger: boolean }) => item.seatBlockedByPreviousPassenger).length
      }
    } });
  } catch (error) { return next(error); }
});

// Une descente n'est enregistrée qu'au terminus prévu sur le billet.
// Une place ne devient donc pas physiquement libre sur simple prévision.
router.post("/descendre", controllerRoles, [
  body("billetId").isUUID(),
  body("stopId").isUUID(),
  body("commentaires").optional().isString().trim().isLength({ max: 500 })
], validate, async (req: Request, res: Response, next: NextFunction) => {
  if (!req.tenantId || !req.user) return res.status(401).json({ success: false, message: "Session entreprise manquante" });
  const client: PoolClient = await pool.connect();
  try {
    await client.query("BEGIN");
    const booking = await client.query(
      `SELECT b.id, b.departure_id, b.destination_stop_id, b.status,
              EXISTS (SELECT 1 FROM boarding_events be WHERE be.booking_id = b.id AND be.tenant_id = b.tenant_id) AS boarded
       FROM bookings b
       JOIN departures d ON d.id = b.departure_id AND d.tenant_id = b.tenant_id
       JOIN route_stops rs ON rs.id = $3 AND rs.route_id = d.route_id AND rs.tenant_id = d.tenant_id
       WHERE b.id = $1 AND b.tenant_id = $2
       FOR UPDATE OF b, d`,
      [req.body.billetId, req.tenantId, req.body.stopId]
    );
    if (!booking.rowCount) {
      await client.query("ROLLBACK");
      return res.status(404).json({ success: false, message: "Billet ou arrêt introuvable dans cette compagnie" });
    }
    const ticket = booking.rows[0];
    if (ticket.status !== "PAID" || !ticket.boarded) {
      await client.query("ROLLBACK");
      return res.status(409).json({ success: false, message: "La descente ne peut être confirmée que pour un passager payé et déjà embarqué" });
    }
    if (ticket.destination_stop_id !== req.body.stopId) {
      await client.query("ROLLBACK");
      return res.status(409).json({ success: false, message: "Cet arrêt ne correspond pas à la destination enregistrée sur le billet" });
    }
    const inserted = await client.query(
      `INSERT INTO alighting_events (tenant_id, booking_id, departure_id, stop_id, alighted_by, comments)
       VALUES ($1,$2,$3,$4,$5,$6)
       ON CONFLICT (booking_id) DO NOTHING
       RETURNING id, alighted_at AS "alightedAt"`,
      [req.tenantId, ticket.id, ticket.departure_id, req.body.stopId, req.user.id, req.body.commentaires || null]
    );
    if (!inserted.rowCount) {
      await client.query("ROLLBACK");
      return res.status(409).json({ success: false, message: "La descente de ce passager a déjà été confirmée" });
    }
    await client.query("UPDATE bookings SET boarding_status='OFFBOARDED' WHERE id=$1 AND tenant_id=$2", [ticket.id, req.tenantId]);
    await client.query("COMMIT");
    return res.json({ success: true, data: {
      bookingId: ticket.id, ...inserted.rows[0], seatReleased: true
    }, message: "Descente confirmée. Le siège est maintenant libéré pour le segment suivant." });
  } catch (error) {
    await client.query("ROLLBACK");
    return next(error);
  } finally { client.release(); }
});

export default router;
