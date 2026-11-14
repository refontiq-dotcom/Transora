import { NextFunction, Request, Response, Router } from "express";
import { body, param, validationResult } from "express-validator";
import { PoolClient } from "pg";
import QRCode from "qrcode";
import { pool } from "../../db/pool";

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
                d.capacity, d.fare_amount AS "fareAmount",
                d.company_booking_fee AS "companyBookingFee",
                COUNT(b.id) FILTER (WHERE b.status <> 'CANCELLED')::int AS "reservedSeats"
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
        departures: result.rows.filter(row => Number(row.capacity) > Number(row.reservedSeats))
          .map(row => ({ ...row, availableSeats: Number(row.capacity) - Number(row.reservedSeats) }))
      } });
    } catch (error) { return next(error); }
  }
);

router.post("/:publicCode/reservations", [
  param("publicCode").isAlphanumeric().isLength({ min: 32, max: 32 }),
  body("departureId").isUUID(),
  body("passengerName").isString().trim().isLength({ min: 2, max: 160 }),
  body("passengerPhone").isString().trim().matches(/^[+0-9().\s-]{8,24}$/)
], validate, async (req: Request, res: Response, next: NextFunction) => {
  const client: PoolClient = await pool.connect();
  try {
    await client.query("BEGIN");
    const departure = await client.query(
      `SELECT t.id AS tenant_id, t.name AS company_name, d.id, d.origin, d.destination,
              d.departure_at, d.vehicle_code, d.capacity, d.fare_amount, d.company_booking_fee
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
    if (Number(trip.fare_amount) <= 0) {
      await client.query("ROLLBACK");
      return res.status(409).json({ success: false, message: "Ce départ n'a pas encore de tarif défini" });
    }
    const reservations = await client.query(
      "SELECT seat_number FROM bookings WHERE departure_id = $1 AND tenant_id = $2 AND status <> 'CANCELLED'
         AND segment_range && '[0,)'::int4range",
      [trip.id, trip.tenant_id]
    );
    const occupied = new Set(reservations.rows.map((row: { seat_number: number | null }) => Number(row.seat_number)).filter(Boolean));
    if (occupied.size >= Number(trip.capacity)) {
      await client.query("ROLLBACK");
      return res.status(409).json({ success: false, message: "Ce départ est complet" });
    }
    const seatNumber = Array.from({ length: Number(trip.capacity) }, (_, index) => index + 1).find(seat => !occupied.has(seat));
    if (!seatNumber) {
      await client.query("ROLLBACK");
      return res.status(409).json({ success: false, message: "Aucune place disponible" });
    }
    const bookingResult = await client.query(
      `INSERT INTO bookings (tenant_id, departure_id, passenger_name, passenger_phone, amount_transport, company_booking_fee, seat_number, segment_range)
       VALUES ($1, $2, $3, $4, $5, $6, $7, '[0,)'::int4range)
       RETURNING id, ticket_token, passenger_name, passenger_phone, amount_transport, platform_fee, company_booking_fee, seat_number, status, created_at`,
      [trip.tenant_id, trip.id, String(req.body.passengerName).trim(), String(req.body.passengerPhone).trim(),
        Number(trip.fare_amount), Number(trip.company_booking_fee), seatNumber]
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
      passengerPhone: booking.passenger_phone, origin: trip.origin, destination: trip.destination,
      departureAt: trip.departure_at, vehicleCode: trip.vehicle_code, seatNumber: booking.seat_number,
      transportAmount: Number(booking.amount_transport),
      companyBookingFee: Number(booking.company_booking_fee),
      platformFee: Number(booking.platform_fee),
      totalAmount: Number(booking.amount_transport) + Number(booking.company_booking_fee) + Number(booking.platform_fee),
      paymentStatus: "NOT_INITIATED", bookingStatus: booking.status, qrCode
    }, message: "Réservation enregistrée. Votre billet est prêt; le paiement reste à effectuer auprès de la compagnie." });
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
              b.seat_number, b.status AS booking_status, d.origin, d.destination,
              d.departure_at, d.vehicle_code, d.status AS departure_status, t.name AS company_name,
              COALESCE(p.status, 'NOT_INITIATED') AS payment_status,
              EXISTS (SELECT 1 FROM boarding_events be WHERE be.booking_id = b.id AND be.tenant_id = b.tenant_id) AS boarded
       FROM tenants t JOIN bookings b ON b.tenant_id = t.id
       JOIN departures d ON d.id = b.departure_id AND d.tenant_id = b.tenant_id
       LEFT JOIN payments p ON p.booking_id = b.id AND p.tenant_id = b.tenant_id
       WHERE t.public_code = $1 AND b.ticket_token = $2`,
      [req.params.publicCode, req.params.ticketToken]
    );
    if (!result.rowCount) return res.status(404).json({ success: false, message: "Billet introuvable" });
    const ticket = result.rows[0];
    const qrCode = await QRCode.toDataURL(ticket.ticket_token, { errorCorrectionLevel: "M", margin: 2, width: 280 });
    return res.json({ success: true, data: {
      bookingId: ticket.id, companyName: ticket.company_name, passengerName: ticket.passenger_name,
      origin: ticket.origin, destination: ticket.destination, departureAt: ticket.departure_at,
      vehicleCode: ticket.vehicle_code, seatNumber: ticket.seat_number,
      transportAmount: Number(ticket.amount_transport),
      companyBookingFee: Number(ticket.company_booking_fee),
      platformFee: Number(ticket.platform_fee),
      totalAmount: Number(ticket.amount_transport) + Number(ticket.company_booking_fee) + Number(ticket.platform_fee),
      paymentStatus: ticket.payment_status, bookingStatus: ticket.booking_status,
      boarded: ticket.boarded, qrCode
    } });
  } catch (error) { return next(error); }
});

export default router;
