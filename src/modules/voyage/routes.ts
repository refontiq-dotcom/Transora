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

const router = Router();

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

// Tarifs par trajet : les prix sont définis par l'entreprise et calculés côté serveur.
router.get(
  "/fares",
  async (req: Request, res: Response, next: NextFunction) => {
    const tenantId = req.tenantId;
    if (!tenantId) return res.status(401).json({ success: false, message: "Tenant non identifié" });
    try {
      const result = await pool.query(
        `SELECT id, origin, destination, amount_fcfa AS "amountFcfa", active, updated_at AS "updatedAt"
         FROM route_fares WHERE tenant_id = $1 ORDER BY origin_key, destination_key`,
        [tenantId]
      );
      return res.json({ success: true, data: { fares: result.rows } });
    } catch (error) { return next(error); }
  }
);

router.put(
  "/fares",
  [
    body("origin").isString().trim().isLength({ min: 2, max: 100 }),
    body("destination").isString().trim().isLength({ min: 2, max: 100 }),
    body("amountFcfa").isInt({ min: 1, max: 100000000 })
  ],
  validate,
  async (req: Request, res: Response, next: NextFunction) => {
    const tenantId = req.tenantId;
    if (!tenantId) return res.status(401).json({ success: false, message: "Tenant non identifié" });
    if (req.user?.role !== "administrateur") return res.status(403).json({ success: false, message: "Seul un administrateur peut gérer les tarifs" });
    try {
      const { origin, destination, amountFcfa } = req.body;
      const result = await pool.query(
        `INSERT INTO route_fares (tenant_id, origin, destination, amount_fcfa, active)
         VALUES ($1, $2, $3, $4, TRUE)
         ON CONFLICT (tenant_id, origin_key, destination_key)
         DO UPDATE SET origin = EXCLUDED.origin, destination = EXCLUDED.destination,
                       amount_fcfa = EXCLUDED.amount_fcfa, active = TRUE, updated_at = NOW()
         RETURNING id, origin, destination, amount_fcfa AS "amountFcfa", active, updated_at AS "updatedAt"` ,
        [tenantId, origin.trim(), destination.trim(), Number(amountFcfa)]
      );
      return res.json({ success: true, data: { fare: result.rows[0] }, message: "Tarif enregistré" });
    } catch (error) { return next(error); }
  }
);
router.post(
  "/departures",
  [
    body("origin").isString().trim().notEmpty(),
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
      const { origin, destination, departureAt, vehicleCode, capacity, status } = req.body;
      const result = await pool.query(
        `INSERT INTO departures
           (tenant_id, origin, destination, departure_at, vehicle_code, capacity, status)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         RETURNING id, origin, destination, departure_at AS "departureAt",
                   vehicle_code AS "vehicleCode", capacity, status`,
        [
          tenantId,
          origin.trim(),
          destination.trim(),
          departureAt,
          vehicleCode.trim(),
          Number(capacity),
          status || "SCHEDULED"
        ]
      );
      return res.status(201).json({ success: true, data: result.rows[0] });
    } catch (error) {
      return next(error);
    }
  }
);

