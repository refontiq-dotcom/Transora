/**
 * Logger structuré Pino (C-17 : auditabilité).
 *
 * Les logs sont structurés en JSON dans tous les environnements afin de
 * conserver un format cohérent entre le développement et la production.
 * Les informations d'authentification et les secrets sont expurgés.
 */
import { randomUUID } from "node:crypto";
import pino from "pino";
import pinoHttp from "pino-http";

const isDevelopment = process.env.NODE_ENV !== "production";

const logger = pino({
  level: process.env.LOG_LEVEL || (isDevelopment ? "debug" : "info"),
  timestamp: pino.stdTimeFunctions.isoTime,
  redact: {
    paths: [
      "req.headers.authorization",
      "req.headers.cookie",
      "password",
      "*.password",
      "*.token",
      "*.secret",
      "*.jwt",
      "*.cardNumber",
      "*.cvv",
      "*.pin"
    ],
    censor: "[REDACTED]"
  }
});

const pinoHttpMiddleware = pinoHttp({
  logger,
  genReqId: (req) => {
    const incomingRequestId = req.headers["x-request-id"];
    return typeof incomingRequestId === "string" && incomingRequestId.length <= 128
      ? incomingRequestId
      : randomUUID();
  },
  autoLogging: {
    ignore: (req) => req.url === "/health" || req.url === "/metrics"
  },
  customProps: (req) => {
    const request = req as typeof req & {
      tenantId?: string;
      user?: { role?: string };
      originalUrl?: string;
    };

    return {
      tenantId: request.tenantId,
      userRole: request.user?.role,
      method: req.method,
      url: request.originalUrl || req.url
    };
  }
});

export { logger, pinoHttpMiddleware };
