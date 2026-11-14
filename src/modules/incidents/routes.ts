import { NextFunction, Request, Response, Router } from "express";
import { body, param, query, validationResult } from "express-validator";
import { pool } from "../../db/pool";
import { authorize } from "../../middleware/auth";

const router = Router();
const staffRoles = ["administrateur", "superviseur", "conducteur", "mécanicien", "agent_acceuil", "caissier"];
const reportIncident = authorize(staffRoles);
const manageIncidents = authorize(["administrateur", "superviseur"]);
const types = ["panne", "accident", "retard", "absence_chauffeur", "probleme_passager", "bagage", "billet", "paiement", "caisse"];
const severities = ["faible", "moyenne", "eleve", "critique"];
const statuses = ["OUVERT", "EN_COURS", "RESOLU", "CLOTURÉ"];

const validate = (req: Request, res: Response, next: NextFunction) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ success: false, message: "Données invalides", errors: errors.array() });
  }
  next();
};

router.post(
  "/",
  reportIncident,
  [
    body("type").isIn(types),
    body("description").isString().trim().notEmpty().isLength({ max: 5000 }),
    body("gravite").optional().isIn(severities),
    body("vehiculeId").optional({ nullable: true }).isUUID(),
    body("departureId").optional({ nullable: true }).isUUID()
  ],
  validate,
  async (req: Request, res: Response, next: NextFunction) => {
    if (!req.tenantId || !req.user) {
      return res.status(401).json({ success: false, message: "Utilisateur ou tenant non identifié" });
    }

    try {
      if (req.body.vehiculeId) {
        const vehicle = await pool.query(
          "SELECT 1 FROM vehicles WHERE id = $1 AND tenant_id = $2 AND deleted_at IS NULL",
          [req.body.vehiculeId, req.tenantId]
        );
        if (!vehicle.rowCount) {
          return res.status(404).json({ success: false, message: "Véhicule introuvable" });
        }
      }
      if (req.body.departureId) {
        const departure = await pool.query(
          "SELECT 1 FROM departures WHERE id = $1 AND tenant_id = $2",
          [req.body.departureId, req.tenantId]
        );
        if (!departure.rowCount) {
          return res.status(404).json({ success: false, message: "Départ introuvable" });
        }
      }

      const result = await pool.query(
        `INSERT INTO incidents
           (tenant_id, type, description, severity, vehicle_id, departure_id, reported_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         RETURNING id, type, description, severity AS "gravite", status AS "statut",
                   vehicle_id AS "vehiculeId", departure_id AS "departureId",
                   reported_by AS "signalePar", created_at AS "signaleLe"`,
        [
          req.tenantId, req.body.type, String(req.body.description).trim(),
          req.body.gravite || "moyenne", req.body.vehiculeId || null,
          req.body.departureId || null, req.user.id
        ]
      );
      return res.status(201).json({ success: true, data: result.rows[0] });
    } catch (error) {
      return next(error);
    }
  }
);

router.get(
  "/",
  reportIncident,
  [
    query("type").optional().isIn(types),
    query("statut").optional().isIn(statuses),
    query("gravite").optional().isIn(severities)
  ],
  validate,
  async (req: Request, res: Response, next: NextFunction) => {
    if (!req.tenantId) {
      return res.status(401).json({ success: false, message: "Tenant non identifié" });
    }
    try {
      const result = await pool.query(
        `SELECT id, type, description, severity AS "gravite", status AS "statut",
                vehicle_id AS "vehiculeId", departure_id AS "departureId",
                reported_by AS "signalePar", resolution_comments AS "commentairesRésolution",
                created_at AS "signaleLe", updated_at AS "misAJourLe",
                resolved_at AS "resoluLe"
         FROM incidents
         WHERE tenant_id = $1
           AND ($2::text IS NULL OR type = $2)
           AND ($3::text IS NULL OR status = $3)
           AND ($4::text IS NULL OR severity = $4)
         ORDER BY created_at DESC
         LIMIT 200`,
        [req.tenantId, req.query.type || null, req.query.statut || null, req.query.gravite || null]
      );
      return res.json({ success: true, data: { incidents: result.rows, count: result.rowCount } });
    } catch (error) {
      return next(error);
    }
  }
);

router.get(
  "/:id",
  reportIncident,
  [param("id").isUUID()],
  validate,
  async (req: Request, res: Response, next: NextFunction) => {
    if (!req.tenantId) {
      return res.status(401).json({ success: false, message: "Tenant non identifié" });
    }
    try {
      const result = await pool.query(
        `SELECT id, type, description, severity AS "gravite", status AS "statut",
                vehicle_id AS "vehiculeId", departure_id AS "departureId",
                reported_by AS "signalePar", resolution_comments AS "commentairesRésolution",
                created_at AS "signaleLe", updated_at AS "misAJourLe",
                resolved_at AS "resoluLe"
         FROM incidents WHERE id = $1 AND tenant_id = $2`,
        [req.params.id, req.tenantId]
      );
      if (!result.rowCount) {
        return res.status(404).json({ success: false, message: "Incident introuvable" });
      }
      return res.json({ success: true, data: result.rows[0] });
    } catch (error) {
      return next(error);
    }
  }
);

router.put(
  "/:id",
  manageIncidents,
  [
    param("id").isUUID(),
    body("statut").optional().isIn(statuses),
    body("gravite").optional().isIn(severities),
    body("commentairesRésolution").optional({ nullable: true }).isString().isLength({ max: 5000 })
  ],
  validate,
  async (req: Request, res: Response, next: NextFunction) => {
    if (!req.tenantId) {
      return res.status(401).json({ success: false, message: "Tenant non identifié" });
    }
    const fields = ["statut", "gravite", "commentairesRésolution"];
    if (!fields.some((field) => Object.hasOwn(req.body, field))) {
      return res.status(400).json({ success: false, message: "Aucune donnée à mettre à jour" });
    }
    try {
      const has = (field: string) => Object.hasOwn(req.body, field);
      const result = await pool.query(
        `UPDATE incidents
         SET status = CASE WHEN $3 THEN $4 ELSE status END,
             severity = CASE WHEN $5 THEN $6 ELSE severity END,
             resolution_comments = CASE WHEN $7 THEN $8 ELSE resolution_comments END,
             resolved_at = CASE
               WHEN $3 AND $4 IN ('RESOLU', 'CLOTURÉ') THEN COALESCE(resolved_at, NOW())
               WHEN $3 AND $4 NOT IN ('RESOLU', 'CLOTURÉ') THEN NULL
               ELSE resolved_at
             END,
             updated_at = NOW()
         WHERE id = $1 AND tenant_id = $2
         RETURNING id, type, description, severity AS "gravite", status AS "statut",
                   vehicle_id AS "vehiculeId", departure_id AS "departureId",
                   resolution_comments AS "commentairesRésolution",
                   updated_at AS "misAJourLe", resolved_at AS "resoluLe"`,
        [
          req.params.id, req.tenantId,
          has("statut"), req.body.statut ?? null,
          has("gravite"), req.body.gravite ?? null,
          has("commentairesRésolution"), req.body.commentairesRésolution ?? null
        ]
      );
      if (!result.rowCount) {
        return res.status(404).json({ success: false, message: "Incident introuvable" });
      }
      return res.json({ success: true, data: result.rows[0] });
    } catch (error) {
      return next(error);
    }
  }
);

export default router;
