/**
 * Middleware: authentification stricte des requêtes par JWT.
 * Les tokens doivent être signés en HS256, avoir le bon issuer/audience,
 * et contenir des dates iat/exp valides avec une durée maximale de 8 heures.
 */
import { Request, Response, NextFunction } from "express";
import jwt from "jsonwebtoken";
import { verifyAccessToken } from "../lib/jwt";

export const authenticate = (req: Request, res: Response, next: NextFunction) => {
  const authorization = req.headers.authorization;
  if (!authorization || !authorization.startsWith("Bearer ")) {
    return res.status(401).json({
      success: false,
      message: "Non authentifié - Token manquant"
    });
  }

  try {
    const payload = verifyAccessToken(authorization.slice("Bearer ".length).trim());
    if (
      typeof payload.sub !== "string" ||
      typeof payload.email !== "string" ||
      typeof payload.role !== "string" ||
      typeof payload.tenantId !== "string"
    ) {
      return res.status(401).json({
        success: false,
        message: "Non authentifié - Token invalide"
      });
    }

    req.user = {
      id: payload.sub,
      email: payload.email,
      role: payload.role,
      tenantId: payload.tenantId
    };
    req.tenantId = payload.tenantId;
    return next();
  } catch (error) {
    if (error instanceof jwt.JsonWebTokenError || error instanceof jwt.TokenExpiredError || error instanceof Error && error.message.includes("JWT_SECRET")) {
      if (error.message.includes("JWT_SECRET")) {
        return res.status(503).json({
          success: false,
          message: "Authentification indisponible - Configuration JWT invalide"
        });
      }
      return res.status(401).json({
        success: false,
        message: "Non authentifié - Token invalide ou expiré"
      });
    }
    return next(error);
  }
};

/**
 * Middleware: autorisation historique par rôle.
 */
export const authorize = (rolesAllowed: string[]) => {
  return (req: Request, res: Response, next: NextFunction) => {
    if (!req.user || !rolesAllowed.includes(req.user.role)) {
      return res.status(403).json({
        success: false,
        message: "Non autorisé - Vous n'avez pas les droits requis"
      });
    }
    return next();
  };
};
