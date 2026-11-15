/**
 * Module: Départs, Trajets et Horaires
 *
 * Gère la création, la modification et la recherche de trajets et départs.
 * Selon CAHIER-DES-CHARGES C-03 et l'architecture cible.
 */

import { Router, Request, Response } from "express";
import { body, param, query, validationResult } from "express-validator";
import { NextFunction } from "express";
import { PoolClient } from "pg";
import { pool } from "../../db/pool";
import { authorize } from "../../middleware/auth";

const router = Router();
const bookingStaff = authorize(["administrateur", "agent_guichet", "caissier", "agent_accueil"]);

// Validation helpers
const validate = (req: Request, res: Response, next: any) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({
      success: false,
      message: "Données invalides",
      errors: errors.array()
    });
  }
  next();
};

router.post(
  "/departures",
  authorize(["administrateur", "responsable_exploitation"]),
  [
    body("origin").isString().trim().notEmpty(),
    body("routeId").optional().isUUID(),
    body("destination").isString().trim().notEmpty(),
    body("departureAt").isISO8601(),
    body("vehicleCode").isString().trim().notEmpty(),
    body("capacity").isInt({ min: 1 }),
    body("status").optional().isIn(["SCHEDULED", "BOARDING", "DEPARTED", "CANCELLED"])
  ],
  validate,
  async (req: Request, res: Response, next: NextFunction) => {
    const tenantId = req.tenantId;
    if (!tenantId) {
      return res.status(401).json({ success: false, message: "Tenant non identifié" });
    }

    try {
      const { origin, destination, departureAt, vehicleCode, capacity, status, routeId } = req.body;
      if (routeId) {
        const route = await pool.query(
          `SELECT r.id,
             (SELECT c.name FROM route_stops x JOIN stations s ON s.id=x.station_id AND s.tenant_id=x.tenant_id JOIN company_cities c ON c.id=s.city_id AND c.tenant_id=s.tenant_id WHERE x.route_id=r.id AND x.tenant_id=r.tenant_id ORDER BY x.stop_order ASC LIMIT 1) AS route_origin,
             (SELECT c.name FROM route_stops x JOIN stations s ON s.id=x.station_id AND s.tenant_id=x.tenant_id JOIN company_cities c ON c.id=s.city_id AND c.tenant_id=s.tenant_id WHERE x.route_id=r.id AND x.tenant_id=r.tenant_id ORDER BY x.stop_order DESC LIMIT 1) AS route_destination
           FROM transport_routes r WHERE r.id=$1 AND r.tenant_id=$2 AND r.is_active=TRUE`,
          [routeId, tenantId]
        );
        if (!route.rowCount) return res.status(404).json({ success: false, message: "Ligne introuvable ou inactive dans votre compagnie" });
        if (String(route.rows[0].route_origin).toLowerCase() !== String(origin).trim().toLowerCase() || String(route.rows[0].route_destination).toLowerCase() !== String(destination).trim().toLowerCase()) {
          return res.status(400).json({ success: false, message: "Les extrémités du départ doivent correspondre à celles de la ligne" });
        }
      }
      const tariff = await pool.query<{ id: string; fare_amount: number; company_booking_fee: number }>(
        `SELECT id, fare_amount, company_booking_fee
         FROM company_route_tariffs
         WHERE tenant_id = $1 AND is_active = TRUE
           AND lower(regexp_replace(btrim(origin), '[[:space:]]+', ' ', 'g')) =
               lower(regexp_replace(btrim($2), '[[:space:]]+', ' ', 'g'))
           AND lower(regexp_replace(btrim(destination), '[[:space:]]+', ' ', 'g')) =
               lower(regexp_replace(btrim($3), '[[:space:]]+', ' ', 'g'))
         LIMIT 1`,
        [tenantId, origin.trim(), destination.trim()]
      );
      if (!tariff.rowCount) return res.status(409).json({
        success: false,
        message: "Aucun tarif actif n'est configuré pour ce trajet. Créez d'abord son tarif dans Gestion des tarifs."
      });
      const result = await pool.query(
        `INSERT INTO departures
           (tenant_id, origin, destination, departure_at, vehicle_code, capacity, fare_amount, company_booking_fee, route_tariff_id, status, route_id)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
         RETURNING id, origin, destination, departure_at AS "departureAt",
                   vehicle_code AS "vehicleCode", capacity, fare_amount AS "fareAmount",
                   company_booking_fee AS "companyBookingFee", route_tariff_id AS "routeTariffId", status, route_id AS "routeId"`,
        [
          tenantId,
          origin.trim(),
          destination.trim(),
          departureAt,
          vehicleCode.trim(),
          Number(capacity),
          Number(tariff.rows[0].fare_amount),
          Number(tariff.rows[0].company_booking_fee),
          tariff.rows[0].id,
          status || "SCHEDULED",
          routeId || null
        ]
      );
      return res.status(201).json({ success: true, data: result.rows[0] });
    } catch (error) {
      return next(error);
    }
  }
);