router.post(
  "/departures/:id/bookings",
  [
    param("id").isUUID(),
    body("passengerName").isString().trim().notEmpty()
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
      const departure = await client.query<{ capacity: number; origin: string; destination: string }>(
        `SELECT capacity, origin, destination FROM departures
         WHERE id = $1 AND tenant_id = $2 AND status = 'SCHEDULED'
           AND departure_at > NOW()
         FOR UPDATE`,
        [id, tenantId]
      );
      if (departure.rowCount === 0) {
        await client.query("ROLLBACK");
        transactionStarted = false;
        return res.status(404).json({
          success: false,
          message: "Départ introuvable ou non disponible"
        });
      }

      const fareResult = await client.query<{ amount_fcfa: number }>(
        `SELECT amount_fcfa FROM route_fares
         WHERE tenant_id = $1 AND origin_key = LOWER(BTRIM($2))
           AND destination_key = LOWER(BTRIM($3)) AND active = TRUE
         FOR SHARE`,
        [tenantId, departure.rows[0].origin, departure.rows[0].destination]
      );
      const fare = fareResult.rows[0];
      if (!fare) {
        await client.query("ROLLBACK");
        transactionStarted = false;
        return res.status(409).json({
          success: false,
          message: "Aucun tarif actif n'est configuré pour ce trajet. Enregistrez d'abord son tarif."
        });
      }
      const reservations = await client.query<{ count: number }>(
        `SELECT COUNT(*)::int AS count FROM bookings
         WHERE departure_id = $1 AND tenant_id = $2 AND status <> 'CANCELLED'`,
        [id, tenantId]
      );
      if (reservations.rows[0].count >= departure.rows[0].capacity) {
        await client.query("ROLLBACK");
        transactionStarted = false;
        return res.status(409).json({
          success: false,
          message: "Ce départ est complet"
        });
      }

      const booking = await client.query(
        `INSERT INTO bookings
           (tenant_id, departure_id, passenger_name, amount_transport, platform_fee)
         VALUES ($1, $2, $3, $4, 100)
         RETURNING id, departure_id AS "departureId", passenger_name AS "passengerName",
                   amount_transport AS "amountTransport", platform_fee AS "platformFee",
                   status, created_at AS "createdAt"` ,
        [tenantId, id, passengerName.trim(), Number(fare.amount_fcfa)]
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
        status: string;
        reserved_seats: string;
        transport_fare: number | null;
      }>(
        `SELECT d.id, d.origin, d.destination, d.departure_at, d.vehicle_code,
                d.capacity, d.status, f.amount_fcfa AS transport_fare,
                COUNT(b.id) FILTER (WHERE b.status IN ('RESERVED', 'PAID')) AS reserved_seats
         FROM departures d
         LEFT JOIN route_fares f ON f.tenant_id = d.tenant_id
           AND f.origin_key = LOWER(BTRIM(d.origin))
           AND f.destination_key = LOWER(BTRIM(d.destination)) AND f.active = TRUE
         LEFT JOIN bookings b ON b.departure_id = d.id AND b.tenant_id = d.tenant_id
         WHERE d.tenant_id = $1
           AND d.departure_at >= CURRENT_DATE
           AND ($2::date IS NULL OR d.departure_at::date = $2::date)
           AND ($3::text IS NULL OR d.status = $3)
           AND ($4::text IS NULL OR
             d.origin ILIKE '%' || $4 || '%' OR
             d.destination ILIKE '%' || $4 || '%' OR
             d.vehicle_code ILIKE '%' || $4 || '%')
         GROUP BY d.id, f.amount_fcfa
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
              reservedSeats,
              availableSeats: Math.max(0, departure.capacity - reservedSeats),
              occupancyRate: departure.capacity === 0
                ? 0
                : Math.round((reservedSeats / departure.capacity) * 100),
              status: departure.status,
              transportFare: departure.transport_fare === null ? null : Number(departure.transport_fare)
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
        transport_fare: number | null;
      }>(
        `SELECT d.id, d.origin, d.destination, d.departure_at, d.vehicle_code,
                d.capacity, d.status, f.amount_fcfa AS transport_fare,
                COUNT(b.id) FILTER (WHERE b.status IN ('RESERVED', 'PAID')) AS reserved_seats
         FROM departures d
         LEFT JOIN route_fares f ON f.tenant_id = d.tenant_id
           AND f.origin_key = LOWER(BTRIM(d.origin))
           AND f.destination_key = LOWER(BTRIM(d.destination)) AND f.active = TRUE
         LEFT JOIN bookings b ON b.departure_id = d.id AND b.tenant_id = d.tenant_id
         WHERE d.tenant_id = $1
           AND d.status = 'SCHEDULED'
           AND d.departure_at > NOW()
           AND ($2::text IS NULL OR LOWER(d.origin) = LOWER($2))
           AND ($3::text IS NULL OR LOWER(d.destination) = LOWER($3))
           AND ($4::date IS NULL OR d.departure_at::date = $4::date)
         GROUP BY d.id, f.amount_fcfa
         HAVING d.capacity - COUNT(b.id) FILTER (WHERE b.status IN ('RESERVED', 'PAID')) >= $5
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
            tarifTransport: departure.transport_fare === null ? null : Number(departure.transport_fare),
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
                COUNT(b.id) FILTER (WHERE b.status IN ('RESERVED', 'PAID')) AS reserved_seats
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