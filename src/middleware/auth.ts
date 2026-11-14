/**
 * Middleware: Authentification des requêtes
 *
 * Vérifie le JWT et attache les informations du tenant et de l'utilisateur
 * à la requête pour utilisation dans les autres middleware et routes.
 */

import { Request, Response, NextFunction } from "express";
import jwt from "jsonwebtoken";

export const authenticate = (req: Request, res: Response, next: NextFunction) => {
  const authorization = req.headers.authorization;
  if (!authorization || !authorization.startsWith("Bearer ")) {
    return res.status(401).json({
      success: false,
      message: "Non authentifié - Token manquant"
    });
  }

  const secret = process.env.JWT_SECRET;
  if (!secret) {
    return res.status(503).json({
      success: false,
      message: "Authentification indisponible - JWT_SECRET n'est pas configuré"
    });
  }

  try {
    const payload = jwt.verify(authorization.slice("Bearer ".length).trim(), secret);
    if (
      typeof payload === "string" ||
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
    next();
  } catch (error) {
    if (error instanceof jwt.JsonWebTokenError || error instanceof jwt.TokenExpiredError) {
      return res.status(401).json({
        success: false,
        message: "Non authentifié - Token invalide ou expiré"
      });
    }
    next(error);
  }
};

/**
 * Middleware: Autorisation par rôle
 *
 * Vérifie que l'utilisateur authentifié a le rôle requis pour accéder à la route.
 */

export const authorize = (rolesAllowed: string[]) => {
  return (req: Request, res: Response, next: NextFunction) => {
    const user = req.user;
    const authorized = Boolean(
      user &&
      user.id &&
      user.email &&
      user.role &&
      req.tenantId &&
      user.tenantId === req.tenantId &&
      rolesAllowed.length > 0 &&
      rolesAllowed.includes(user.role)
    );

    if (!authorized) {
      return res.status(403).json({
        success: false,
        message: "Non autorisé - Vous n'avez pas les droits requis"
      });
    }
    next();
  };
};