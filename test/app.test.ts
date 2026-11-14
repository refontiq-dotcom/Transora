import { afterAll, beforeAll, expect, test } from "vitest";
import jwt from "jsonwebtoken";
import app from "../src/app";
import type { AddressInfo } from "node:net";

let server: ReturnType<typeof app.listen>;
let baseUrl: string;

beforeAll(async () => {
  server = app.listen(0);
  await new Promise<void>((resolve, reject) => {
    server.once("listening", resolve);
    server.once("error", reject);
  });
  const address = server.address() as AddressInfo;
  baseUrl = `http://127.0.0.1:${address.port}`;
});

afterAll(async () => {
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

test("global search rejects terms that are too short", async () => {
  const previousSecret = process.env.JWT_SECRET;
  const secret = "test-search-route-signing-secret";
  process.env.JWT_SECRET = secret;
  const token = jwt.sign(
    { email: "agent@example.test", role: "administrateur", tenantId: "550e8400-e29b-41d4-a716-446655440001" },
    secret,
    { subject: "550e8400-e29b-41d4-a716-446655440002", algorithm: "HS256", issuer: "transora-api", audience: "transora-clients", expiresIn: "8h" }
  );
  try {
    const response = await fetch(`${baseUrl}/api/v1/recherche?q=a`, {
      headers: { Authorization: `Bearer ${token}` }
    });
    expect(response.status).toBe(400);
    const body = await response.json() as { success?: boolean };
    expect(body.success).toBe(false);
  } finally {
    if (previousSecret === undefined) delete process.env.JWT_SECRET;
    else process.env.JWT_SECRET = previousSecret;
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
