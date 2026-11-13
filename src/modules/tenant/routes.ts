import { NextFunction, Request, Response, Router } from "express";
import { body, query, validationResult } from "express-validator";
import { pool } from "../../db/pool";
import { authorize } from "../../middleware/auth";

const router = Router();

const validate = (req: Request, res: Response, next: NextFunction) => {
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

router.get("/", async (req: Request, res: Response, next: NextFunction) => {
  const tenantId = req.tenantId;
  if (!tenantId) {
    return res.status(401).json({ success: false, message: "Tenant non identifié" });
  }

  try {
    const result = await pool.query<{
      id: string;
      name: string;
      siret: string | null;
      created_at: Date;
    }>(
      `SELECT id, name, siret, created_at
       FROM tenants
       WHERE id = $1`,
      [tenantId]
    );
    const tenant = result.rows[0];
    if (!tenant) {
      return res.status(404).json({ success: false, message: "Entreprise introuvable" });
    }

    return res.json({
      success: true,
      data: {
        id: tenant.id,
        name: tenant.name,
        siret: tenant.siret,
        createdAt: tenant.created_at,
        status: "active"
      }
    });
  } catch (error) {
    return next(error);
  }
});

router.put(
  "/",
  authorize(["administrateur"]),
  [
    body("name").optional().isString().trim().notEmpty().withMessage("Le nom ne peut pas être vide"),
    body("siret").optional({ nullable: true }).isString().trim()
      .isLength({ max: 32 }).withMessage("Le SIRET ne peut pas dépasser 32 caractères")
  ],
  validate,
  async (req: Request, res: Response, next: NextFunction) => {
    const tenantId = req.tenantId;
    if (!tenantId) {
      return res.status(401).json({ success: false, message: "Tenant non identifié" });
    }
    if (!Object.hasOwn(req.body, "name") && !Object.hasOwn(req.body, "siret")) {
      return res.status(400).json({
        success: false,
        message: "Au moins un champ name ou siret doit être fourni"
      });
    }

    try {
      const hasName = Object.hasOwn(req.body, "name");
      const hasSiret = Object.hasOwn(req.body, "siret");
      const result = await pool.query<{
        id: string;
        name: string;
        siret: string | null;
      }>(
        `UPDATE tenants
         SET name = CASE WHEN $2 THEN $3 ELSE name END,
             siret = CASE WHEN $4 THEN $5 ELSE siret END
         WHERE id = $1
         RETURNING id, name, siret`,
        [
          tenantId,
          hasName,
          hasName ? String(req.body.name).trim() : null,
          hasSiret,
          hasSiret && req.body.siret !== null ? String(req.body.siret).trim() : null
        ]
      );
      const tenant = result.rows[0];
      if (!tenant) {
        return res.status(404).json({ success: false, message: "Entreprise introuvable" });
      }

      return res.json({
        success: true,
        data: tenant,
        message: "Paramètres de l'entreprise mis à jour"
      });
    } catch (error) {
      return next(error);
    }
  }
);

router.get(
  "/users",
  authorize(["administrateur"]),
  [
    query("page").optional().isInt({ min: 1 }),
    query("limit").optional().isInt({ min: 1, max: 100 })
  ],
  validate,
  async (req: Request, res: Response, next: NextFunction) => {
    const tenantId = req.tenantId;
    if (!tenantId) {
      return res.status(401).json({ success: false, message: "Tenant non identifié" });
    }

    try {
      const page = Number(req.query.page) || 1;
      const limit = Number(req.query.limit) || 10;
      const offset = (page - 1) * limit;
      const [users, total] = await Promise.all([
        pool.query<{
          id: string;
          name: string;
          email: string;
          role: string;
          created_at: Date;
        }>(
          `SELECT id, name, email, role, created_at
           FROM users
           WHERE tenant_id = $1
           ORDER BY created_at, id
           LIMIT $2 OFFSET $3`,
          [tenantId, limit, offset]
        ),
        pool.query<{ total: string }>(
          "SELECT COUNT(*) AS total FROM users WHERE tenant_id = $1",
          [tenantId]
        )
      ]);

      return res.json({
        success: true,
        data: {
          users: users.rows.map((user) => ({
            id: user.id,
            name: user.name,
            email: user.email,
            role: user.role,
            createdAt: user.created_at
          })),
          pagination: { page, limit, total: Number(total.rows[0].total) }
        }
      });
    } catch (error) {
      return next(error);
    }
  }
);

export default router;
