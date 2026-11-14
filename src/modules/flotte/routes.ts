import { NextFunction, Request, Response, Router } from "express";
import { authorizePermission } from "../../middleware/rbac";
import { body, param, query, validationResult } from "express-validator";
import { pool } from "../../db/pool";

const router = Router();

// Les comptes applicatifs disponibles sont actuellement administrateurs d'entreprise.
router.use(authorizePermission("fleet.manage"));
const statuses = ["disponible", "en_service", "en_maintenance", "hors_service"];

const validate = (req: Request, res: Response, next: NextFunction) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ success: false, message: "Données invalides", errors: errors.array() });
  }
  next();
};

router.post(
  "/",
  [
    body("immatriculation").isString().trim().notEmpty().isLength({ max: 32 }),
    body("modele").isString().trim().notEmpty().isLength({ max: 120 }),
    body("capacite").isInt({ min: 1, max: 500 }),
    body("annee").optional({ nullable: true }).isInt({ min: 1900, max: 2100 }),
    body("statut").optional().isIn(statuses)
  ],
  validate,
  async (req: Request, res: Response, next: NextFunction) => {
    if (!req.tenantId) {
      return res.status(401).json({ success: false, message: "Tenant non identifié" });
    }

    try {
      const result = await pool.query(
        `INSERT INTO vehicles (tenant_id, registration, model, capacity, manufacture_year, status)
         VALUES ($1, $2, $3, $4, $5, $6)
         RETURNING id, registration AS "immatriculation", model AS "modele",
                   capacity AS "capacite", manufacture_year AS "annee", status AS "statut",
                   created_at AS "crééLe"`,
        [
          req.tenantId,
          String(req.body.immatriculation).trim().toUpperCase(),
          String(req.body.modele).trim(),
          Number(req.body.capacite),
          req.body.annee ?? null,
          req.body.statut || "disponible"
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
  [query("statut").optional().isIn(statuses)],
  validate,
  async (req: Request, res: Response, next: NextFunction) => {
    if (!req.tenantId) {
      return res.status(401).json({ success: false, message: "Tenant non identifié" });
    }

    try {
      const result = await pool.query(
        `SELECT id, registration AS "immatriculation", model AS "modele",
                capacity AS "capacite", manufacture_year AS "annee", status AS "statut",
                created_at AS "crééLe", updated_at AS "misAJourLe"
         FROM vehicles
         WHERE tenant_id = $1 AND deleted_at IS NULL
           AND ($2::text IS NULL OR status = $2)
         ORDER BY registration`,
        [req.tenantId, req.query.statut || null]
      );
      return res.json({ success: true, data: { vehicules: result.rows, count: result.rowCount } });
    } catch (error) {
      return next(error);
    }
  }
);

router.get(
  "/:id",
  [param("id").isUUID()],
  validate,
  async (req: Request, res: Response, next: NextFunction) => {
    if (!req.tenantId) {
      return res.status(401).json({ success: false, message: "Tenant non identifié" });
    }

    try {
      const result = await pool.query(
        `SELECT id, registration AS "immatriculation", model AS "modele",
                capacity AS "capacite", manufacture_year AS "annee", status AS "statut",
                created_at AS "crééLe", updated_at AS "misAJourLe"
         FROM vehicles WHERE id = $1 AND tenant_id = $2 AND deleted_at IS NULL`,
        [req.params.id, req.tenantId]
      );
      if (!result.rowCount) {
        return res.status(404).json({ success: false, message: "Véhicule introuvable" });
      }
      return res.json({ success: true, data: result.rows[0] });
    } catch (error) {
      return next(error);
    }
  }
);

router.put(
  "/:id",
  [
    param("id").isUUID(),
    body("immatriculation").optional().isString().trim().notEmpty().isLength({ max: 32 }),
    body("modele").optional().isString().trim().notEmpty().isLength({ max: 120 }),
    body("capacite").optional().isInt({ min: 1, max: 500 }),
    body("annee").optional({ nullable: true }).isInt({ min: 1900, max: 2100 }),
    body("statut").optional().isIn(statuses)
  ],
  validate,
  async (req: Request, res: Response, next: NextFunction) => {
    if (!req.tenantId) {
      return res.status(401).json({ success: false, message: "Tenant non identifié" });
    }
    const fields = ["immatriculation", "modele", "capacite", "annee", "statut"];
    if (!fields.some((field) => Object.hasOwn(req.body, field))) {
      return res.status(400).json({ success: false, message: "Aucune donnée à mettre à jour" });
    }

    try {
      const has = (field: string) => Object.hasOwn(req.body, field);
      const result = await pool.query(
        `UPDATE vehicles
         SET registration = CASE WHEN $3 THEN UPPER(TRIM($4)) ELSE registration END,
             model = CASE WHEN $5 THEN TRIM($6) ELSE model END,
             capacity = CASE WHEN $7 THEN $8::integer ELSE capacity END,
             manufacture_year = CASE WHEN $9 THEN $10::integer ELSE manufacture_year END,
             status = CASE WHEN $11 THEN $12 ELSE status END,
             updated_at = NOW()
         WHERE id = $1 AND tenant_id = $2 AND deleted_at IS NULL
         RETURNING id, registration AS "immatriculation", model AS "modele",
                   capacity AS "capacite", manufacture_year AS "annee", status AS "statut",
                   updated_at AS "misAJourLe"`,
        [
          req.params.id, req.tenantId,
          has("immatriculation"), req.body.immatriculation ?? null,
          has("modele"), req.body.modele ?? null,
          has("capacite"), req.body.capacite ?? null,
          has("annee"), req.body.annee ?? null,
          has("statut"), req.body.statut ?? null
        ]
      );
      if (!result.rowCount) {
        return res.status(404).json({ success: false, message: "Véhicule introuvable" });
      }
      return res.json({ success: true, data: result.rows[0] });
    } catch (error) {
      return next(error);
    }
  }
);

router.delete(
  "/:id",
  [param("id").isUUID()],
  validate,
  async (req: Request, res: Response, next: NextFunction) => {
    if (!req.tenantId) {
      return res.status(401).json({ success: false, message: "Tenant non identifié" });
    }
    try {
      const result = await pool.query(
        `UPDATE vehicles SET deleted_at = NOW(), updated_at = NOW()
         WHERE id = $1 AND tenant_id = $2 AND deleted_at IS NULL
         RETURNING id`,
        [req.params.id, req.tenantId]
      );
      if (!result.rowCount) {
        return res.status(404).json({ success: false, message: "Véhicule introuvable" });
      }
      return res.json({ success: true, data: { id: req.params.id, deleted: true } });
    } catch (error) {
      return next(error);
    }
  }
);

export default router;
