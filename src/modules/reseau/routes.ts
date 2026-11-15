import { NextFunction, Request, Response, Router } from "express";
import { body, param, validationResult } from "express-validator";
import { PoolClient } from "pg";
import { pool } from "../../db/pool";
import { authorize } from "../../middleware/auth";

const router = Router();
const manageNetwork = authorize(["administrateur", "responsable_exploitation"]);
const validate = (req: Request, res: Response, next: NextFunction) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({
    success: false, message: "Données invalides", errors: errors.array()
  });
  next();
};
const clean = (value: string) => value.trim().replace(/\s+/g, " ");

router.get("/cities", async (req: Request, res: Response, next: NextFunction) => {
  if (!req.tenantId) return res.status(401).json({ success: false, message: "Tenant non identifié" });
  try {
    const result = await pool.query(
      `SELECT id, name, country_code AS "countryCode", created_at AS "createdAt"
       FROM company_cities WHERE tenant_id = $1 ORDER BY name`, [req.tenantId]
    );
    return res.json({ success: true, data: { cities: result.rows, count: result.rowCount } });
  } catch (error) { return next(error); }
});

router.post("/cities", manageNetwork, [
  body("name").isString().trim().isLength({ min: 2, max: 100 }),
  body("countryCode").optional().isString().isLength({ min: 2, max: 2 }).isUppercase()
], validate, async (req: Request, res: Response, next: NextFunction) => {
  if (!req.tenantId || !req.user) return res.status(401).json({ success: false, message: "Tenant non identifié" });
  try {
    const result = await pool.query(
      `INSERT INTO company_cities (tenant_id, name, country_code) VALUES ($1, $2, $3)
       RETURNING id, name, country_code AS "countryCode", created_at AS "createdAt"`,
      [req.tenantId, clean(req.body.name), req.body.countryCode || "CI"]
    );
    return res.status(201).json({ success: true, data: result.rows[0], message: "Ville ajoutée au réseau" });
  } catch (error) {
    if ((error as { code?: string }).code === "23505") return res.status(409).json({ success: false, message: "Cette ville existe déjà dans votre réseau" });
    return next(error);
  }
});

router.get("/stations", async (req: Request, res: Response, next: NextFunction) => {
  if (!req.tenantId) return res.status(401).json({ success: false, message: "Tenant non identifié" });
  try {
    const result = await pool.query(
      `SELECT s.id, s.name, s.code, s.address, s.is_active AS active,
              c.id AS "cityId", c.name AS city
       FROM stations s JOIN company_cities c ON c.id = s.city_id AND c.tenant_id = s.tenant_id
       WHERE s.tenant_id = $1 ORDER BY c.name, s.name`, [req.tenantId]
    );
    return res.json({ success: true, data: { stations: result.rows, count: result.rowCount } });
  } catch (error) { return next(error); }
});

router.post("/stations", manageNetwork, [
  body("cityId").isUUID(),
  body("name").isString().trim().isLength({ min: 2, max: 120 }),
  body("code").optional({ nullable: true }).isString().trim().isLength({ min: 2, max: 20 }),
  body("address").optional({ nullable: true }).isString().trim().isLength({ max: 300 })
], validate, async (req: Request, res: Response, next: NextFunction) => {
  if (!req.tenantId) return res.status(401).json({ success: false, message: "Tenant non identifié" });
  try {
    const city = await pool.query("SELECT id FROM company_cities WHERE id = $1 AND tenant_id = $2", [req.body.cityId, req.tenantId]);
    if (!city.rowCount) return res.status(404).json({ success: false, message: "Ville introuvable dans votre réseau" });
    const result = await pool.query(
      `INSERT INTO stations (tenant_id, city_id, name, code, address)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id, city_id AS "cityId", name, code, address, is_active AS active`,
      [req.tenantId, req.body.cityId, clean(req.body.name), req.body.code ? clean(req.body.code) : null, req.body.address ? clean(req.body.address) : null]
    );
    return res.status(201).json({ success: true, data: result.rows[0], message: "Gare ajoutée au réseau" });
  } catch (error) {
    if ((error as { code?: string }).code === "23505") return res.status(409).json({ success: false, message: "Une gare portant ce nom ou ce code existe déjà dans votre réseau" });
    return next(error);
  }
});

router.get("/routes", async (req: Request, res: Response, next: NextFunction) => {
  if (!req.tenantId) return res.status(401).json({ success: false, message: "Tenant non identifié" });
  try {
    const result = await pool.query(
      `SELECT r.id, r.name, r.is_active AS active,
              r.origin_station_id AS "originStationId", r.destination_station_id AS "destinationStationId",
              COALESCE(json_agg(json_build_object(
                'stationId', s.id, 'station', s.name, 'city', c.name,
                'stopOrder', rs.stop_order, 'distanceFromOriginKm', rs.distance_from_origin_km,
                'durationFromOriginMinutes', rs.duration_from_origin_minutes
              ) ORDER BY rs.stop_order) FILTER (WHERE rs.id IS NOT NULL), '[]'::json) AS stops
       FROM transport_routes r
       LEFT JOIN route_stops rs ON rs.route_id = r.id AND rs.tenant_id = r.tenant_id
       LEFT JOIN stations s ON s.id = rs.station_id AND s.tenant_id = rs.tenant_id
       LEFT JOIN company_cities c ON c.id = s.city_id AND c.tenant_id = s.tenant_id
       WHERE r.tenant_id = $1 GROUP BY r.id ORDER BY r.name`, [req.tenantId]
    );
    return res.json({ success: true, data: { routes: result.rows, count: result.rowCount } });
  } catch (error) { return next(error); }
});

