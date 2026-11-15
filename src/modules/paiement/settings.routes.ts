import { NextFunction, Request, Response, Router } from "express";
import { body, validationResult } from "express-validator";
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { pool } from "../../db/pool";
import { authorize } from "../../middleware/auth";
import { paymentProviders, type PaymentProvider } from "./providers/types";

const router = Router();
const providers = new Set<string>(paymentProviders);
const allowedReaders = authorize(["administrateur", "responsable_financier"]);
const adminOnly = authorize(["administrateur"]);

const validate = (req: Request, res: Response, next: NextFunction) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({
    success: false, message: "Données invalides", errors: errors.array()
  });
  next();
};

const encryptionKey = (): Buffer => {
  const configured = process.env.PAYMENT_CREDENTIALS_ENCRYPTION_KEY;
  if (!configured) throw new Error("PAYMENT_CREDENTIALS_ENCRYPTION_KEY is not configured");
  const key = Buffer.from(configured, "base64");
  if (key.length !== 32) throw new Error("PAYMENT_CREDENTIALS_ENCRYPTION_KEY must be a base64-encoded 32-byte key");
  return key;
};

export const encryptPaymentCredentials = (credentials: Record<string, unknown>): Buffer => {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", encryptionKey(), iv);
  const plaintext = Buffer.from(JSON.stringify(credentials), "utf8");
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), ciphertext]);
};

export const decryptPaymentCredentials = (encrypted: Buffer): Record<string, unknown> => {
  if (encrypted.length < 29) throw new Error("Encrypted payment credentials are invalid");
  const iv = encrypted.subarray(0, 12);
  const authTag = encrypted.subarray(12, 28);
  const ciphertext = encrypted.subarray(28);
  const decipher = createDecipheriv("aes-256-gcm", encryptionKey(), iv);
  decipher.setAuthTag(authTag);
  const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  const parsed: unknown = JSON.parse(plaintext.toString("utf8"));
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("Payment credentials payload is invalid");
  }
  return parsed as Record<string, unknown>;
};

router.get("/", allowedReaders, async (req: Request, res: Response, next: NextFunction) => {
  if (!req.tenantId) return res.status(401).json({ success: false, message: "Tenant non identifié" });
  try {
    const result = await pool.query(
      `SELECT id, provider, environment, merchant_account_ref, enabled,
              allowed_methods, credentials_ciphertext IS NOT NULL AS credentials_configured,
              created_at, updated_at
       FROM tenant_payment_settings
       WHERE tenant_id = $1
       ORDER BY provider`,
      [req.tenantId]
    );
    return res.json({ success: true, data: result.rows });
  } catch (error) { return next(error); }
});

router.put("/", adminOnly, [
  body("provider").isString().custom(value => providers.has(value)),
  body("environment").optional().isIn(["sandbox", "live"]),
  body("merchantAccountRef").optional({ nullable: true }).isString().trim().isLength({ min: 1, max: 180 }),
  body("allowedMethods").optional().isArray({ max: 6 }),
  body("allowedMethods.*").optional().isIn(paymentProviders),
  body("credentials").optional().isObject(),
  body("enabled").optional().equals("false")
], validate, async (req: Request, res: Response, next: NextFunction) => {
  if (!req.tenantId) return res.status(401).json({ success: false, message: "Tenant non identifié" });
  const { provider, environment = "sandbox", merchantAccountRef = null, allowedMethods = [], credentials } = req.body;
  if (req.body.enabled === true || req.body.enabled === "true") {
    return res.status(409).json({ success: false, message: "L'activation sera disponible après validation des intégrations prestataires." });
  }
  if (allowedMethods.some((method: string) => method !== provider)) {
    return res.status(400).json({ success: false, message: "Les moyens autorisés doivent correspondre au prestataire configuré." });
  }
  if (credentials !== undefined && (credentials === null || Array.isArray(credentials) || Object.keys(credentials).length === 0)) {
    return res.status(400).json({ success: false, message: "Les identifiants marchands fournis sont invalides." });
  }

  try {
    const encrypted = credentials === undefined ? null : encryptPaymentCredentials(credentials as Record<string, unknown>);
    const result = await pool.query(
      `INSERT INTO tenant_payment_settings
         (tenant_id, provider, environment, merchant_account_ref, enabled, allowed_methods,
          credentials_ciphertext, credentials_key_version)
       VALUES ($1, $2, $3, $4, FALSE, $5, $6, CASE WHEN $6::bytea IS NULL THEN NULL ELSE 1 END)
       ON CONFLICT (tenant_id, provider) DO UPDATE SET
         environment = EXCLUDED.environment,
         merchant_account_ref = EXCLUDED.merchant_account_ref,
         allowed_methods = EXCLUDED.allowed_methods,
         credentials_ciphertext = COALESCE(EXCLUDED.credentials_ciphertext, tenant_payment_settings.credentials_ciphertext),
         credentials_key_version = COALESCE(EXCLUDED.credentials_key_version, tenant_payment_settings.credentials_key_version),
         enabled = FALSE,
         updated_at = NOW()
       RETURNING id, provider, environment, merchant_account_ref, enabled,
                 allowed_methods, credentials_ciphertext IS NOT NULL AS credentials_configured,
                 created_at, updated_at`,
      [req.tenantId, provider, environment, merchantAccountRef, allowedMethods, encrypted]
    );
    return res.status(200).json({
      success: true, data: result.rows[0],
      message: "Configuration enregistrée et chiffrée. Le paiement en ligne reste désactivé."
    });
  } catch (error) { return next(error); }
});

router.delete("/:provider", adminOnly, async (req: Request, res: Response, next: NextFunction) => {
  if (!req.tenantId) return res.status(401).json({ success: false, message: "Tenant non identifié" });
  if (!providers.has(req.params.provider)) return res.status(400).json({ success: false, message: "Prestataire invalide" });
  try {
    const result = await pool.query(
      "DELETE FROM tenant_payment_settings WHERE tenant_id=$1 AND provider=$2 RETURNING id",
      [req.tenantId, req.params.provider as PaymentProvider]
    );
    if (!result.rowCount) return res.status(404).json({ success: false, message: "Configuration introuvable" });
    return res.json({ success: true, message: "Configuration supprimée" });
  } catch (error) { return next(error); }
});

export default router;
