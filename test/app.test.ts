import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import jwt from "jsonwebtoken";
import app from "../src/app";
import { AddressInfo } from "node:net";

let server: ReturnType<typeof app.listen>;
let baseUrl: string;

before(async () => {
  server = app.listen(0);
  await new Promise<void>((resolve, reject) => {
    server.once("listening", resolve);
    server.once("error", reject);
  });
  const address = server.address() as AddressInfo;
  baseUrl = `http://127.0.0.1:${address.port}`;
});

after(async () => {
  await new Promise<void>((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve());
  });
});

test("health endpoint returns the API status", async () => {
  const response = await fetch(`${baseUrl}/health`);
  assert.equal(response.status, 200);
  const body = await response.json() as { status?: string };
  assert.equal(body.status, "ok");
});

test("dashboard is protected when no bearer token is supplied", async () => {
  const response = await fetch(`${baseUrl}/api/v1/dashboard?date=2026-11-12&period=30`);
  assert.equal(response.status, 401);
  const body = await response.json() as { success?: boolean };
  assert.equal(body.success, false);
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
  assert.equal(tenantResponse.status, 401);
  assert.equal(tripResponse.status, 401);
  assert.equal(departureListResponse.status, 401);
  assert.equal(fleetResponse.status, 401);
  assert.equal(paymentResponse.status, 401);
  assert.equal(searchResponse.status, 401);
  assert.equal(ticketResponse.status, 401);
  assert.equal(financeResponse.status, 401);
});

test("global search rejects terms that are too short", async () => {
  const previousSecret = process.env.JWT_SECRET;
  const secret = "test-search-route-signing-secret";
  process.env.JWT_SECRET = secret;
  const token = jwt.sign(
    { email: "agent@example.test", role: "administrateur", tenantId: "550e8400-e29b-41d4-a716-446655440001" },
    secret,
    { subject: "550e8400-e29b-41d4-a716-446655440002" }
  );
  try {
    const response = await fetch(`${baseUrl}/api/v1/recherche?q=a`, {
      headers: { Authorization: `Bearer ${token}` }
    });
    assert.equal(response.status, 400);
    const body = await response.json() as { success?: boolean };
    assert.equal(body.success, false);
  } finally {
    if (previousSecret === undefined) delete process.env.JWT_SECRET;
    else process.env.JWT_SECRET = previousSecret;
  }
});

test("dashboard assets are served from the web root", async () => {
  const response = await fetch(`${baseUrl}/`);
  assert.equal(response.status, 200);
  const html = await response.text();
  assert.match(html, /Transora — Tableau de bord/);
  assert.match(html, /id="dashboard-date"/);
  assert.match(html, /value="90">90 derniers jours/);
  assert.match(html, /id="voyages-page"/);
  assert.match(html, /id="fleet-page"/);
  assert.match(html, /id="payments-page"/);
  assert.match(html, /id="payment-rows"/);
  assert.match(html, /id="reports-page"/);
  assert.match(html, /id="report-start-date"/);
  assert.match(html, /id="report-rows"/);
  assert.match(html, /id="global-search"/);
  assert.match(html, /id="scanner-dialog"/);
  assert.match(html, /id="ticket-dialog"/);
});
