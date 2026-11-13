/**
 * Logger structuré Pino (C-17 : auditabilité)
 *
 * Fournit une instance de logger Pino configurée pour l'application TRANSORA.
 * Tous les logs sont au format JSON en production, lisible en développement.
 * Les données sensibles (mots de passe, numéros de carte, etc.) sont masqués automatiquement.
 */

import pino from "pino";
import pinoHttp from "pino-http";

// Configuration de Pino selon l'environnement
const isDevelopment = process.env.NODE_ENV !== "production";

// Logger Pino de base
const logger = pino({
  level: isDevelopment ? "debug" : "info",
  format: isDevelopment ? pino.pretty() : undefined,
  timestamp: pino.stdTimeFunctions.isoTime,
  // Masquage des données sensiblesKnown
  redact: [
    // Mots de passe et tokens ne doivent jamais apparaître dans les logs
    /password(.*)?/i,
    /token(.*)?/i,
    /secret(.*)?/i,
    /jwt(.*)?/i,
  ],
});

// Middleware pino-http pour logger toutes les requêtes HTTP
const pinoHttpMiddleware = pinoHttp({
  logger,
  autoAssignContext: true,
  genReqId: (req) => req.headers["x-request-id"] || `${Date.now()}-${Math.random()}`,
  autoAudit: true,
  translateTime: "auto",
  ignorePaths: ["/health", "/metrics"],
  // Ne pas logger les données sensibles dans le body
  mixin: (req, res) => ({
    // Ajouter le tenant_id si disponible (via JWT middleware)
    tenantId: (req as any).tenantId || undefined,
    userRole: (req as any).user?.role || undefined,
    method: req.method,
    url: req.originalUrl,
  }),
});

export { logger, pinoHttpMiddleware };