router.patch(
  "/departures/:id/tarif",
  authorize(["administrateur", "superviseur"]),
  [param("id").isUUID()],
  validate,
  async (req: Request, res: Response, next: NextFunction) => {
    if (!req.tenantId || !req.user) return res.status(401).json({ success: false, message: "Tenant non identifié" });
    const client: PoolClient = await pool.connect();
    try {
      await client.query("BEGIN");
      const departure = await client.query(
        `SELECT d.id, d.origin, d.destination, t.id AS tariff_id,
                t.fare_amount, t.company_booking_fee
         FROM departures d
         JOIN company_route_tariffs t ON t.tenant_id = d.tenant_id AND t.is_active = TRUE
           AND lower(regexp_replace(btrim(t.origin), '[[:space:]]+', ' ', 'g')) =
               lower(regexp_replace(btrim(d.origin), '[[:space:]]+', ' ', 'g'))
           AND lower(regexp_replace(btrim(t.destination), '[[:space:]]+', ' ', 'g')) =
               lower(regexp_replace(btrim(d.destination), '[[:space:]]+', ' ', 'g'))
         WHERE d.id = $1 AND d.tenant_id = $2
         ORDER BY t.updated_at DESC
         LIMIT 1
         FOR UPDATE OF d`,
        [req.params.id, req.tenantId]
      );
      if (!departure.rowCount) {
        await client.query("ROLLBACK");
        return res.status(409).json({ success: false, message: "Aucun tarif actif ne correspond à ce trajet dans votre compagnie." });
      }
      const tariff = departure.rows[0];
      const updated = await client.query(
        `UPDATE departures
         SET fare_amount = $3, company_booking_fee = $4, route_tariff_id = $5
         WHERE id = $1 AND tenant_id = $2
         RETURNING id, origin, destination, fare_amount AS "fareAmount",
                   company_booking_fee AS "companyBookingFee", route_tariff_id AS "routeTariffId"`,
        [req.params.id, req.tenantId, tariff.fare_amount, tariff.company_booking_fee, tariff.tariff_id]
      );
      await client.query(
        `INSERT INTO audit_events (tenant_id, actor_user_id, type, subject, action, details)
         VALUES ($1, $2, 'modification', 'départ', 'Application du tarif compagnie', $3::jsonb)`,
        [req.tenantId, req.user.id, JSON.stringify(updated.rows[0])]
      );
      await client.query("COMMIT");
      return res.json({ success: true, data: updated.rows[0], message: "Tarif de la compagnie appliqué à ce départ" });
    } catch (error) {
      await client.query("ROLLBACK");
      return next(error);
    } finally { client.release(); }
  }
);

