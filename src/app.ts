import express from "express";
import { timingSafeEqual } from "node:crypto";
import helmet from "helmet";
import cors from "cors";
import { resolve } from "path";
import { pinoHttpMiddleware } from "./lib/logger";
import { authenticate } from "./middleware/auth";
import { errorHandler } from "./middleware/error";
import { createRateLimitStoreFromEnv, createRateLimiter } from "./middleware/rate-limit";
import authRoutes from "./modules/auth/auth.routes";
import tenantRoutes from "./modules/tenant/routes";
import voyageRoutes from "./modules/voyage/routes";
import siègeRoutes from "./modules/siège/routes";
import paiementRoutes from "./modules/paiement/routes";
import dashboardRoutes from "./modules/dashboard/routes";
import flotteRoutes from "./modules/flotte/routes";
import personnelRoutes from "./modules/personnel/routes";
import incidentRoutes from "./modules/incidents/routes";
import notificationRoutes from "./modules/notifications/routes";
import financeRoutes from "./modules/finance/routes";
import auditRoutes from "./modules/audit/routes";
import searchRoutes from "./modules/recherche/routes";

const app = express();
const rateLimitStore = createRateLimitStoreFromEnv();

app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      baseUri: ["'self'"],
      connectSrc: ["'self'"],
      fontSrc: ["'self'", "https://fonts.gstatic.com", "data:"],
      formAction: ["'self'"],
      frameAncestors: ["'none'"],
      imgSrc: ["'self'", "data:", "blob:"],
      objectSrc: ["'none'"],
      scriptSrc: ["'self'"],
      scriptSrcAttr: ["'none'"],
      styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"]
    }
  }
}));
app.use(cors({
  origin: (origin, callback) => {
    if (!origin) return callback(null, false);
    const allowedOrigins = (process.env.CORS_ORIGINS || "")
      .split(",").map((value) => value.trim()).filter(Boolean);
    return callback(null, allowedOrigins.includes(origin));
  },
  credentials: true,
  methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
  allowedHeaders: ["Authorization", "Content-Type"],
  optionsSuccessStatus: 204
}));
app.use(pinoHttpMiddleware);
app.use(express.json({ limit: "10kb" }));
app.use(express.static(resolve(process.cwd(), "public")));

app.get("/health", (_req, res) => {
  res.json({ status: "ok", service: "transora-api", timestamp: new Date().toISOString() });
});

app.get("/metrics", (req, res) => {
  const expectedToken = process.env.METRICS_TOKEN;
  if (!expectedToken || expectedToken.length < 32) return res.sendStatus(404);

  const authorization = req.headers.authorization || "";
  const providedToken = authorization.startsWith("Bearer ")
    ? authorization.slice("Bearer ".length).trim()
    : "";
  const expected = Buffer.from(expectedToken);
  const provided = Buffer.from(providedToken);
  if (provided.length !== expected.length || !timingSafeEqual(provided, expected)) {
    return res.status(401).json({ success: false, message: "Non autorisé" });
  }

  return res.json({
    service: "transora-api",
    uptime: process.uptime(),
    memoryUsage: process.memoryUsage(),
    timestamp: new Date().toISOString()
  });
});

app.use("/api/v1/auth/register", createRateLimiter({
  namespace: "auth-register",
  windowMs: 60 * 60 * 1000,
  maxRequests: 5,
  message: "Trop de tentatives de création de compte. Réessayez plus tard.",
  store: rateLimitStore
}));
app.use("/api/v1/auth/login", createRateLimiter({
  namespace: "auth-login",
  windowMs: 15 * 60 * 1000,
  maxRequests: 10,
  message: "Trop de tentatives de connexion. Réessayez dans quelques minutes.",
  store: rateLimitStore
}));
app.use("/api/v1/auth", authRoutes);
app.use("/api/v1", authenticate);
app.use("/api/v1/tenant", tenantRoutes);
app.use("/api/v1/dashboard", dashboardRoutes);
app.use("/api/v1/voyages", voyageRoutes);
app.use("/api/v1/sièges", siègeRoutes);
app.use("/api/v1/paiements", paiementRoutes);
app.use("/api/v1/flotte", flotteRoutes);
app.use("/api/v1/personnel", personnelRoutes);
app.use("/api/v1/incidents", incidentRoutes);
app.use("/api/v1/notifications", notificationRoutes);
app.use("/api/v1/finance", financeRoutes);
app.use("/api/v1/audit", auditRoutes);
app.use("/api/v1/recherche", searchRoutes);
app.use(errorHandler);

export default app;
