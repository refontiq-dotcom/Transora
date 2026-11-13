import { NextFunction, Request, Response, Router } from "express";
import { body, param, query, validationResult } from "express-validator";
import { pool } from "../../db/pool";

const router = Router();
const types = ["confirmation", "rappel", "retard", "annulation", "correspondance", "incident", "paiement"];
const recipients = ["passager", "employé", "direction", "guichetier", "controleur"];
const channels = ["sms", "whatsapp", "email", "push"];
const statuses = ["EN_ATTENTE", "ENVOYÉ", "ECHEC"];

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
    body("type").isIn(types),
    body("destinataire").isIn(recipients),
    body("contenu").isString().trim().notEmpty().isLength({ max: 5000 }),
    body("canal").isIn(channels),
    body("referenceId").optional({ nullable: true }).isString().trim().isLength({ max: 200 })
  ],
  validate,
  async (req: Request, res: Response, next: NextFunction) => {
    if (!req.tenantId) {
      return res.status(401).json({ success: false, message: "Tenant non identifié" });
    }
    try {
      const result = await pool.query(
        `INSERT INTO notifications (tenant_id, type, recipient, content, channel, reference_id)
         VALUES ($1, $2, $3, $4, $5, $6)
         RETURNING id, type, recipient AS "destinataire", content AS "contenu",
                   channel AS "canal", reference_id AS "referenceId",
                   status AS "statut", is_read AS "lu", created_at AS "crééLe"`,
        [
          req.tenantId, req.body.type, req.body.destinataire,
          String(req.body.contenu).trim(), req.body.canal, req.body.referenceId || null
        ]
      );
      return res.status(202).json({
        success: true,
        data: result.rows[0],
        message: "Notification enregistrée dans la file d'attente; aucun fournisseur d'envoi n'est configuré."
      });
    } catch (error) {
      return next(error);
    }
  }
);

router.get(
  "/",
  [
    query("type").optional().isIn(types),
    query("canal").optional().isIn(channels),
    query("statut").optional().isIn(statuses),
    query("lu").optional().isBoolean()
  ],
  validate,
  async (req: Request, res: Response, next: NextFunction) => {
    if (!req.tenantId) {
      return res.status(401).json({ success: false, message: "Tenant non identifié" });
    }
    try {
      const result = await pool.query(
        `SELECT id, type, recipient AS "destinataire", content AS "contenu",
                channel AS "canal", reference_id AS "referenceId",
                status AS "statut", is_read AS "lu", created_at AS "crééLe",
                sent_at AS "envoyéLe"
         FROM notifications
         WHERE tenant_id = $1
           AND ($2::text IS NULL OR type = $2)
           AND ($3::text IS NULL OR channel = $3)
           AND ($4::text IS NULL OR status = $4)
           AND ($5::boolean IS NULL OR is_read = $5)
         ORDER BY created_at DESC
         LIMIT 200`,
        [
          req.tenantId, req.query.type || null, req.query.canal || null,
          req.query.statut || null,
          typeof req.query.lu === "string" ? req.query.lu === "true" : null
        ]
      );
      return res.json({ success: true, data: { notifications: result.rows, count: result.rowCount } });
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
        `SELECT id, type, recipient AS "destinataire", content AS "contenu",
                channel AS "canal", reference_id AS "referenceId",
                status AS "statut", is_read AS "lu", created_at AS "crééLe",
                sent_at AS "envoyéLe"
         FROM notifications WHERE id = $1 AND tenant_id = $2`,
        [req.params.id, req.tenantId]
      );
      if (!result.rowCount) {
        return res.status(404).json({ success: false, message: "Notification introuvable" });
      }
      return res.json({ success: true, data: result.rows[0] });
    } catch (error) {
      return next(error);
    }
  }
);

router.put(
  "/:id/lu",
  [param("id").isUUID()],
  validate,
  async (req: Request, res: Response, next: NextFunction) => {
    if (!req.tenantId) {
      return res.status(401).json({ success: false, message: "Tenant non identifié" });
    }
    try {
      const result = await pool.query(
        `UPDATE notifications SET is_read = TRUE
         WHERE id = $1 AND tenant_id = $2
         RETURNING id, is_read AS "lu"`,
        [req.params.id, req.tenantId]
      );
      if (!result.rowCount) {
        return res.status(404).json({ success: false, message: "Notification introuvable" });
      }
      return res.json({ success: true, data: result.rows[0] });
    } catch (error) {
      return next(error);
    }
  }
);

export default router;
