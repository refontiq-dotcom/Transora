/**
 * Middleware: Gestionnaire d'erreurs global
 *
 * Traite toutes les erreurs non capturées dans les routes
 * et retourne des réponses d'erreur structurées.
 */

import { NextFunction, Request, Response } from "express";

interface AppError extends Error {
  statusCode?: number;
  errors?: unknown[];
}

export const errorHandler = (err: AppError, req: Request, res: Response, _next: NextFunction) => {
  console.error("❌ Erreur non capturée:", {
    message: err.message,
    stack: err.stack,
    path: req.path,
    method: req.method
  });

  const statusCode = err.statusCode || 500;
  const message = statusCode >= 500
    ? "Erreur interne du serveur"
    : err.message || "Erreur interne du serveur";
  res.status(statusCode).json({
    success: false,
    message,
    ...(statusCode < 500 && err.errors && { errors: err.errors })
  });
};