router.post(
  "/departures/:id/bookings",
  bookingStaff,
  [
    param("id").isUUID(),
    body("passengerName").isString().trim().isLength({ min: 2, max: 160 }),
    body("originStopId").optional().isUUID(),
    body("destinationStopId").optional().isUUID()
  ],
  validate,
  async (req: Request, res: Response, next: NextFunction) => {
    let client: PoolClient | undefined;
    let transactionStarted = false;
    try {
      const tenantId = req.tenantId;
      if (!tenantId) {
        return res.status(401).json({ success: false, message: "Tenant non identifié" });
      }

      client = await pool.connect();
      await client.query("BEGIN");
      transactionStarted = true;
      const { id } = req.params;
      const { passengerName } = req.body;
      const departure = await client.query<{ capacity: number; fare_amount: number; company_booking_fee: number; route_id: string | null }> (
        `SELECT capacity, fare_amount, company_booking_fee, route_id FROM departures WHERE id=$1 AND tenant_id=$2 AND status='SCHEDULED' AND departure_at>NOW() FOR UPDATE`,
        [id, tenantId]
      );
      if (!departure.rowCount) { await client.query("ROLLBACK"); transactionStarted = false; return res.status(404).json({ success: false, message: "Départ introuvable ou non disponible" }); }
      let originStopId: string | null = null;
      let destinationStopId: string | null = null;
      let segmentRange = "[0,)";
      let fareAmount = Number(departure.rows[0].fare_amount);
      let companyBookingFee = Number(departure.rows[0].company_booking_fee);
      if (departure.rows[0].route_id) {
        originStopId = typeof req.body.originStopId === "string" ? req.body.originStopId : null;
        destinationStopId = typeof req.body.destinationStopId === "string" ? req.body.destinationStopId : null;
        if (!originStopId || !destinationStopId) { await client.query("ROLLBACK"); transactionStarted = false; return res.status(400).json({ success: false, message: "Choisissez votre gare de départ et votre gare d'arrivée" }); }
        const stops = await client.query(
          `SELECT rs.id, rs.stop_order, c.name AS city FROM route_stops rs JOIN stations s ON s.id=rs.station_id AND s.tenant_id=rs.tenant_id JOIN company_cities c ON c.id=s.city_id AND c.tenant_id=s.tenant_id WHERE rs.tenant_id=$1 AND rs.route_id=$2 AND rs.id=ANY($3::uuid[]) ORDER BY rs.stop_order`,
          [tenantId, departure.rows[0].route_id, [originStopId, destinationStopId]]
        );
        if (stops.rowCount !== 2 || stops.rows[0].id !== originStopId || stops.rows[1].id !== destinationStopId || Number(stops.rows[0].stop_order) >= Number(stops.rows[1].stop_order)) { await client.query("ROLLBACK"); transactionStarted = false; return res.status(400).json({ success: false, message: "Le trajet sélectionné ne respecte pas l'ordre des arrêts" }); }
        const tariff = await client.query(
          `SELECT fare_amount, company_booking_fee FROM company_route_tariffs WHERE tenant_id=$1 AND is_active=TRUE AND lower(regexp_replace(btrim(origin), '[[:space:]]+', ' ', 'g'))=lower(regexp_replace(btrim($2), '[[:space:]]+', ' ', 'g')) AND lower(regexp_replace(btrim(destination), '[[:space:]]+', ' ', 'g'))=lower(regexp_replace(btrim($3), '[[:space:]]+', ' ', 'g')) LIMIT 1`,
          [tenantId, stops.rows[0].city, stops.rows[1].city]
        );
        if (!tariff.rowCount) { await client.query("ROLLBACK"); transactionStarted = false; return res.status(409).json({ success: false, message: "Aucun tarif actif pour ce segment" }); }
        fareAmount = Number(tariff.rows[0].fare_amount);
        companyBookingFee = Number(tariff.rows[0].company_booking_fee);
        segmentRange = "[" + Number(stops.rows[0].stop_order) + "," + Number(stops.rows[1].stop_order) + ")";
      } else if (fareAmount <= 0) { await client.query("ROLLBACK"); transactionStarted = false; return res.status(409).json({ success: false, message: "Le tarif de ce départ doit être configuré avant la réservation" }); }
      const taken = await client.query<{ seat_number: number }>(
        `SELECT seat_number FROM bookings WHERE departure_id=$1 AND tenant_id=$2 AND status NOT IN ('CANCELLED', 'EXPIRED') AND (status <> 'HELD' OR hold_expires_at > NOW()) AND seat_number IS NOT NULL AND segment_range && $3::int4range`,
        [id, tenantId, segmentRange]
      );
      const occupied = new Set(taken.rows.map(row => Number(row.seat_number)));
      const seatNumber = Array.from({ length: Number(departure.rows[0].capacity) }, (_, index) => index + 1).find(seat => !occupied.has(seat));
      if (!seatNumber) { await client.query("ROLLBACK"); transactionStarted = false; return res.status(409).json({ success: false, message: "Aucune place disponible sur ce segment" }); }
      const booking = await client.query(
        `INSERT INTO bookings (tenant_id, departure_id, passenger_name, amount_transport, company_booking_fee, seat_number, segment_range, origin_stop_id, destination_stop_id) VALUES ($1,$2,$3,$4,$5,$6,$7::int4range,$8,$9) RETURNING id, ticket_token AS "ticketToken", departure_id AS "departureId", passenger_name AS "passengerName", amount_transport AS "amountTransport", platform_fee AS "platformFee", company_booking_fee AS "companyBookingFee", seat_number AS "seatNumber", status, origin_stop_id AS "originStopId", destination_stop_id AS "destinationStopId", created_at AS "createdAt"`,
        [tenantId, id, passengerName.trim(), fareAmount, companyBookingFee, seatNumber, segmentRange, originStopId, destinationStopId]
      );
      await client.query("COMMIT");
      transactionStarted = false;
      return res.status(201).json({ success: true, data: booking.rows[0] });
    } catch (error) {
      if (client && transactionStarted) {
        await client.query("ROLLBACK");
      }
      return next(error);
    } finally {
      client?.release();
    }
  }
);

