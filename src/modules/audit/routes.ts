import { NextFunction, Request, Response, Router } from "express";
import { authorizePermission } from "../../middleware/rbac";
import { body, query, validationResult } from "express-validator";
import { pool } from "../../db/pool";

const router = Router();

// Les comptes applicatifs disponibles sont actuellement administrateurs d'entreprise.
router.use((req, res, next) => {
  const permission = req.method === "GET" ? "audit.read" : "audit.manage";
  return authorizePermission(permission)(req, res, next);
});

const eventTypes = [
  "création",
  "modification",
  "suppression",
  "connexion",
  "déconnexion",
  "transfert",
  "paiement"
] as const;

const validate = (req: Request, res: Response, next: NextFunction) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({
      success: false,
      message: "Données invalides",
      errors: errors.array()
    });
  }
  return next();
};

const dateFilters = [
  query("dateDébut").optional().isISO8601().withMessage("Date de début invalide"),
  query("dateFin").optional().isISO8601().withMessage("Date de fin invalide"),
  query("type").optional().isIn(eventTypes).withMessage("Type d'événement invalide")
];

const getDateRange = (req: Request) => ({
  startDate: typeof req.query.dateDébut === "string" ? req.query.dateDébut : null,
  endDate: typeof req.query.dateFin === "string" ? req.query.dateFin : null
});

// POST /api/v1/audit/evenement
router.post(
  "/evenement",
  [
    body("type").isIn(eventTypes).withMessage("Type d'événement invalide"),
    body("sujet").isString().trim().notEmpty().withMessage("Le sujet est requis"),
    body("action").isString().trim().notEmpty().withMessage("L'action est requise"),
    body("details").optional().isObject().withMessage("Les détails doivent être un objet")
  ],
  validate,
  async (req: Request, res: Response, next: NextFunction) => {
    const tenantId = req.tenantId;
    if (!tenantId) {
      return res.status(401).json({ success: false, message: "Tenant non identifié" });
    }

    try {
      const result = await pool.query(
        `INSERT INTO audit_events
           (tenant_id, actor_user_id, type, subject, action, details)
         VALUES ($1, $2, $3, $4, $5, $6::jsonb)
         RETURNING id, tenant_id AS "tenantId", type, subject AS sujet,
                   action, details, created_at AS horodatage`,
        [
          tenantId,
          req.user?.id || null,
          req.body.type,
          req.body.sujet.trim(),
          req.body.action.trim(),
          JSON.stringify(req.body.details || {})
        ]
      );

      return res.status(201).json({
        success: true,
        data: result.rows[0],
        message: "Événement d'audit enregistré avec succès"
      });
    } catch (error) {
      return next(error);
    }
  }
);

// GET /api/v1/audit
router.get(
  "/",
  dateFilters,
  validate,
  async (req: Request, res: Response, next: NextFunction) => {
    const tenantId = req.tenantId;
    if (!tenantId) {
      return res.status(401).json({ success: false, message: "Tenant non identifié" });
    }

    const { startDate, endDate } = getDateRange(req);
    const type = typeof req.query.type === "string" ? req.query.type : null;

    try {
      const result = await pool.query(
        `SELECT id, type, subject AS sujet, action, details,
                created_at AS horodatage
         FROM audit_events
         WHERE tenant_id = $1
           AND ($2::text IS NULL OR type = $2)
           AND ($3::date IS NULL OR created_at >= $3::date)
           AND ($4::date IS NULL OR created_at < $4::date + INTERVAL '1 day')
         ORDER BY created_at DESC, id DESC
         LIMIT 500`,
        [tenantId, type, startDate, endDate]
      );

      return res.json({
        success: true,
        data: { evenements: result.rows }
      });
    } catch (error) {
      return next(error);
    }
  }
);

// GET /api/v1/audit/rapport
router.get(
  "/rapport",
  [
    query("dateDébut").optional().isISO8601().withMessage("Date de début invalide"),
    query("dateFin").optional().isISO8601().withMessage("Date de fin invalide")
  ],
  validate,
  async (req: Request, res: Response, next: NextFunction) => {
    const tenantId = req.tenantId;
    if (!tenantId) {
      return res.status(401).json({ success: false, message: "Tenant non identifié" });
    }

    const { startDate, endDate } = getDateRange(req);

    try {
      const result = await pool.query<{ type: string; count: number }>(
        `SELECT type, COUNT(*)::int AS count
         FROM audit_events
         WHERE tenant_id = $1
           AND ($2::date IS NULL OR created_at >= $2::date)
           AND ($3::date IS NULL OR created_at < $3::date + INTERVAL '1 day')
         GROUP BY type
         ORDER BY type`,
        [tenantId, startDate, endDate]
      );

      const parType = Object.fromEntries(
        result.rows.map((row) => [row.type, row.count])
      );
      const totalEvenements = result.rows.reduce((total, row) => total + row.count, 0);

      return res.json({
        success: true,
        data: {
          tenantId,
          periode: {
            debut: startDate,
            fin: endDate
          },
          resume: {
            totalEvenements,
            parType
          }
        }
      });
    } catch (error) {
      return next(error);
    }
  }
);

// POST /api/v1/audit/anti-fraude
router.post(
  "/anti-fraude",
  [
    body("analyse").isObject().withMessage("L'analyse doit être un objet"),
    body("analyse.suspiciousActivities").optional().isArray(),
    body("analyse.seatsConflict").optional().isBoolean()
  ],
  validate,
  (req: Request, res: Response) => {
    if (!req.tenantId) {
      return res.status(401).json({ success: false, message: "Tenant non identifié" });
    }

    const analyse = req.body.analyse as {
      suspiciousActivities?: unknown[];
      seatsConflict?: boolean;
    };

    return res.json({
      success: true,
      data: {
        tenantId: req.tenantId,
        analyseEffectuee: new Date().toISOString(),
        activitesSuspectes: analyse.suspiciousActivities || [],
        conflitsSiege: analyse.seatsConflict || false
      }
    });
  }
);

export default router;
