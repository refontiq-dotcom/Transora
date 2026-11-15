import { NextFunction, Request, Response, Router } from "express";
import { body, param, query, validationResult } from "express-validator";
import { PoolClient } from "pg";
import QRCode from "qrcode";
import { pool } from "../../db/pool";
import { resolveBookingSegment, SegmentResolution } from "../../lib/booking-segment";

const router = Router();
const validate = (req: Request, res: Response, next: NextFunction) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ success: false, message: "Données invalides", errors: errors.array() });
  next();
};

router.get("/:publicCode/departs", [param("publicCode").isAlphanumeric().isLength({ min: 32, max: 32 })], validate,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const result = await pool.query(
        `SELECT t.name AS "companyName", d.id, d.origin, d.destination,
                d.departure_at AS "departureAt", d.vehicle_code AS "vehicleCode",
                d.capacity, d.route_id AS "routeId", d.fare_amount AS "fareAmount",
                COALESCE((SELECT json_agg(json_build_object('id', rs.id, 'city', c.name, 'station', s.name, 'stopOrder', rs.stop_order) ORDER BY rs.stop_order)
                  FROM route_stops rs JOIN stations s ON s.id=rs.station_id AND s.tenant_id=rs.tenant_id
                  JOIN company_cities c ON c.id=s.city_id AND c.tenant_id=s.tenant_id
                  WHERE rs.route_id=d.route_id AND rs.tenant_id=d.tenant_id), '[]'::json) AS "routeStops",
                d.company_booking_fee AS "companyBookingFee",
                COUNT(DISTINCT b.seat_number) FILTER (WHERE b.status NOT IN ('CANCELLED', 'EXPIRED') AND (b.status <> 'HELD' OR b.hold_expires_at > NOW()))::int AS "reservedSeats"
         FROM tenants t JOIN departures d ON d.tenant_id = t.id
         LEFT JOIN bookings b ON b.departure_id = d.id AND b.tenant_id = d.tenant_id
         WHERE t.public_code = $1 AND d.status = 'SCHEDULED'
           AND d.departure_at > NOW() AND d.fare_amount > 0
         GROUP BY t.id, d.id ORDER BY d.departure_at LIMIT 100`,
        [req.params.publicCode]
      );
      const tenant = await pool.query("SELECT name FROM tenants WHERE public_code = $1", [req.params.publicCode]);
      if (!tenant.rowCount) return res.status(404).json({ success: false, message: "Lien de réservation introuvable" });
      return res.json({ success: true, data: {
        companyName: tenant.rows[0].name,
        departures: result.rows.filter(row => Number(row.capacity) > Number(row.reservedSeats) || Boolean(row.routeId))
          .map(row => ({ ...row, availableSeats: Number(row.capacity) - Number(row.reservedSeats) }))
      } });
    } catch (error) { return next(error); }
  }
);

router.get("/:publicCode/departs/:departureId/places", [
  param("publicCode").isAlphanumeric().isLength({ min: 32, max: 32 }),
  param("departureId").isUUID(),
  query("originStopId").optional().isUUID(),
  query("destinationStopId").optional().isUUID()
], validate, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const departure = await pool.query(
      `SELECT t.id AS tenant_id, d.id, d.capacity, d.route_id, d.origin, d.destination, d.departure_at, d.fare_amount, d.company_booking_fee
       FROM tenants t JOIN departures d ON d.tenant_id = t.id
       WHERE t.public_code = $1 AND d.id = $2 AND d.status = 'SCHEDULED'
         AND d.departure_at > NOW()`,
      [req.params.publicCode, req.params.departureId]
    );
    if (!departure.rowCount) return res.status(404).json({ success: false, message: "Départ introuvable ou fermé à la réservation" });
    const trip = departure.rows[0];
    const segmentClient = await pool.connect();
    let segment: SegmentResolution;
    try {
      segment = await resolveBookingSegment(
        segmentClient, trip.tenant_id, trip.route_id || null,
        typeof req.query.originStopId === "string" ? req.query.originStopId : null,
        typeof req.query.destinationStopId === "string" ? req.query.destinationStopId : null,
        { origin: trip.origin, destination: trip.destination, fareAmount: Number(trip.fare_amount), companyBookingFee: Number(trip.company_booking_fee) }
      );
    } finally { segmentClient.release(); }
    if (segment.error || !segment.data) {
      return res.status(segment.error?.status || 400).json({ success: false, message: segment.error?.message || "Sélectionnez votre gare de départ et votre gare d'arrivée" });
    }
    const occupied = await pool.query(
      `SELECT DISTINCT seat_number
       FROM bookings
       WHERE departure_id = $1 AND tenant_id = $2
         AND status NOT IN ('CANCELLED', 'EXPIRED')
         AND (status <> 'HELD' OR hold_expires_at > NOW())
         AND seat_number IS NOT NULL
         AND segment_range && $3::int4range
       ORDER BY seat_number`,
      [trip.id, trip.tenant_id, segment.data.segmentRange]
    );
    const taken = new Set(occupied.rows.map((row: { seat_number: number }) => Number(row.seat_number)));
    const seats = Array.from({ length: Number(trip.capacity) }, (_, index) => ({
      number: index + 1, available: !taken.has(index + 1)
    }));
    return res.json({ success: true, data: {
      departureId: trip.id, origin: segment.data.origin, destination: segment.data.destination,
      fareAmount: segment.data.fareAmount, companyBookingFee: segment.data.companyBookingFee,
      capacity: Number(trip.capacity), availableCount: seats.filter(seat => seat.available).length,
      seats
    } });
  } catch (error) { return next(error); }
});

