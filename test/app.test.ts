import { afterAll, beforeAll, expect, test } from "vitest";
import app from "../src/app";
import { pool } from "../src/db/pool";
import { createAccessToken } from "../src/lib/jwt";
import type { AddressInfo } from "node:net";

let server: ReturnType<typeof app.listen>;
let baseUrl: string;
let tenantId: string;
let userId: string;
let sessionId: string;
let accessToken: string;
let userEmail: string;
const previousJwtSecret = process.env.JWT_SECRET;

beforeAll(async () => {
  server = app.listen(0);
  await new Promise<void>((resolve, reject) => {
    server.once("listening", resolve);
    server.once("error", reject);
  });
  const address = server.address() as AddressInfo;
  baseUrl = `http://127.0.0.1:${address.port}`;

  process.env.JWT_SECRET = "test-app-session-bound-token-secret-32";
  const tenant = await pool.query("INSERT INTO tenants (name) VALUES ('App Test Tenant') RETURNING id");
  tenantId = tenant.rows[0].id;
  userEmail = `app-test-${Date.now()}@example.test`;
  const user = await pool.query(
    `INSERT INTO users (tenant_id, name, email, password_hash, role)
     VALUES ($1, 'App Test User', $2, 'test-hash', 'administrateur') RETURNING id`,
    [tenantId, userEmail]
  );
  userId = user.rows[0].id;
  sessionId = `app-test-session-${Date.now()}`;
  await pool.query(
    "INSERT INTO user_sessions (id, user_id, tenant_id, refresh_token_hash, expires_at) VALUES ($1, $2, $3, $4, NOW() + INTERVAL '1 day')",
    [sessionId, userId, tenantId, "c".repeat(64)]
  );
  accessToken = createAccessToken({
    id: userId, email: userEmail, role: "administrateur", tenantId, sessionId
  });
});

afterAll(async () => {
  if (tenantId) await pool.query("DELETE FROM tenants WHERE id = $1", [tenantId]);
  if (previousJwtSecret === undefined) delete process.env.JWT_SECRET;
  else process.env.JWT_SECRET = previousJwtSecret;
  await new Promise<void>((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve());
  });
});

test("health endpoint returns the API status", async () => {
  const response = await fetch(`${baseUrl}/health`);
  expect(response.status).toBe(200);
  const body = await response.json() as { status?: string };
  expect(body.status).toBe("ok");
});

test("dashboard responses enforce the explicit content security policy", async () => {
  const response = await fetch(`${baseUrl}/`);
  const policy = response.headers.get("content-security-policy");

  expect(policy).toBeTruthy();
  expect(policy).toContain("default-src 'self'");
  expect(policy).toContain("script-src 'self'");
  expect(policy).toContain("script-src-attr 'none'");
  expect(policy).toContain("object-src 'none'");
  expect(policy).toContain("base-uri 'self'");
  expect(policy).toContain("frame-ancestors 'none'");
  expect(policy).toContain("connect-src 'self'");
  expect(policy).toContain("https://fonts.googleapis.com");
  expect(policy).toContain("https://fonts.gstatic.com");
  expect(policy).not.toMatch(/script-src[^;]*'unsafe-inline'/);
});

test("dashboard is protected when no bearer token is supplied", async () => {
  const response = await fetch(`${baseUrl}/api/v1/dashboard?date=2026-11-12&period=30`);
  expect(response.status).toBe(401);
  const body = await response.json() as { success?: boolean };
  expect(body.success).toBe(false);
});

test("tenant, trip, fleet, payment, search, and finance APIs are protected when no bearer token is supplied", async () => {
  const [tenantResponse, tripResponse, departureListResponse, fleetResponse, paymentResponse, searchResponse, ticketResponse, financeResponse] = await Promise.all([
    fetch(`${baseUrl}/api/v1/tenant`),
    fetch(`${baseUrl}/api/v1/voyages`),
    fetch(`${baseUrl}/api/v1/voyages/departures`),
    fetch(`${baseUrl}/api/v1/flotte`),
    fetch(`${baseUrl}/api/v1/paiements`),
    fetch(`${baseUrl}/api/v1/recherche?q=dupont`),
    fetch(`${baseUrl}/api/v1/recherche/billet/550e8400-e29b-41d4-a716-446655440000`),
    fetch(`${baseUrl}/api/v1/finance/`)
  ]);
  expect(tenantResponse.status).toBe(401);
  expect(tripResponse.status).toBe(401);
  expect(departureListResponse.status).toBe(401);
  expect(fleetResponse.status).toBe(401);
  expect(paymentResponse.status).toBe(401);
  expect(searchResponse.status).toBe(401);
  expect(ticketResponse.status).toBe(401);
  expect(financeResponse.status).toBe(401);
});

