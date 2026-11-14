/**
 * Authentification JWT et contrôle de révocation des sessions.
 */
import { Request, Response, NextFunction } from "express";
import jwt from "jsonwebtoken";
import { verifyAccessToken } from "../lib/jwt";
import { pool } from "../db/pool";

export const authenticate = async (req: Request, res: Response, next: NextFunction) => {
  const authorization = req.headers.authorization;
  if (!authorization || !authorization.startsWith("Bearer ")) {
    return res.status(401).json({ success: false, message: "Non authentifié - Token manquant" });
  }
  try {
    const payload = verifyAccessToken(authorization.slice("Bearer ".length).trim());
    if (typeof payload.sub !== "string" || typeof payload.email !== "string" ||
        typeof payload.role !== "string" || typeof payload.tenantId !== "string" ||
        typeof payload.sessionId !== "string" || payload.sessionId.length === 0) {
      return res.status(401).json({ success: false, message: "Non authentifié - Token invalide" });
    }
    const sessionId = payload.sessionId;
    const active = await pool.query(
      `SELECT 1 FROM user_sessions s
       JOIN users u ON u.id = s.user_id AND u.tenant_id = s.tenant_id
       WHERE s.id = $1 AND s.user_id = $2 AND s.tenant_id = $3
         AND s.revoked_at IS NULL AND s.expires_at > NOW() AND u.is_active = TRUE`,
      [sessionId, payload.sub, payload.tenantId]
    );
    if (!active.rowCount) return res.status(401).json({
      success: false, message: "Session révoquée ou expirée"
    });
    req.user = {
      id: payload.sub, email: payload.email, role: payload.role,
      tenantId: payload.tenantId, sessionId
    };
    req.tenantId = payload.tenantId;
    return next();
  } catch (error) {
    if (error instanceof jwt.JsonWebTokenError || error instanceof jwt.TokenExpiredError ||
        error instanceof Error && error.message.includes("JWT_SECRET")) {
      if (error.message.includes("JWT_SECRET")) return res.status(503).json({
        success: false, message: "Authentification indisponible - Configuration JWT invalide"
      });
      return res.status(401).json({ success: false, message: "Non authentifié - Token invalide ou expiré" });
    }
    return next(error);
  }
};

/**
 * Canonicalise les anciens rôles sans leur accorder de privilèges supplémentaires.
 * Les comptes existants restent compatibles pendant la migration progressive.
 */
const roleAliases: Record<string, string> = {
  superviseur: "responsable_exploitation",
  conducteur: "chauffeur",
  agent_acceuil: "agent_accueil"
};

export const normalizeRole = (role: string): string => roleAliases[role] || role;

export const hasRole = (role: string | undefined, rolesAllowed: string[]): boolean =>
  Boolean(role && rolesAllowed.some((allowed) => normalizeRole(allowed) === normalizeRole(role)));

export const authorize = (rolesAllowed: string[]) => (
  req: Request, res: Response, next: NextFunction
) => {
  if (!req.user || !hasRole(req.user.role, rolesAllowed)) return res.status(403).json({
    success: false, message: "Non autorisé - Vous n'avez pas les droits requis"
  });
  return next();
};