router.post("/:publicCode/reservations", [
  param("publicCode").isAlphanumeric().isLength({ min: 32, max: 32 }),
  body("departureId").isUUID(),
  body("passengerName").isString().trim().isLength({ min: 2, max: 160 }),
  body("passengerPhone").isString().trim().matches(/^[+0-9().\s-]{8,24}$/),
  body("originStopId").optional().isUUID(),
  body("destinationStopId").optional().isUUID()
], validate, async (req: Request, res: Response, next: NextFunction) => {
  const client: PoolClient = await pool.connect();
  try {
    await client.query("BEGIN");
    const departure = await client.query(
      `SELECT t.id AS tenant_id, t.name AS company_name, d.id, d.origin, d.destination,
              d.departure_at, d.vehicle_code, d.capacity, d.fare_amount, d.company_booking_fee, d.route_id
       FROM tenants t JOIN departures d ON d.tenant_id = t.id
       WHERE t.public_code = $1 AND d.id = $2 AND d.status = 'SCHEDULED'
         AND d.departure_at > NOW() FOR UPDATE OF d`,
      [req.params.publicCode, req.body.departureId]
    );
    if (!departure.rowCount) {
      await client.query("ROLLBACK");
      return res.status(404).json({ success: false, message: "Départ indisponible pour cette compagnie" });
    }
    const trip = departure.rows[0];
    const segment = await resolveBookingSegment(
      client, trip.tenant_id, trip.route_id || null,
      typeof req.body.originStopId === "string" ? req.body.originStopId : null,
      typeof req.body.destinationStopId === "string" ? req.body.destinationStopId : null,
      { origin: trip.origin, destination: trip.destination, fareAmount: Number(trip.fare_amount), companyBookingFee: Number(trip.company_booking_fee) }
    );
    if (segment.error || !segment.data) {
      await client.query("ROLLBACK");
      return res.status(segment.error?.status || 400).json({ success: false, message: segment.error?.message || "Segment invalide" });
    }
    const selectedSegment = segment.data;
    if (Number(trip.fare_amount) <= 0) {
      await client.query("ROLLBACK");
      return res.status(409).json({ success: false, message: "Ce départ n'a pas encore de tarif défini" });
    }
    const reservations = await client.query(
      "SELECT seat_number FROM bookings WHERE departure_id=$1 AND tenant_id=$2 AND status NOT IN ('CANCELLED', 'EXPIRED') AND (status <> 'HELD' OR hold_expires_at > NOW()) AND segment_range && $3::int4range",
      [trip.id, trip.tenant_id, selectedSegment.segmentRange]
    );
    const occupied = new Set(reservations.rows.map((row: { seat_number: number | null }) => Number(row.seat_number)).filter(Boolean));
    if (occupied.size >= Number(trip.capacity)) { await client.query("ROLLBACK"); return res.status(409).json({ success: false, message: "Ce segment est complet" }); }
    const seatNumber = Array.from({ length: Number(trip.capacity) }, (_, index) => index + 1).find(seat => !occupied.has(seat));
    if (!seatNumber) { await client.query("ROLLBACK"); return res.status(409).json({ success: false, message: "Aucune place disponible sur ce segment" }); }
    const bookingResult = await client.query(
      `INSERT INTO bookings (tenant_id, departure_id, passenger_name, passenger_phone, amount_transport, company_booking_fee, seat_number, segment_range, origin_stop_id, destination_stop_id, status, hold_expires_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8::int4range,$9,$10,'HELD',NOW() + INTERVAL '15 minutes')
       RETURNING id, ticket_token, passenger_name, passenger_phone, amount_transport, platform_fee, company_booking_fee, seat_number, status, hold_expires_at, created_at`,
      [trip.tenant_id, trip.id, String(req.body.passengerName).trim(), String(req.body.passengerPhone).trim(), selectedSegment.fareAmount, selectedSegment.companyBookingFee, seatNumber, selectedSegment.segmentRange, selectedSegment.originStopId, selectedSegment.destinationStopId]
    );
    await client.query("COMMIT");
    const booking = bookingResult.rows[0];
    const qrCode = await QRCode.toDataURL(booking.ticket_token, {
      errorCorrectionLevel: "M", margin: 2, width: 280,
      color: { dark: "#09271B", light: "#FFFFFF" }
    });
    return res.status(201).json({ success: true, data: {
      ticketToken: booking.ticket_token, bookingId: booking.id,
      companyName: trip.company_name, passengerName: booking.passenger_name,
      passengerPhone: booking.passenger_phone, origin: selectedSegment.origin, destination: selectedSegment.destination,
      departureAt: trip.departure_at, vehicleCode: trip.vehicle_code, seatNumber: booking.seat_number,
      transportAmount: Number(booking.amount_transport),
      companyBookingFee: Number(booking.company_booking_fee),
      platformFee: Number(booking.platform_fee),
      totalAmount: Number(booking.amount_transport) + Number(booking.company_booking_fee) + Number(booking.platform_fee),
      paymentStatus: "NOT_INITIATED", bookingStatus: booking.status,
      holdExpiresAt: booking.hold_expires_at, qrCode: null
    }, message: "Place bloquée temporairement pendant 15 minutes. Finalisez le paiement avant l'expiration pour confirmer votre réservation." });
  } catch (error) {
    await client.query("ROLLBACK");
    if ((error as { code?: string }).code === "23505") return res.status(409).json({ success: false, message: "La dernière place vient d'être réservée. Choisissez un autre départ." });
    return next(error);
  } finally { client.release(); }
});