test("registration and login endpoints enforce per-IP attempt limits", async () => {
  const registrationAttempts = await Promise.all(Array.from({ length: 6 }, () =>
    fetch(`${baseUrl}/api/v1/auth/register`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({})
    })
  ));
  expect(registrationAttempts.slice(0, 5).every((response) => response.status === 400)).toBe(true);
  expect(registrationAttempts[5].status).toBe(429);

  const loginAttempts = await Promise.all(Array.from({ length: 11 }, () =>
    fetch(`${baseUrl}/api/v1/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: "unknown@example.test", password: "not-a-valid-account" })
    })
  ));
  expect(loginAttempts[10].status).toBe(429);
  expect(loginAttempts[10].headers.get("retry-after")).toBeTruthy();
});

test("global search rejects terms that are too short", async () => {
  const response = await fetch(`${baseUrl}/api/v1/recherche?q=a`, {
    headers: { Authorization: `Bearer ${accessToken}` }
  });
  expect(response.status).toBe(400);
  const body = await response.json() as { success?: boolean };
  expect(body.success).toBe(false);
});

test("CORS only allows explicitly configured origins", async () => {
  const previous = process.env.CORS_ORIGINS;
  process.env.CORS_ORIGINS = "https://portal.transora.test";
  try {
    const allowed = await fetch(`${baseUrl}/health`, {
      headers: { Origin: "https://portal.transora.test" }
    });
    expect(allowed.headers.get("access-control-allow-origin")).toBe("https://portal.transora.test");
    expect(allowed.headers.get("access-control-allow-credentials")).toBe("true");

    const denied = await fetch(`${baseUrl}/health`, {
      headers: { Origin: "https://untrusted.example" }
    });
    expect(denied.headers.get("access-control-allow-origin")).toBeNull();
  } finally {
    if (previous === undefined) delete process.env.CORS_ORIGINS;
    else process.env.CORS_ORIGINS = previous;
  }
});

test("metrics endpoint is hidden unless a strong bearer token is configured", async () => {
  const previous = process.env.METRICS_TOKEN;
  try {
    delete process.env.METRICS_TOKEN;
    const hidden = await fetch(`${baseUrl}/metrics`);
    expect(hidden.status).toBe(404);

    process.env.METRICS_TOKEN = "metrics-test-token-with-at-least-32-characters";
    const denied = await fetch(`${baseUrl}/metrics`, {
      headers: { Authorization: "Bearer incorrect-token" }
    });
    expect(denied.status).toBe(401);

    const allowed = await fetch(`${baseUrl}/metrics`, {
      headers: { Authorization: `Bearer ${process.env.METRICS_TOKEN}` }
    });
    expect(allowed.status).toBe(200);
    const body = await allowed.json() as { memoryUsage?: unknown };
    expect(body.memoryUsage).toBeTruthy();
  } finally {
    if (previous === undefined) delete process.env.METRICS_TOKEN;
    else process.env.METRICS_TOKEN = previous;
  }
});

test("dashboard assets are served from the web root", async () => {
  const response = await fetch(`${baseUrl}/`);
  expect(response.status).toBe(200);
  const html = await response.text();
  expect(html).toMatch(/Transora — Tableau de bord/);
  expect(html).toMatch(/id="dashboard-date"/);
  expect(html).toMatch(/value="90">90 derniers jours/);
  expect(html).toMatch(/id="voyages-page"/);
  expect(html).toMatch(/id="fleet-page"/);
  expect(html).toMatch(/id="payments-page"/);
  expect(html).toMatch(/id="payment-rows"/);
  expect(html).toMatch(/id="reports-page"/);
  expect(html).toMatch(/id="report-start-date"/);
  expect(html).toMatch(/id="report-rows"/);
  expect(html).toMatch(/id="global-search"/);
  expect(html).toMatch(/id="scanner-dialog"/);
  expect(html).toMatch(/id="ticket-dialog"/);
});
