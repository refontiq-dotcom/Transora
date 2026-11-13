import express from "express";
import helmet from "helmet";
import cors from "cors";
import { resolve } from "path";
import { pinoHttpMiddleware } from "./lib/logger";
import { authenticate } from "./middleware/auth";
import { errorHandler } from "./middleware/error";
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
import searchRoutes from "./modules/recherche/routes";

const app = express();

app.use(helmet());
app.use(cors());
app.use(pinoHttpMiddleware);
app.use(express.json({ limit: "10kb" }));
app.use(express.static(resolve(process.cwd(), "public")));

app.get("/health", (_req, res) => {
  res.json({ status: "ok", service: "transora-api", timestamp: new Date().toISOString() });
});

app.get("/metrics", (_req, res) => {
  res.json({
    service: "transora-api",
    uptime: process.uptime(),
    memoryUsage: process.memoryUsage(),
    timestamp: new Date().toISOString()
  });
});

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
app.use("/api/v1/recherche", searchRoutes);
app.use(errorHandler);

export default app;