router.get("/:publicCode/ticket/:ticketToken", [
  param("publicCode").isAlphanumeric().isLength({ min: 32, max: 32 }),
  param("ticketToken").isUUID()
], validate, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const result = await pool.query(
      `SELECT b.id, b.ticket_token, b.passenger_name, b.amount_transport, b.platform_fee, b.company_booking_fee,
              b.seat_number, b.status AS booking_status, b.hold_expires_at, COALESCE(oc.name, d.origin) AS origin, COALESCE(dc.name, d.destination) AS destination,
              d.departure_at, d.vehicle_code, d.status AS departure_status, t.name AS company_name,
              COALESCE(p.status, 'NOT_INITIATED') AS payment_status,
              EXISTS (SELECT 1 FROM boarding_events be WHERE be.booking_id = b.id AND be.tenant_id = b.tenant_id) AS boarded
       FROM tenants t JOIN bookings b ON b.tenant_id = t.id
       JOIN departures d ON d.id = b.departure_id AND d.tenant_id = b.tenant_id
       LEFT JOIN route_stops ors ON ors.id = b.origin_stop_id AND ors.tenant_id = b.tenant_id
       LEFT JOIN stations os ON os.id = ors.station_id AND os.tenant_id = ors.tenant_id
       LEFT JOIN company_cities oc ON oc.id = os.city_id AND oc.tenant_id = os.tenant_id
       LEFT JOIN route_stops drs ON drs.id = b.destination_stop_id AND drs.tenant_id = b.tenant_id
       LEFT JOIN stations ds ON ds.id = drs.station_id AND ds.tenant_id = drs.tenant_id
       LEFT JOIN company_cities dc ON dc.id = ds.city_id AND dc.tenant_id = ds.tenant_id
       LEFT JOIN payments p ON p.booking_id = b.id AND p.tenant_id = b.tenant_id
       WHERE t.public_code = $1 AND b.ticket_token = $2`,
      [req.params.publicCode, req.params.ticketToken]
    );
    if (!result.rowCount) return res.status(404).json({ success: false, message: "Billet introuvable" });
    const ticket = result.rows[0];
    const qrCode = ticket.booking_status === "PAID"
      ? await QRCode.toDataURL(ticket.ticket_token, { errorCorrectionLevel: "M", margin: 2, width: 280 })
      : null;
    return res.json({ success: true, data: {
      bookingId: ticket.id, companyName: ticket.company_name, passengerName: ticket.passenger_name,
      origin: ticket.origin, destination: ticket.destination, departureAt: ticket.departure_at,
      vehicleCode: ticket.vehicle_code, seatNumber: ticket.seat_number,
      transportAmount: Number(ticket.amount_transport),
      companyBookingFee: Number(ticket.company_booking_fee),
      platformFee: Number(ticket.platform_fee),
      totalAmount: Number(ticket.amount_transport) + Number(ticket.company_booking_fee) + Number(ticket.platform_fee),
      paymentStatus: ticket.payment_status, bookingStatus: ticket.booking_status,
      holdExpiresAt: ticket.hold_expires_at, boarded: ticket.boarded, qrCode
    } });
  } catch (error) { return next(error); }
});

export default router;
