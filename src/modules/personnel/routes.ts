import { NextFunction, Request, Response, Router } from "express";
import bcrypt from "bcryptjs";
import { body, param, query, validationResult } from "express-validator";
import { pool } from "../../db/pool";
import { authorize } from "../../middleware/auth";

const router = Router();
const managePersonnel = authorize(["administrateur"]);
const readPersonnel = authorize(["administrateur", "responsable_exploitation"]);
const roles = ["responsable_exploitation", "agent_guichet", "caissier", "responsable_financier", "responsable_logistique", "chauffeur", "controleur", "mécanicien", "agent_accueil", "responsable_courrier", "agent_courrier", "administrateur"];

const validate = (req: Request, res: Response, next: NextFunction) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ success: false, message: "Données invalides", errors: errors.array() });
  }
  next();
};

router.post(
  "/",
  managePersonnel,
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
          req.body.role || "chauffeur", req.body.telephone?.trim() || null,
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
  readPersonnel,
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
                email, user_id AS "compteId", hire_date AS "dateEmbauche", status AS "statut",
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
  readPersonnel,
  [param("id").isUUID()],
  validate,
  async (req: Request, res: Response, next: NextFunction) => {
    if (!req.tenantId) {
      return res.status(401).json({ success: false, message: "Tenant non identifié" });
    }
    try {
      const result = await pool.query(
        `SELECT id, name AS "nom", position AS "poste", role, phone AS "telephone",
                email, user_id AS "compteId", hire_date AS "dateEmbauche", status AS "statut",
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
  managePersonnel,
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
                   email, user_id AS "compteId", hire_date AS "dateEmbauche", status AS "statut",
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
      const employee = result.rows[0] as { compteId?: string; role: string; statut: string };
      if (employee.compteId) {
        await pool.query(
          "UPDATE users SET role = $3, is_active = $4 WHERE id = $1 AND tenant_id = $2",
          [employee.compteId, req.tenantId, employee.role, employee.statut === "actif"]
        );
        // Toute modification de rôle ou de statut invalide les anciens jetons d'accès.
        await pool.query(
          "UPDATE user_sessions SET revoked_at = NOW() WHERE user_id = $1 AND tenant_id = $2 AND revoked_at IS NULL",
          [employee.compteId, req.tenantId]
        );
      }
      return res.json({ success: true, data: result.rows[0] });
    } catch (error) {
      return next(error);
    }
  }
);

router.post(
  "/:id/compte",
  managePersonnel,
  [param("id").isUUID(), body("motDePasse").isString().isLength({ min: 12, max: 128 })],
  validate,
  async (req: Request, res: Response, next: NextFunction) => {
    if (!req.tenantId) return res.status(401).json({ success: false, message: "Tenant non identifié" });
    const client = await pool.connect();
    try {
      const passwordHash = await bcrypt.hash(String(req.body.motDePasse), 12);
      await client.query("BEGIN");
      const employee = await client.query(
        "SELECT id, name, email, role, user_id FROM employees WHERE id = $1 AND tenant_id = $2 AND deleted_at IS NULL FOR UPDATE",
        [req.params.id, req.tenantId]
      );
      if (!employee.rowCount) { await client.query("ROLLBACK"); return res.status(404).json({ success: false, message: "Employé introuvable" }); }
      const record = employee.rows[0];
      if (!record.email) { await client.query("ROLLBACK"); return res.status(400).json({ success: false, message: "Ajoutez une adresse e-mail à la fiche avant de créer son accès" }); }
      if (record.user_id) { await client.query("ROLLBACK"); return res.status(409).json({ success: false, message: "Cet employé possède déjà un compte" }); }
      const created = await client.query(
        "INSERT INTO users (tenant_id, name, email, password_hash, role) VALUES ($1, $2, $3, $4, $5) ON CONFLICT (email) DO NOTHING RETURNING id, email, role",
        [req.tenantId, record.name, record.email.toLowerCase(), passwordHash, record.role]
      );
      if (!created.rowCount) { await client.query("ROLLBACK"); return res.status(409).json({ success: false, message: "Cette adresse e-mail est déjà utilisée" }); }
      await client.query("UPDATE employees SET user_id = $3, updated_at = NOW() WHERE id = $1 AND tenant_id = $2", [req.params.id, req.tenantId, created.rows[0].id]);
      await client.query("COMMIT");
      return res.status(201).json({ success: true, data: { employeeId: req.params.id, userId: created.rows[0].id, email: created.rows[0].email, role: created.rows[0].role }, message: "Compte créé. Communiquez le mot de passe initial à l’employé par un canal privé." });
    } catch (error) { await client.query("ROLLBACK"); return next(error); }
    finally { client.release(); }
  }
);

router.delete(
  "/:id",
  managePersonnel,
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
      const linked = await pool.query("SELECT user_id FROM employees WHERE id = $1 AND tenant_id = $2", [req.params.id, req.tenantId]);
      const userId = linked.rows[0]?.user_id as string | undefined;
      if (userId) {
        await pool.query("UPDATE users SET is_active = FALSE WHERE id = $1 AND tenant_id = $2", [userId, req.tenantId]);
        await pool.query("UPDATE user_sessions SET revoked_at = NOW() WHERE user_id = $1 AND tenant_id = $2 AND revoked_at IS NULL", [userId, req.tenantId]);
      }
      return res.json({ success: true, data: { id: req.params.id, deleted: true, accountDisabled: Boolean(userId) } });
    } catch (error) {
      return next(error);
    }
  }
);

export default router;
