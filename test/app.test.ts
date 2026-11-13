import assert from "node:assert/strict";
import { after, before, test } from "node:test";
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

test("tenant, trip, fleet, payment, and finance APIs are protected when no bearer token is supplied", async () => {
  const [tenantResponse, tripResponse, departureListResponse, fleetResponse, paymentResponse, financeResponse] = await Promise.all([
    fetch(`${baseUrl}/api/v1/tenant`),
    fetch(`${baseUrl}/api/v1/voyages`),
    fetch(`${baseUrl}/api/v1/voyages/departures`),
    fetch(`${baseUrl}/api/v1/flotte`),
    fetch(`${baseUrl}/api/v1/paiements`),
    fetch(`${baseUrl}/api/v1/finance/`)
  ]);
  assert.equal(tenantResponse.status, 401);
  assert.equal(tripResponse.status, 401);
  assert.equal(departureListResponse.status, 401);
  assert.equal(fleetResponse.status, 401);
  assert.equal(paymentResponse.status, 401);
  assert.equal(financeResponse.status, 401);
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
});