router.patch(
  "/departures/:id/status",
  authorize(["administrateur", "superviseur"]),
  [
    param("id").isUUID(),
    body("status").isIn(["BOARDING", "DEPARTED", "CANCELLED"])
  ],
  validate,
  async (req: Request, res: Response, next: NextFunction) => {
    if (!req.tenantId || !req.user) return res.status(401).json({ success: false, message: "Tenant non identifié" });
    const client: PoolClient = await pool.connect();
    try {
      await client.query("BEGIN");
      const current = await client.query(
        "SELECT id, status FROM departures WHERE id = $1 AND tenant_id = $2 FOR UPDATE",
        [req.params.id, req.tenantId]
      );
      if (!current.rowCount) {
        await client.query("ROLLBACK");
        return res.status(404).json({ success: false, message: "Départ introuvable dans cette compagnie" });
      }
      const previous = current.rows[0].status as string;
      const nextStatus = String(req.body.status);
      const allowed = (previous === "SCHEDULED" && ["BOARDING", "CANCELLED"].includes(nextStatus))
        || (previous === "BOARDING" && ["DEPARTED", "CANCELLED"].includes(nextStatus));
      if (!allowed) {
        await client.query("ROLLBACK");
        return res.status(409).json({ success: false, message: "Transition de statut non autorisée" });
      }
      if (nextStatus === "CANCELLED") {
        const boarded = await client.query(
          "SELECT 1 FROM boarding_events WHERE departure_id = $1 AND tenant_id = $2 LIMIT 1",
          [req.params.id, req.tenantId]
        );
        if (boarded.rowCount) {
          await client.query("ROLLBACK");
          return res.status(409).json({ success: false, message: "Un départ avec des passagers déjà embarqués ne peut pas être annulé" });
        }
        await client.query(
          "UPDATE bookings SET status = 'CANCELLED' WHERE departure_id = $1 AND tenant_id = $2 AND status = 'RESERVED'",
          [req.params.id, req.tenantId]
        );
      }
      const updated = await client.query(
        "UPDATE departures SET status = $3 WHERE id = $1 AND tenant_id = $2 RETURNING id, status",
        [req.params.id, req.tenantId, nextStatus]
      );
      await client.query(
        `INSERT INTO audit_events (tenant_id, actor_user_id, type, subject, action, details)
         VALUES ($1, $2, 'modification', 'départ', $3, $4::jsonb)`,
        [req.tenantId, req.user.id, `Statut du départ ${req.params.id}`,
          JSON.stringify({ previousStatus: previous, nextStatus })]
      );
      await client.query("COMMIT");
      return res.json({ success: true, data: updated.rows[0], message: "Statut du départ mis à jour" });
    } catch (error) {
      await client.query("ROLLBACK");
      return next(error);
    } finally { client.release(); }
  }
);

