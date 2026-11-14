import { AddressInfo } from "node:net";
import jwt from "jsonwebtoken";
import { afterAll, beforeAll, expect, test } from "vitest";
import app from "../src/app";
import { hasPermission } from "../src/middleware/rbac";

const secret = "transora-rbac-test-secret-key-at-least-32-characters";
const tenantId = "550e8400-e29b-41d4-a716-446655440001";
const userId = "550e8400-e29b-41d4-a716-446655440002";
let server: ReturnType<typeof app.listen>;
let baseUrl: string;
let previousSecret: string | undefined;

const tokenFor = (role: string) => jwt.sign(
  { email: "rbac@example.test", role, tenantId },
  secret,
  { subject: userId }
);

beforeAll(async () => {
  previousSecret = process.env.JWT_SECRET;
  process.env.JWT_SECRET = secret;
  server = app.listen(0);
  await new Promise<void>((resolve, reject) => {
    server.once("listening", resolve);
    server.once("error", reject);
  });
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  if (server) {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => error ? reject(error) : resolve());
    });
  }
  if (previousSecret === undefined) delete process.env.JWT_SECRET;
  else process.env.JWT_SECRET = previousSecret;
});

const request = (path: string, role: string, init: RequestInit = {}) =>
  fetch(`${baseUrl}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${tokenFor(role)}`,
      ...(init.headers || {})
    }
  });

test("operational employee roles cannot access financial data or write operations", async () => {
  const [finance, fleetWrite, departureWrite, paymentRead, auditRead] = await Promise.all([
    request("/api/v1/finance/stats", "caissier"),
    request("/api/v1/flotte", "gestionnaire_flotte", { method: "POST" }),
    request("/api/v1/voyages/departures", "agent_acceuil", { method: "POST" }),
    request("/api/v1/paiements", "guichetier"),
    request("/api/v1/audit", "superviseur", { method: "POST", body: JSON.stringify({}) })
  ]);

  for (const response of [finance, fleetWrite, departureWrite, paymentRead, auditRead]) {
    expect(response.status).toBe(403);
    const body = await response.json() as { success?: boolean };
    expect(body.success).toBe(false);
  }
});

test("the administrator role passes authorization and reaches route validation", async () => {
  const response = await request("/api/v1/finance/stats?startDate=not-a-date", "administrateur");
  expect(response.status).toBe(400);
  const body = await response.json() as { message?: string };
  expect(body.message).toBe("Données invalides");
});

test("the administrator-only tenant user listing rejects non-administrator roles", async () => {
  const response = await request("/api/v1/tenant/users", "rh");
  expect(response.status).toBe(403);
});

test("the provisioned role matrix grants only the intended operational permissions", async () => {
  expect(hasPermission("administrateur", "tenant.manage")).toBe(true);
  expect(hasPermission("superviseur", "voyages.manage")).toBe(true);
  expect(hasPermission("agent_acceuil", "bookings.create")).toBe(true);
  expect(hasPermission("agent_acceuil", "payments.manage")).toBe(false);
  expect(hasPermission("caissier", "payments.manage")).toBe(true);
  expect(hasPermission("caissier", "voyages.manage")).toBe(false);
  expect(hasPermission("conducteur", "incidents.read")).toBe(true);
  expect(hasPermission("conducteur", "incidents.report")).toBe(true);
  expect(hasPermission("conducteur", "finance.read")).toBe(false);
  expect(hasPermission("mécanicien", "fleet.read")).toBe(true);
  expect(hasPermission("mécanicien", "fleet.update")).toBe(true);
  expect(hasPermission("mécanicien", "personnel.manage")).toBe(false);
  expect(hasPermission("rh", "personnel.manage")).toBe(false);
  expect(hasPermission("unknown", "dashboard.read")).toBe(false);
});
