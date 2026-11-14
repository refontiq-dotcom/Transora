/**
 * Authentification, sessions et révocation des accès.
 */
import { NextFunction, Router, Request, Response } from "express";
import { body, validationResult } from "express-validator";
import bcrypt from "bcryptjs";
import { createHash, randomBytes } from "node:crypto";
import { Pool, PoolClient } from "pg";
import { pool } from "../../db/pool";
import { createAccessToken } from "../../lib/jwt";
import { authenticate } from "../../middleware/auth";

const router = Router();
const ACCESS_COOKIE_PATH = "/api/v1/auth/refresh";
const REFRESH_TTL_DAYS = 30;
const hashToken = (token: string): string => createHash("sha256").update(token).digest("hex");
const newRefreshToken = (): string => randomBytes(48).toString("base64url");
const cookieOptions = () => ({
  httpOnly: true,
  secure: process.env.NODE_ENV === "production",
  sameSite: "strict" as const,
  path: ACCESS_COOKIE_PATH,
  maxAge: REFRESH_TTL_DAYS * 24 * 60 * 60 * 1000
});
const setRefreshCookie = (res: Response, token: string) =>
  res.cookie("transora_refresh", token, cookieOptions());
const clearRefreshCookie = (res: Response) =>
  res.clearCookie("transora_refresh", { ...cookieOptions(), maxAge: undefined });
const getRefreshCookie = (req: Request): string | undefined => {
  const header = req.headers.cookie;
  if (!header) return undefined;
  const pair = header.split(";").map((part) => part.trim())
    .find((part) => part.startsWith("transora_refresh="));
  if (!pair) return undefined;
  try { return decodeURIComponent(pair.slice("transora_refresh=".length)); }
  catch { return undefined; }
};
const validate = (req: Request, res: Response, next: NextFunction) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({
    success: false, message: "Données invalides", errors: errors.array()
  });
  next();
};
const isUniqueViolation = (error: unknown): boolean =>
  typeof error === "object" && error !== null && "code" in error && error.code === "23505";

interface SessionUser { id: string; email: string; role: string; tenantId: string; }
async function issueSession(user: SessionUser, res: Response, client: Pool | PoolClient = pool) {
  const sessionId = randomBytes(16).toString("hex");
  const refreshToken = newRefreshToken();
  await client.query(
    `INSERT INTO user_sessions (id, user_id, tenant_id, refresh_token_hash, expires_at)
     VALUES ($1, $2, $3, $4, NOW() + ($5 * INTERVAL '1 day'))`,
    [sessionId, user.id, user.tenantId, hashToken(refreshToken), REFRESH_TTL_DAYS]
  );
  setRefreshCookie(res, refreshToken);
  return createAccessToken({ ...user, sessionId });
}

router.post("/register", [
  body("name").isString().trim().notEmpty(),
  body("email").isEmail().normalizeEmail(),
  body("password").isString().isLength({ min: 12 }),
  body("companyName").isString().trim().notEmpty(),
  body("siret").optional().isString().trim()
], validate, async (req: Request, res: Response) => {
  const client = await pool.connect();
  try {
    if (!process.env.JWT_SECRET || process.env.JWT_SECRET.length < 32) {
      return res.status(503).json({ success: false, message: "Configuration JWT invalide" });
    }
    const { name, email, password, companyName, siret } = req.body;
    await client.query("BEGIN");
    const tenant = await client.query<{ id: string }>(
      "INSERT INTO tenants (name, siret) VALUES ($1, $2) RETURNING id",
      [companyName.trim(), siret || null]
    );
    const tenantId = tenant.rows[0].id;
    const passwordHash = await bcrypt.hash(password, 12);
    const created = await client.query<{ id: string; email: string; role: string }>(
      `INSERT INTO users (tenant_id, name, email, password_hash, role)
       VALUES ($1, $2, $3, $4, 'administrateur') RETURNING id, email, role`,
      [tenantId, name.trim(), email.toLowerCase(), passwordHash]
    );
    const user = { ...created.rows[0], tenantId };
    const token = await issueSession(user, res, client);
    await client.query("COMMIT");
    return res.status(201).json({
      success: true, data: { token, user: { ...user, name: name.trim() } },
      message: "Entreprise créée avec succès"
    });
  } catch (error) {
    await client.query("ROLLBACK");
    if (isUniqueViolation(error)) return res.status(409).json({
      success: false, message: "Une entreprise ou un utilisateur utilise déjà ces informations"
    });
    console.error("Erreur lors de l'enregistrement:", error);
    return res.status(500).json({ success: false, message: "Erreur interne du serveur" });
  } finally { client.release(); }
});

router.post("/login", [
  body("email").isEmail().normalizeEmail(),
  body("password").isString().notEmpty()
], validate, async (req: Request, res: Response) => {
  try {
    if (!process.env.JWT_SECRET || process.env.JWT_SECRET.length < 32) {
      return res.status(503).json({ success: false, message: "Configuration JWT invalide" });
    }
    const { email, password } = req.body;
    const result = await pool.query<{
      id: string; name: string; email: string; role: string; tenant_id: string; password_hash: string;
    }>("SELECT id, name, email, role, tenant_id, password_hash FROM users WHERE email = $1 AND is_active = TRUE", [email.toLowerCase()]);
    const user = result.rows[0];
    if (!user || !(await bcrypt.compare(password, user.password_hash))) {
      return res.status(401).json({ success: false, message: "Adresse e-mail ou mot de passe incorrect" });
    }
    const token = await issueSession({
      id: user.id, email: user.email, role: user.role, tenantId: user.tenant_id
    }, res);
    return res.json({
      success: true,
      data: { token, user: { id: user.id, name: user.name, email: user.email, role: user.role, tenantId: user.tenant_id } }
    });
  } catch (error) {
    console.error("Erreur lors de la connexion:", error);
    return res.status(500).json({ success: false, message: "Erreur interne du serveur" });
  }
});