router.get(
  "/departures",
  [
    query("date").optional().isISO8601().withMessage("La date doit être au format ISO"),
    query("status").optional().isIn(["SCHEDULED", "BOARDING", "DEPARTED", "CANCELLED"]),
    query("search").optional().isString().trim().isLength({ max: 100 })
  ],
  validate,
  async (req: Request, res: Response, next: NextFunction) => {
    const tenantId = req.tenantId;
    if (!tenantId) {
      return res.status(401).json({ success: false, message: "Tenant non identifié" });
    }

    try {
      const search = typeof req.query.search === "string" ? req.query.search.trim() : null;
      const date = typeof req.query.date === "string" ? req.query.date : null;
      const status = typeof req.query.status === "string" ? req.query.status : null;
      const result = await pool.query<{
        id: string;
        origin: string;
        destination: string;
        departure_at: Date;
        vehicle_code: string;
        capacity: number;
        fare_amount: number;
        company_booking_fee: number;
        route_tariff_id: string | null;
        route_id: string | null;
        route_stops: Array<{ id: string; city: string; station: string; stopOrder: number }>;
        status: string;
        reserved_seats: string;
      }>(
        `SELECT d.id, d.origin, d.destination, d.departure_at, d.vehicle_code,
                d.capacity, d.fare_amount, d.company_booking_fee, d.route_tariff_id, d.status, d.route_id,
                COALESCE((SELECT json_agg(json_build_object('id', rs.id, 'city', c.name, 'station', s.name, 'stopOrder', rs.stop_order) ORDER BY rs.stop_order)
                  FROM route_stops rs JOIN stations s ON s.id=rs.station_id AND s.tenant_id=rs.tenant_id
                  JOIN company_cities c ON c.id=s.city_id AND c.tenant_id=s.tenant_id
                  WHERE rs.route_id=d.route_id AND rs.tenant_id=d.tenant_id), '[]'::json) AS route_stops,
                COUNT(b.id) FILTER (WHERE b.status IN ('RESERVED', 'PAID') OR (b.status = 'HELD' AND b.hold_expires_at > NOW())) AS reserved_seats
         FROM departures d
         LEFT JOIN bookings b ON b.departure_id = d.id AND b.tenant_id = d.tenant_id
         WHERE d.tenant_id = $1
           AND d.departure_at >= CURRENT_DATE
           AND ($2::date IS NULL OR d.departure_at::date = $2::date)
           AND ($3::text IS NULL OR d.status = $3)
           AND ($4::text IS NULL OR
             d.origin ILIKE '%' || $4 || '%' OR
             d.destination ILIKE '%' || $4 || '%' OR
             d.vehicle_code ILIKE '%' || $4 || '%')
         GROUP BY d.id
         ORDER BY d.departure_at
         LIMIT 200`,
        [tenantId, date, status, search]
      );

      return res.json({
        success: true,
        data: {
          departures: result.rows.map((departure) => {
            const reservedSeats = Number(departure.reserved_seats);
            return {
              id: departure.id,
              origin: departure.origin,
              destination: departure.destination,
              departureAt: departure.departure_at,
              vehicleCode: departure.vehicle_code,
              capacity: departure.capacity,
              fareAmount: Number(departure.fare_amount),
              companyBookingFee: Number(departure.company_booking_fee),
              routeTariffId: departure.route_tariff_id,
              routeId: departure.route_id,
              routeStops: departure.route_stops,
              reservedSeats,
              availableSeats: Math.max(0, departure.capacity - reservedSeats),
              occupancyRate: departure.capacity === 0
                ? 0
                : Math.round((reservedSeats / departure.capacity) * 100),
              status: departure.status
            };
          }),
          count: result.rowCount
        }
      });
    } catch (error) {
      return next(error);
    }
  }
);