router.post("/routes", manageNetwork, [
  body("name").isString().trim().isLength({ min: 2, max: 140 }),
  body("originStationId").isUUID(),
  body("destinationStationId").isUUID(),
  body("stops").isArray({ min: 2, max: 100 }),
  body("stops.*.stationId").isUUID(),
  body("stops.*.distanceFromOriginKm").isFloat({ min: 0, max: 100000 }),
  body("stops.*.durationFromOriginMinutes").isInt({ min: 0, max: 100000 })
], validate, async (req: Request, res: Response, next: NextFunction) => {
  if (!req.tenantId || !req.user) return res.status(401).json({ success: false, message: "Tenant non identifié" });
  const stops = req.body.stops as Array<{ stationId: string; distanceFromOriginKm: number; durationFromOriginMinutes: number }>;
  const ids = stops.map(stop => stop.stationId);
  if (new Set(ids).size !== ids.length) return res.status(400).json({ success: false, message: "Une gare ne peut apparaître qu'une seule fois sur une ligne" });
  if (ids[0] !== req.body.originStationId || ids[ids.length - 1] !== req.body.destinationStationId) {
    return res.status(400).json({ success: false, message: "Les arrêts doivent commencer par la gare de départ et finir par la gare d'arrivée" });
  }
  if (stops.some((stop, index) => index > 0 &&
      (Number(stop.distanceFromOriginKm) <= Number(stops[index - 1].distanceFromOriginKm) ||
       Number(stop.durationFromOriginMinutes) <= Number(stops[index - 1].durationFromOriginMinutes)))) {
    return res.status(400).json({ success: false, message: "Les distances et durées doivent augmenter strictement dans l'ordre des arrêts" });
  }

  const client: PoolClient = await pool.connect();
  try {
    await client.query("BEGIN");
    const stationRows = await client.query(
      "SELECT id FROM stations WHERE tenant_id = $1 AND is_active = TRUE AND id = ANY($2::uuid[]) FOR SHARE",
      [req.tenantId, ids]
    );
    if (stationRows.rowCount !== ids.length) {
      await client.query("ROLLBACK");
      return res.status(400).json({ success: false, message: "Toutes les gares doivent être actives et appartenir à votre compagnie" });
    }
    const routeResult = await client.query(
      `INSERT INTO transport_routes (tenant_id, name, origin_station_id, destination_station_id)
       VALUES ($1, $2, $3, $4) RETURNING id, name, origin_station_id AS "originStationId",
         destination_station_id AS "destinationStationId", is_active AS active`,
      [req.tenantId, clean(req.body.name), req.body.originStationId, req.body.destinationStationId]
    );
    const routeId = routeResult.rows[0].id as string;
    for (const [index, stop] of stops.entries()) {
      await client.query(
        `INSERT INTO route_stops
           (tenant_id, route_id, station_id, stop_order, distance_from_origin_km, duration_from_origin_minutes)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [req.tenantId, routeId, stop.stationId, index, Number(stop.distanceFromOriginKm), Number(stop.durationFromOriginMinutes)]
      );
    }
    await client.query(
      `INSERT INTO audit_events (tenant_id, actor_user_id, type, subject, action, details)
       VALUES ($1, $2, 'création', 'ligne de transport', 'Création d’une ligne', $3::jsonb)`,
      [req.tenantId, req.user.id, JSON.stringify({ routeId, name: clean(req.body.name), stops: stops.length })]
    );
    await client.query("COMMIT");
    return res.status(201).json({ success: true, data: { ...routeResult.rows[0], stops }, message: "Ligne et arrêts enregistrés" });
  } catch (error) {
    await client.query("ROLLBACK");
    if ((error as { code?: string }).code === "23505") return res.status(409).json({ success: false, message: "Une ligne portant ce nom existe déjà dans votre réseau" });
    return next(error);
  } finally { client.release(); }
});

router.get("/routes/:id", [param("id").isUUID()], validate, async (req: Request, res: Response, next: NextFunction) => {
  if (!req.tenantId) return res.status(401).json({ success: false, message: "Tenant non identifié" });
  try {
    const result = await pool.query(
      `SELECT r.id, r.name, r.is_active AS active,
              r.origin_station_id AS "originStationId", r.destination_station_id AS "destinationStationId",
              COALESCE(json_agg(json_build_object(
                'stationId', s.id, 'station', s.name, 'city', c.name,
                'stopOrder', rs.stop_order, 'distanceFromOriginKm', rs.distance_from_origin_km,
                'durationFromOriginMinutes', rs.duration_from_origin_minutes
              ) ORDER BY rs.stop_order) FILTER (WHERE rs.id IS NOT NULL), '[]'::json) AS stops
       FROM transport_routes r
       LEFT JOIN route_stops rs ON rs.route_id = r.id AND rs.tenant_id = r.tenant_id
       LEFT JOIN stations s ON s.id = rs.station_id AND s.tenant_id = rs.tenant_id
       LEFT JOIN company_cities c ON c.id = s.city_id AND c.tenant_id = s.tenant_id
       WHERE r.id = $1 AND r.tenant_id = $2 GROUP BY r.id`,
      [req.params.id, req.tenantId]
    );
    if (!result.rowCount) return res.status(404).json({ success: false, message: "Ligne introuvable dans votre compagnie" });
    return res.json({ success: true, data: result.rows[0] });
  } catch (error) { return next(error); }
});

export default router;