// Rotation atomique : un refresh token ne peut être utilisé qu'une seule fois.
router.post("/refresh", async (req: Request, res: Response) => {
  const oldToken = getRefreshCookie(req);
  if (!oldToken) return res.status(401).json({ success: false, message: "Session expirée" });
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const found = await client.query<{
      id: string; user_id: string; tenant_id: string; email: string; role: string; name: string;
    }>(
      `SELECT s.id, s.user_id, s.tenant_id, u.email, u.role, u.name
       FROM user_sessions s JOIN users u ON u.id = s.user_id AND u.tenant_id = s.tenant_id
       WHERE s.refresh_token_hash = $1 AND s.revoked_at IS NULL AND s.expires_at > NOW() AND u.is_active = TRUE
       FOR UPDATE OF s`,
      [hashToken(oldToken)]
    );
    const session = found.rows[0];
    if (!session) {
      await client.query("ROLLBACK");
      clearRefreshCookie(res);
      return res.status(401).json({ success: false, message: "Session invalide ou expirée" });
    }
    const nextToken = newRefreshToken();
    const rotated = await client.query(
      `UPDATE user_sessions SET refresh_token_hash = $1, last_used_at = NOW()
       WHERE id = $2 AND revoked_at IS NULL RETURNING id`,
      [hashToken(nextToken), session.id]
    );
    if (!rotated.rowCount) {
      await client.query("ROLLBACK");
      clearRefreshCookie(res);
      return res.status(401).json({ success: false, message: "Session révoquée" });
    }
    await client.query("COMMIT");
    setRefreshCookie(res, nextToken);
    const token = createAccessToken({
      id: session.user_id, email: session.email, role: session.role,
      tenantId: session.tenant_id, sessionId: session.id
    });
    return res.json({ success: true, data: { token, user: {
      id: session.user_id, name: session.name, email: session.email,
      role: session.role, tenantId: session.tenant_id
    } } });
  } catch (error) {
    await client.query("ROLLBACK");
    console.error("Erreur de renouvellement de session:", error);
    return res.status(500).json({ success: false, message: "Erreur interne du serveur" });
  } finally { client.release(); }
});

router.post("/logout", authenticate, async (req: Request, res: Response) => {
  try {
    if (req.user?.sessionId) {
      await pool.query(
        "UPDATE user_sessions SET revoked_at = NOW() WHERE id = $1 AND user_id = $2 AND revoked_at IS NULL",
        [req.user.sessionId, req.user.id]
      );
    }
    clearRefreshCookie(res);
    return res.json({ success: true, message: "Session déconnectée" });
  } catch (error) {
    console.error("Erreur de déconnexion:", error);
    return res.status(500).json({ success: false, message: "Erreur interne du serveur" });
  }
});

router.post("/logout-all", authenticate, async (req: Request, res: Response) => {
  try {
    await pool.query(
      "UPDATE user_sessions SET revoked_at = NOW() WHERE user_id = $1 AND tenant_id = $2 AND revoked_at IS NULL",
      [req.user!.id, req.user!.tenantId]
    );
    clearRefreshCookie(res);
    return res.json({ success: true, message: "Toutes les sessions ont été révoquées" });
  } catch (error) {
    console.error("Erreur de révocation globale:", error);
    return res.status(500).json({ success: false, message: "Erreur interne du serveur" });
  }
});

router.get("/sessions", authenticate, async (req: Request, res: Response) => {
  try {
    const result = await pool.query(
      `SELECT id, created_at AS "createdAt", last_used_at AS "lastUsedAt", expires_at AS "expiresAt"
       FROM user_sessions WHERE user_id = $1 AND tenant_id = $2 AND revoked_at IS NULL AND expires_at > NOW()
       ORDER BY last_used_at DESC`,
      [req.user!.id, req.user!.tenantId]
    );
    return res.json({ success: true, data: { sessions: result.rows } });
  } catch (error) {
    console.error("Erreur de lecture des sessions:", error);
    return res.status(500).json({ success: false, message: "Erreur interne du serveur" });
  }
});

router.delete("/sessions/:sessionId", authenticate, async (req: Request, res: Response) => {
  try {
    const result = await pool.query(
      `UPDATE user_sessions SET revoked_at = NOW()
       WHERE id = $1 AND user_id = $2 AND tenant_id = $3 AND revoked_at IS NULL RETURNING id`,
      [req.params.sessionId, req.user!.id, req.user!.tenantId]
    );
    if (!result.rowCount) return res.status(404).json({ success: false, message: "Session introuvable" });
    return res.json({ success: true, message: "Session révoquée" });
  } catch (error) {
    console.error("Erreur de révocation de session:", error);
    return res.status(500).json({ success: false, message: "Erreur interne du serveur" });
  }
});

export default router;