// GET /api/v1/voyages - Rechercher des trajets
router.get(
  "/",
  [
    query("origine").optional().notEmpty().withMessage("L'origine est requise"),
    query("destination").optional().notEmpty().withMessage("La destination est requise"),
    query("date").optional().isISO8601().withMessage("La date doit être au format ISO"),
    query("passagers").optional().isInt({ min: 1 }).withMessage("Le nombre de passagers doit être >= 1")
  ],
  validate,
  async (req: Request, res: Response, next: NextFunction) => {
    const tenantId = req.tenantId;
    if (!tenantId) {
      return res.status(401).json({ success: false, message: "Tenant non identifié" });
    }

    try {
      const { origine, destination, date, passagers } = req.query;
      const passengerCount = Number(passagers) || 1;
      const result = await pool.query<{
        id: string;
        origin: string;
        destination: string;
        departure_at: Date;
        vehicle_code: string;
        capacity: number;
        status: string;
        reserved_seats: string;
      }>(
        `SELECT d.id, d.origin, d.destination, d.departure_at, d.vehicle_code,
                d.capacity, d.status,
                COUNT(b.id) FILTER (WHERE b.status IN ('RESERVED', 'PAID') OR (b.status = 'HELD' AND b.hold_expires_at > NOW())) AS reserved_seats
         FROM departures d
         LEFT JOIN bookings b ON b.departure_id = d.id AND b.tenant_id = d.tenant_id
         WHERE d.tenant_id = $1
           AND d.status = 'SCHEDULED'
           AND d.departure_at > NOW()
           AND ($2::text IS NULL OR LOWER(d.origin) = LOWER($2))
           AND ($3::text IS NULL OR LOWER(d.destination) = LOWER($3))
           AND ($4::date IS NULL OR d.departure_at::date = $4::date)
         GROUP BY d.id
         HAVING d.capacity - COUNT(b.id) FILTER (WHERE b.status IN ('RESERVED', 'PAID') OR (b.status = 'HELD' AND b.hold_expires_at > NOW())) >= $5
         ORDER BY d.departure_at
         LIMIT 100`,
        [
          tenantId,
          typeof origine === "string" ? origine.trim() : null,
          typeof destination === "string" ? destination.trim() : null,
          typeof date === "string" ? date : null,
          passengerCount
        ]
      );

      return res.json({
        success: true,
        data: {
          trajets: result.rows.map((departure) => ({
            id: departure.id,
            origine: departure.origin,
            destination: departure.destination,
            heureDepart: departure.departure_at,
            véhicule: departure.vehicle_code,
            capacité: departure.capacity,
            placesRéservées: Number(departure.reserved_seats),
            placesDisponibles: departure.capacity - Number(departure.reserved_seats),
            statut: departure.status
          })),
          filters: { origine, destination, date, passagers },
          count: result.rowCount
        }
      });
    } catch (error) {
      return next(error);
    }
  }
);

// POST /api/v1/voyages - Créer un nouveau départ
router.post(
  "/",
  async (_req: Request, res: Response) => {
    return res.status(501).json({
      success: false,
      message: "Cette création avancée n'est pas encore implémentée. Utilisez POST /api/v1/voyages/departures."
    });
  }
);

// GET /api/v1/voyages/:id - Obtenir un départ par ID
router.get(
  "/:id",
  [
    param("id").isUUID().withMessage("L'ID du départ est invalide")
  ],
  validate,
  async (req: Request, res: Response, next: NextFunction) => {
    const tenantId = req.tenantId;
    if (!tenantId) {
      return res.status(401).json({ success: false, message: "Tenant non identifié" });
    }

    try {
      const result = await pool.query<{
        id: string;
        origin: string;
        destination: string;
        departure_at: Date;
        vehicle_code: string;
        capacity: number;
        status: string;
        reserved_seats: string;
      }>(
        `SELECT d.id, d.origin, d.destination, d.departure_at, d.vehicle_code,
                d.capacity, d.status,
                COUNT(b.id) FILTER (WHERE b.status IN ('RESERVED', 'PAID') OR (b.status = 'HELD' AND b.hold_expires_at > NOW())) AS reserved_seats
         FROM departures d
         LEFT JOIN bookings b ON b.departure_id = d.id AND b.tenant_id = d.tenant_id
         WHERE d.id = $1 AND d.tenant_id = $2
         GROUP BY d.id`,
        [req.params.id, tenantId]
      );
      const departure = result.rows[0];
      if (!departure) {
        return res.status(404).json({ success: false, message: "Départ introuvable" });
      }

      return res.json({
        success: true,
        data: {
          id: departure.id,
          origine: departure.origin,
          destination: departure.destination,
          heureDepart: departure.departure_at,
          véhicule: departure.vehicle_code,
          capacité: departure.capacity,
          placesRéservées: Number(departure.reserved_seats),
          placesDisponibles: Math.max(0, departure.capacity - Number(departure.reserved_seats)),
          statut: departure.status
        }
      });
    } catch (error) {
      return next(error);
    }
  }
);

export default router;