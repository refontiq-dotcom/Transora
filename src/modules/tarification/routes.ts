import { NextFunction, Request, Response, Router } from "express";
import { body, param, validationResult } from "express-validator";
import { pool } from "../../db/pool";
import { authorize } from "../../middleware/auth";

const router = Router();
const manageTariffs = authorize(["administrateur", "responsable_exploitation"]);

const validate = (req: Request, res: Response, next: NextFunction) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({
    success: false, message: "Données invalides", errors: errors.array()
  });
  next();
};

const normalizeCity = (value: string) => value.trim().replace(/\s+/g, " ");

router.get("/", async (req: Request, res: Response, next: NextFunction) => {
  if (!req.tenantId) return res.status(401).json({ success: false, message: "Tenant non identifié" });
  try {
    const result = await pool.query(
      `SELECT id, origin, destination, fare_amount AS "fareAmount",
              company_booking_fee AS "companyBookingFee", is_active AS active,
              created_at AS "createdAt", updated_at AS "updatedAt"
       FROM company_route_tariffs
       WHERE tenant_id = $1
       ORDER BY is_active DESC, origin, destination`,
      [req.tenantId]
    );
    return res.json({ success: true, data: { tariffs: result.rows, count: result.rowCount } });
  } catch (error) { return next(error); }
});

router.post("/", manageTariffs, [
  body("origin").isString().trim().isLength({ min: 2, max: 100 }),
  body("destination").isString().trim().isLength({ min: 2, max: 100 }),
  body("fareAmount").isInt({ min: 1, max: 100000000 }),
  body("companyBookingFee").optional().isInt({ min: 0, max: 100000000 })
], validate, async (req: Request, res: Response, next: NextFunction) => {
  if (!req.tenantId || !req.user) return res.status(401).json({ success: false, message: "Tenant non identifié" });
  const origin = normalizeCity(String(req.body.origin));
  const destination = normalizeCity(String(req.body.destination));
  if (origin.toLocaleLowerCase("fr") === destination.toLocaleLowerCase("fr")) {
    return res.status(400).json({ success: false, message: "La ville de départ doit être différente de la destination" });
  }
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await client.query(
      `INSERT INTO company_route_tariffs
         (tenant_id, origin, destination, fare_amount, company_booking_fee)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id, origin, destination, fare_amount AS "fareAmount",
                 company_booking_fee AS "companyBookingFee", is_active AS active`,
      [req.tenantId, origin, destination, Number(req.body.fareAmount), Number(req.body.companyBookingFee ?? 0)]
    );
    await client.query(
      `INSERT INTO audit_events (tenant_id, actor_user_id, type, subject, action, details)
       VALUES ($1, $2, 'création', 'tarif trajet', 'Création d’un tarif', $3::jsonb)`,
      [req.tenantId, req.user.id, JSON.stringify(result.rows[0])]
    );
    await client.query("COMMIT");
    return res.status(201).json({ success: true, data: result.rows[0], message: "Tarif enregistré" });
  } catch (error) {
    await client.query("ROLLBACK");
    if ((error as { code?: string }).code === "23505") return res.status(409).json({
      success: false, message: "Un tarif existe déjà pour ce trajet. Modifiez le tarif existant."
    });
    return next(error);
  } finally { client.release(); }
});

router.patch("/:id", manageTariffs, [
  param("id").isUUID(),
  body("fareAmount").optional().isInt({ min: 1, max: 100000000 }),
  body("companyBookingFee").optional().isInt({ min: 0, max: 100000000 }),
  body("active").optional().isBoolean()
], validate, async (req: Request, res: Response, next: NextFunction) => {
  if (!req.tenantId || !req.user) return res.status(401).json({ success: false, message: "Tenant non identifié" });
  const hasFare = Object.hasOwn(req.body, "fareAmount");
  const hasFee = Object.hasOwn(req.body, "companyBookingFee");
  const hasActive = Object.hasOwn(req.body, "active");
  if (!hasFare && !hasFee && !hasActive) return res.status(400).json({
    success: false, message: "Aucune modification fournie"
  });
  try {
    const result = await pool.query(
      `UPDATE company_route_tariffs
       SET fare_amount = CASE WHEN $3 THEN $4 ELSE fare_amount END,
           company_booking_fee = CASE WHEN $5 THEN $6 ELSE company_booking_fee END,
           is_active = CASE WHEN $7 THEN $8 ELSE is_active END,
           updated_at = NOW()
       WHERE id = $1 AND tenant_id = $2
       RETURNING id, origin, destination, fare_amount AS "fareAmount",
                 company_booking_fee AS "companyBookingFee", is_active AS active,
                 updated_at AS "updatedAt"`,
      [req.params.id, req.tenantId, hasFare, hasFare ? Number(req.body.fareAmount) : null,
        hasFee, hasFee ? Number(req.body.companyBookingFee) : null,
        hasActive, hasActive ? req.body.active === true || req.body.active === "true" : null]
    );
    if (!result.rowCount) return res.status(404).json({ success: false, message: "Tarif introuvable dans cette compagnie" });
    await pool.query(
      `INSERT INTO audit_events (tenant_id, actor_user_id, type, subject, action, details)
       VALUES ($1, $2, 'modification', 'tarif trajet', 'Modification d’un tarif', $3::jsonb)`,
      [req.tenantId, req.user.id, JSON.stringify(result.rows[0])]
    );
    return res.json({ success: true, data: result.rows[0], message: "Tarif mis à jour" });
  } catch (error) { return next(error); }
});

export default router;
