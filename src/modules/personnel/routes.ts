import { NextFunction, Request, Response, Router } from "express";
import { body, param, query, validationResult } from "express-validator";
import { pool } from "../../db/pool";

const router = Router();
const roles = ["conducteur", "mécanicien", "agent_acceuil", "superviseur", "administrateur"];

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
    body("nom").isString().trim().notEmpty().isLength({ max: 160 }),
    body("poste").isString().trim().notEmpty().isLength({ max: 120 }),
    body("role").optional().isIn(roles),
    body("telephone").optional({ nullable: true }).isString().trim().isLength({ max: 40 }),
    body("email").optional({ nullable: true }).isEmail().normalizeEmail(),
    body("dateEmbauche").optional({ nullable: true }).isISO8601()
  ],
  validate,
  async (req: Request, res: Response, next: NextFunction) => {
    if (!req.tenantId) {
      return res.status(401).json({ success: false, message: "Tenant non identifié" });
    }

    try {
      const result = await pool.query(
        `INSERT INTO employees (tenant_id, name, position, role, phone, email, hire_date)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         RETURNING id, name AS "nom", position AS "poste", role, phone AS "telephone",
                   email, hire_date AS "dateEmbauche", status AS "statut",
                   created_at AS "crééLe"`,
        [
          req.tenantId, String(req.body.nom).trim(), String(req.body.poste).trim(),
          req.body.role || "conducteur", req.body.telephone?.trim() || null,
          req.body.email?.toLowerCase() || null, req.body.dateEmbauche || null
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
  [
    query("poste").optional().isString().trim().notEmpty(),
    query("role").optional().isIn(roles),
    query("statut").optional().isIn(["actif", "inactif"])
  ],
  validate,
  async (req: Request, res: Response, next: NextFunction) => {
    if (!req.tenantId) {
      return res.status(401).json({ success: false, message: "Tenant non identifié" });
    }
    try {
      const result = await pool.query(
        `SELECT id, name AS "nom", position AS "poste", role, phone AS "telephone",
                email, hire_date AS "dateEmbauche", status AS "statut",
                created_at AS "crééLe"
         FROM employees
         WHERE tenant_id = $1 AND deleted_at IS NULL
           AND ($2::text IS NULL OR position ILIKE $2)
           AND ($3::text IS NULL OR role = $3)
           AND ($4::text IS NULL OR status = $4)
         ORDER BY name`,
        [
          req.tenantId,
          typeof req.query.poste === "string" ? `%${req.query.poste.trim()}%` : null,
          req.query.role || null,
          req.query.statut || null
        ]
      );
      return res.json({ success: true, data: { employés: result.rows, count: result.rowCount } });
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
        `SELECT id, name AS "nom", position AS "poste", role, phone AS "telephone",
                email, hire_date AS "dateEmbauche", status AS "statut",
                created_at AS "crééLe", updated_at AS "misAJourLe"
         FROM employees WHERE id = $1 AND tenant_id = $2 AND deleted_at IS NULL`,
        [req.params.id, req.tenantId]
      );
      if (!result.rowCount) {
        return res.status(404).json({ success: false, message: "Employé introuvable" });
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
    body("nom").optional().isString().trim().notEmpty().isLength({ max: 160 }),
    body("poste").optional().isString().trim().notEmpty().isLength({ max: 120 }),
    body("role").optional().isIn(roles),
    body("telephone").optional({ nullable: true }).isString().trim().isLength({ max: 40 }),
    body("email").optional({ nullable: true }).isEmail().normalizeEmail(),
    body("dateEmbauche").optional({ nullable: true }).isISO8601(),
    body("statut").optional().isIn(["actif", "inactif"])
  ],
  validate,
  async (req: Request, res: Response, next: NextFunction) => {
    if (!req.tenantId) {
      return res.status(401).json({ success: false, message: "Tenant non identifié" });
    }
    const fields = ["nom", "poste", "role", "telephone", "email", "dateEmbauche", "statut"];
    if (!fields.some((field) => Object.hasOwn(req.body, field))) {
      return res.status(400).json({ success: false, message: "Aucune donnée à mettre à jour" });
    }

    try {
      const has = (field: string) => Object.hasOwn(req.body, field);
      const result = await pool.query(
        `UPDATE employees
         SET name = CASE WHEN $3 THEN TRIM($4) ELSE name END,
             position = CASE WHEN $5 THEN TRIM($6) ELSE position END,
             role = CASE WHEN $7 THEN $8 ELSE role END,
             phone = CASE WHEN $9 THEN $10 ELSE phone END,
             email = CASE WHEN $11 THEN $12 ELSE email END,
             hire_date = CASE WHEN $13 THEN $14::date ELSE hire_date END,
             status = CASE WHEN $15 THEN $16 ELSE status END,
             updated_at = NOW()
         WHERE id = $1 AND tenant_id = $2 AND deleted_at IS NULL
         RETURNING id, name AS "nom", position AS "poste", role, phone AS "telephone",
                   email, hire_date AS "dateEmbauche", status AS "statut",
                   updated_at AS "misAJourLe"`,
        [
          req.params.id, req.tenantId,
          has("nom"), req.body.nom ?? null,
          has("poste"), req.body.poste ?? null,
          has("role"), req.body.role ?? null,
          has("telephone"), req.body.telephone?.trim() || null,
          has("email"), req.body.email?.toLowerCase() || null,
          has("dateEmbauche"), req.body.dateEmbauche ?? null,
          has("statut"), req.body.statut ?? null
        ]
      );
      if (!result.rowCount) {
        return res.status(404).json({ success: false, message: "Employé introuvable" });
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
        `UPDATE employees SET deleted_at = NOW(), updated_at = NOW()
         WHERE id = $1 AND tenant_id = $2 AND deleted_at IS NULL RETURNING id`,
        [req.params.id, req.tenantId]
      );
      if (!result.rowCount) {
        return res.status(404).json({ success: false, message: "Employé introuvable" });
      }
      return res.json({ success: true, data: { id: req.params.id, deleted: true } });
    } catch (error) {
      return next(error);
    }
  }
);

export default router;
