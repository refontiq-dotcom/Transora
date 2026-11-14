import { Router, Request, Response, NextFunction } from "express";
import { authorize } from "../../middleware/auth";
import { query as queryValidator, validationResult } from "express-validator";
import { pool } from "../../db/pool";

const router = Router();

// Les comptes applicatifs disponibles sont actuellement administrateurs d'entreprise.
router.use(authorize(["administrateur"]));

router.get(
  "/",
  [
    queryValidator("date").optional().isISO8601({ strict: true, strictSeparator: true }),
    queryValidator("period").optional().isIn(["7", "30", "90"])
  ],
  async (req: Request, res: Response, next: NextFunction) => {
  const validation = validationResult(req);
  if (!validation.isEmpty()) {
    return res.status(400).json({
      success: false,
      message: "Date ou période invalide",
      errors: validation.array()
    });
  }

  const tenantId = req.tenantId;
  if (!tenantId) {
    return res.status(401).json({
      success: false,
      message: "Tenant non identifié"
    });
  }

  try {
    const selectedDate = typeof req.query.date === "string"
      ? req.query.date
      : new Date().toISOString().slice(0, 10);
    const periodDays = typeof req.query.period === "string"
      ? Number(req.query.period)
      : 7;
    const [summary, departures, activity] = await Promise.all([
      pool.query<{
        departures_today: string;
        passengers_today: string;
        revenue_today: string;
        capacity_today: string;
        reserved_seats_today: string;
        active_vehicles: string;
        tenant_name: string;
      }>(
        `SELECT
           (SELECT COUNT(*) FROM departures
             WHERE tenant_id = $1 AND departure_at::date = $2::date
               AND status <> 'CANCELLED') AS departures_today,
           (SELECT COUNT(*) FROM bookings b
             JOIN departures d ON d.id = b.departure_id AND d.tenant_id = b.tenant_id
             WHERE b.tenant_id = $1 AND d.departure_at::date = $2::date
               AND b.status = 'PAID') AS passengers_today,
           (SELECT COALESCE(SUM(amount_transport + platform_fee), 0) FROM payments
             WHERE tenant_id = $1 AND confirmed_at::date = $2::date
               AND status = 'CONFIRMED') AS revenue_today,
           (SELECT COALESCE(SUM(capacity), 0) FROM departures
             WHERE tenant_id = $1 AND departure_at::date = $2::date
               AND status <> 'CANCELLED') AS capacity_today,
           (SELECT COUNT(*) FROM bookings b
             JOIN departures d ON d.id = b.departure_id AND d.tenant_id = b.tenant_id
             WHERE b.tenant_id = $1 AND d.departure_at::date = $2::date
               AND b.status IN ('RESERVED', 'PAID')) AS reserved_seats_today,
           (SELECT COUNT(*) FROM vehicles
             WHERE tenant_id = $1 AND deleted_at IS NULL AND status = 'en_service') AS active_vehicles,
           (SELECT name FROM tenants WHERE id = $1) AS tenant_name`,
        [tenantId, selectedDate]
      ),
      pool.query<{
        id: string;
        origin: string;
        destination: string;
        departure_at: Date;
        vehicle_code: string;
        capacity: number;
        passengers: string;
        reserved_seats: string;
        status: string;
      }>(
        `SELECT d.id, d.origin, d.destination, d.departure_at, d.vehicle_code,
                d.capacity,
                COUNT(b.id) FILTER (WHERE b.status = 'PAID') AS passengers,
                COUNT(b.id) FILTER (WHERE b.status IN ('RESERVED', 'PAID')) AS reserved_seats,
                d.status
         FROM departures d
         LEFT JOIN bookings b ON b.departure_id = d.id AND b.tenant_id = d.tenant_id
         WHERE d.tenant_id = $1
           AND d.departure_at >= $2::date
           AND d.departure_at < $2::date + INTERVAL '1 day'
           AND d.status <> 'CANCELLED'
         GROUP BY d.id
         ORDER BY d.departure_at
         LIMIT 8`,
        [tenantId, selectedDate]
      ),
      pool.query<{
        day: string;
        departures: string;
        bookings: string;
      }>(
        `SELECT days.day::date::text AS day,
                COUNT(DISTINCT d.id) AS departures,
                COUNT(b.id) FILTER (WHERE b.status = 'PAID') AS bookings
         FROM generate_series($2::date - ($3::integer - 1), $2::date, INTERVAL '1 day') AS days(day)
         LEFT JOIN departures d
           ON d.tenant_id = $1 AND d.departure_at::date = days.day::date
             AND d.status <> 'CANCELLED'
         LEFT JOIN bookings b
           ON b.departure_id = d.id AND b.tenant_id = d.tenant_id
         GROUP BY days.day
         ORDER BY days.day`,
        [tenantId, selectedDate, periodDays]
      )
    ]);

    const totals = summary.rows[0];
    const capacity = Number(totals.capacity_today);
    const reservedSeats = Number(totals.reserved_seats_today);
    const passengers = Number(totals.passengers_today);
    return res.json({
      success: true,
      data: {
        tenant: { name: totals.tenant_name },
        selectedDate,
        periodDays,
        metrics: {
          departuresToday: Number(totals.departures_today),
          passengersToday: passengers,
          revenueTodayFcfa: Number(totals.revenue_today),
          activeVehicles: Number(totals.active_vehicles),
          capacityToday: capacity,
          reservedSeatsToday: reservedSeats,
          availableSeatsToday: Math.max(0, capacity - reservedSeats),
          occupancyRate: capacity === 0 ? 0 : Math.round((reservedSeats / capacity) * 100)
        },
        departures: departures.rows.map((departure) => ({
          id: departure.id,
          origin: departure.origin,
          destination: departure.destination,
          departureAt: departure.departure_at,
          vehicleCode: departure.vehicle_code,
          capacity: departure.capacity,
          passengers: Number(departure.passengers),
          reservedSeats: Number(departure.reserved_seats),
          occupancyRate: departure.capacity === 0
            ? 0
            : Math.round((Number(departure.reserved_seats) / departure.capacity) * 100),
          status: departure.status
        })),
        activity: activity.rows.map((row) => ({
          day: row.day,
          departures: Number(row.departures),
          bookings: Number(row.bookings)
        }))
      }
    });
  } catch (error) {
    next(error);
  }
  }
);

export default router;
