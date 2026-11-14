import { afterAll, beforeAll, expect, test } from "vitest";
import bcrypt from "bcryptjs";
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
  const [tenantResponse, tripResponse, departureListResponse, fleetResponse, paymentResponse, searchResponse, ticketResponse, financeResponse, guichetResponse, boardingResponse, departureStatusResponse] = await Promise.all([
    fetch(`${baseUrl}/api/v1/tenant`),
    fetch(`${baseUrl}/api/v1/voyages`),
    fetch(`${baseUrl}/api/v1/voyages/departures`),
    fetch(`${baseUrl}/api/v1/flotte`),
    fetch(`${baseUrl}/api/v1/paiements`),
    fetch(`${baseUrl}/api/v1/recherche?q=dupont`),
    fetch(`${baseUrl}/api/v1/recherche/billet/550e8400-e29b-41d4-a716-446655440000`),
    fetch(`${baseUrl}/api/v1/finance/`),
    fetch(`${baseUrl}/api/v1/guichet/session/current`),
    fetch(`${baseUrl}/api/v1/embarquement/stats`),
    fetch(`${baseUrl}/api/v1/voyages/departures/550e8400-e29b-41d4-a716-446655440000/status`, {
      method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ status: "BOARDING" })
    })
  ]);
  expect(tenantResponse.status).toBe(401);
  expect(tripResponse.status).toBe(401);
  expect(departureListResponse.status).toBe(401);
  expect(fleetResponse.status).toBe(401);
  expect(paymentResponse.status).toBe(401);
  expect(searchResponse.status).toBe(401);
  expect(ticketResponse.status).toBe(401);
  expect(financeResponse.status).toBe(401);
  expect(guichetResponse.status).toBe(401);
  expect(boardingResponse.status).toBe(401);
  expect(departureStatusResponse.status).toBe(401);
});

test("staff roles cannot manage company administration, finance, or sensitive records", async () => {
  const email = `app-test-driver-${Date.now()}@example.test`;
  const user = await pool.query(
    `INSERT INTO users (tenant_id, name, email, password_hash, role)
     VALUES ($1, 'Driver Test User', $2, 'test-hash', 'conducteur') RETURNING id`,
    [tenantId, email]
  );
  const driverId = user.rows[0].id as string;
  const driverSession = `app-test-driver-session-${Date.now()}`;
  await pool.query(
    "INSERT INTO user_sessions (id, user_id, tenant_id, refresh_token_hash, expires_at) VALUES ($1, $2, $3, $4, NOW() + INTERVAL '1 day')",
    [driverSession, driverId, tenantId, "f".repeat(64)]
  );
  const token = createAccessToken({
    id: driverId, email, role: "conducteur", tenantId, sessionId: driverSession
  });
  const headers = { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };
  const id = "550e8400-e29b-41d4-a716-446655440000";

  const [personnelList, personnelCreate, fleetCreate, fleetUpdate, fleetDelete,
    financeList, financeCreate, auditList, auditFraud, incidentUpdate,
    bookingCreate, fleetRead] = await Promise.all([
    fetch(`${baseUrl}/api/v1/personnel`, { headers }),
    fetch(`${baseUrl}/api/v1/personnel`, { method: "POST", headers, body: JSON.stringify({ nom: "Test", poste: "Conducteur" }) }),
    fetch(`${baseUrl}/api/v1/flotte`, { method: "POST", headers, body: JSON.stringify({ immatriculation: "TEST-ROLE", modele: "Bus", capacite: 30 }) }),
    fetch(`${baseUrl}/api/v1/flotte/${id}`, { method: "PUT", headers, body: JSON.stringify({ statut: "hors_service" }) }),
    fetch(`${baseUrl}/api/v1/flotte/${id}`, { method: "DELETE", headers }),
    fetch(`${baseUrl}/api/v1/finance`, { headers }),
    fetch(`${baseUrl}/api/v1/finance/operation`, { method: "POST", headers, body: JSON.stringify({ type: "dépense", montant: 1000 }) }),
    fetch(`${baseUrl}/api/v1/audit`, { headers }),
    fetch(`${baseUrl}/api/v1/audit/anti-fraude`, { method: "POST", headers, body: JSON.stringify({ analyse: {} }) }),
    fetch(`${baseUrl}/api/v1/incidents/${id}`, { method: "PUT", headers, body: JSON.stringify({ statut: "RESOLU" }) }),
    fetch(`${baseUrl}/api/v1/voyages/departures/${id}/bookings`, { method: "POST", headers, body: JSON.stringify({ passengerName: "Passager Test" }) }),
    fetch(`${baseUrl}/api/v1/flotte`, { headers })
  ]);

  for (const response of [personnelList, personnelCreate, fleetCreate, fleetUpdate, fleetDelete,
    financeList, financeCreate, auditList, auditFraud, incidentUpdate, bookingCreate]) {
    expect(response.status).toBe(403);
  }
  expect(fleetRead.status).toBe(200);

  const report = await fetch(`${baseUrl}/api/v1/incidents`, {
    method: "POST", headers,
    body: JSON.stringify({ type: "panne", description: "Signalement de test par un conducteur" })
  });
  expect(report.status).toBe(201);
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
  expect(html).toMatch(/id="guichet-page"/);

  const publicBooking = await fetch(`${baseUrl}/reservation.html`);
  expect(publicBooking.status).toBe(200);
  expect(await publicBooking.text()).toMatch(/Réserver votre voyage/);
});


test("company route tariffs control departures and preserve historical reservation amounts", async () => {
  const tenantBResult = await pool.query("INSERT INTO tenants (name) VALUES ('Tariff Isolation Tenant') RETURNING id");
  const tenantB = tenantBResult.rows[0].id as string;
  let userB: string | undefined;
  try {
    const emailB = `tariff-isolation-${Date.now()}@example.test`;
    const userResult = await pool.query(
      `INSERT INTO users (tenant_id, name, email, password_hash, role)
       VALUES ($1, 'Tariff Isolation User', $2, 'test-hash', 'administrateur') RETURNING id`,
      [tenantB, emailB]
    );
    userB = userResult.rows[0].id as string;
    const sessionB = `tariff-isolation-session-${Date.now()}`;
    await pool.query(
      "INSERT INTO user_sessions (id, user_id, tenant_id, refresh_token_hash, expires_at) VALUES ($1, $2, $3, $4, NOW() + INTERVAL '1 day')",
      [sessionB, userB, tenantB, "e".repeat(64)]
    );
    const tokenB = createAccessToken({ id: userB, email: emailB, role: "administrateur", tenantId: tenantB, sessionId: sessionB });
    const headersA = { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" };
    const headersB = { Authorization: `Bearer ${tokenB}`, "Content-Type": "application/json" };

    const legacyDeparture = await pool.query(
      `INSERT INTO departures (tenant_id, origin, destination, departure_at, vehicle_code, capacity, fare_amount)
       VALUES ($1, 'Ville Tarif A', 'Ville Tarif B', NOW() + INTERVAL '6 hours', 'TARIF-LEGACY', 2, 0)
       RETURNING id`,
      [tenantId]
    );

    const tariffResponse = await fetch(`${baseUrl}/api/v1/tarifs`, {
      method: "POST", headers: headersA,
      body: JSON.stringify({
        tenantId: tenantB,
        origin: "Ville Tarif A",
        destination: "Ville Tarif B",
        fareAmount: 4500,
        companyBookingFee: 250
      })
    });
    expect(tariffResponse.status).toBe(201);
    const tariffBody = await tariffResponse.json() as { data: { id: string; fareAmount: number; companyBookingFee: number } };
    expect(tariffBody.data.fareAmount).toBe(4500);
    expect(tariffBody.data.companyBookingFee).toBe(250);

    const applyTariff = await fetch(`${baseUrl}/api/v1/voyages/departures/${legacyDeparture.rows[0].id}/tarif`, {
      method: "PATCH", headers: headersA
    });
    expect(applyTariff.status).toBe(200);
    const appliedBody = await applyTariff.json() as { data: { fareAmount: number; companyBookingFee: number } };
    expect(appliedBody.data.fareAmount).toBe(4500);
    expect(appliedBody.data.companyBookingFee).toBe(250);

    const ownTariffs = await fetch(`${baseUrl}/api/v1/tarifs`, { headers: headersA });
    const ownBody = await ownTariffs.json() as { data: { tariffs: Array<{ id: string }> } };
    expect(ownBody.data.tariffs.some(item => item.id === tariffBody.data.id)).toBe(true);

    const foreignTariffs = await fetch(`${baseUrl}/api/v1/tarifs`, { headers: headersB });
    const foreignBody = await foreignTariffs.json() as { data: { tariffs: Array<{ id: string }> } };
    expect(foreignBody.data.tariffs).toHaveLength(0);

    const foreignTariffUpdate = await fetch(`${baseUrl}/api/v1/tarifs/${tariffBody.data.id}`, {
      method: "PATCH", headers: headersB,
      body: JSON.stringify({ fareAmount: 1, companyBookingFee: 0 })
    });
    expect(foreignTariffUpdate.status).toBe(404);

    const foreignDepartureTariffApply = await fetch(`${baseUrl}/api/v1/voyages/departures/${legacyDeparture.rows[0].id}/tarif`, {
      method: "PATCH", headers: headersB
    });
    expect(foreignDepartureTariffApply.status).toBe(409);

    const spoofedTenantTariff = await fetch(`${baseUrl}/api/v1/tarifs`, {
      method: "POST", headers: headersB,
      body: JSON.stringify({
        tenantId,
        origin: "Ville Tarif A",
        destination: "Ville Tarif B",
        fareAmount: 9900,
        companyBookingFee: 0
      })
    });
    expect(spoofedTenantTariff.status).toBe(201);
    const spoofedTenantTariffBody = await spoofedTenantTariff.json() as { data: { id: string } };

    const companyATariffsAfterSpoof = await fetch(`${baseUrl}/api/v1/tarifs`, { headers: headersA });
    const companyATariffsAfterSpoofBody = await companyATariffsAfterSpoof.json() as { data: { tariffs: Array<{ id: string }> } };
    expect(companyATariffsAfterSpoofBody.data.tariffs.some(item => item.id === spoofedTenantTariffBody.data.id)).toBe(false);

    const companyBTariffsAfterSpoof = await fetch(`${baseUrl}/api/v1/tarifs`, { headers: headersB });
    const companyBTariffsAfterSpoofBody = await companyBTariffsAfterSpoof.json() as { data: { tariffs: Array<{ id: string }> } };
    expect(companyBTariffsAfterSpoofBody.data.tariffs.some(item => item.id === tariffBody.data.id)).toBe(false);
    expect(companyBTariffsAfterSpoofBody.data.tariffs.some(item => item.id === spoofedTenantTariffBody.data.id)).toBe(true);

    const missingTariffDeparture = await fetch(`${baseUrl}/api/v1/voyages/departures`, {
      method: "POST", headers: headersA,
      body: JSON.stringify({
        origin: "Ville Sans Tarif A", destination: "Ville Sans Tarif B",
        departureAt: new Date(Date.now() + 4 * 60 * 60 * 1000).toISOString(),
        vehicleCode: "TARIF-MISSING", capacity: 3, fareAmount: 999
      })
    });
    expect(missingTariffDeparture.status).toBe(409);

    const departureResponse = await fetch(`${baseUrl}/api/v1/voyages/departures`, {
      method: "POST", headers: headersA,
      body: JSON.stringify({
        origin: "Ville Tarif A", destination: "Ville Tarif B",
        departureAt: new Date(Date.now() + 4 * 60 * 60 * 1000).toISOString(),
        vehicleCode: "TARIF-TEST", capacity: 3, fareAmount: 1
      })
    });
    expect(departureResponse.status).toBe(201);
    const departureBody = await departureResponse.json() as { data: { id: string; fareAmount: number; companyBookingFee: number } };
    expect(departureBody.data.fareAmount).toBe(4500);
    expect(departureBody.data.companyBookingFee).toBe(250);

    const bookingResponse = await fetch(`${baseUrl}/api/v1/voyages/departures/${departureBody.data.id}/bookings`, {
      method: "POST", headers: headersA,
      body: JSON.stringify({ passengerName: "Passager Tarif" })
    });
    expect(bookingResponse.status).toBe(201);
    const bookingBody = await bookingResponse.json() as { data: { id: string; amountTransport: number; companyBookingFee: number; platformFee: number } };
    expect(bookingBody.data.amountTransport).toBe(4500);
    expect(bookingBody.data.companyBookingFee).toBe(250);
    expect(bookingBody.data.platformFee).toBe(100);

    const companyInfo = await pool.query("SELECT public_code FROM tenants WHERE id = $1", [tenantId]);
    const publicReservation = await fetch(`${baseUrl}/api/public/${companyInfo.rows[0].public_code}/reservations`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        departureId: departureBody.data.id,
        passengerName: "Passager Web Tarif",
        passengerPhone: "+2250700000000"
      })
    });
    expect(publicReservation.status).toBe(201);
    const publicReservationBody = await publicReservation.json() as {
      data: { bookingId: string; transportAmount: number; companyBookingFee: number; platformFee: number; totalAmount: number }
    };
    expect(publicReservationBody.data.transportAmount).toBe(4500);
    expect(publicReservationBody.data.companyBookingFee).toBe(250);
    expect(publicReservationBody.data.platformFee).toBe(100);
    expect(publicReservationBody.data.totalAmount).toBe(4850);

    const cashDeskSession = await fetch(`${baseUrl}/api/v1/guichet/session`, {
      method: "POST",
      headers: headersA,
      body: JSON.stringify({ openingAmount: 50000 })
    });
    expect(cashDeskSession.status).toBe(201);

    const cashDeskSale = await fetch(`${baseUrl}/api/v1/guichet/vente`, {
      method: "POST",
      headers: headersA,
      body: JSON.stringify({ departureId: departureBody.data.id, passengerName: "Passager Guichet Tarif" })
    });
    expect(cashDeskSale.status).toBe(201);
    const cashDeskSaleBody = await cashDeskSale.json() as {
      data: { id: string; amountTransport: number; companyBookingFee: number; platformFee: number; totalPaid: number }
    };
    expect(cashDeskSaleBody.data.amountTransport).toBe(4500);
    expect(cashDeskSaleBody.data.companyBookingFee).toBe(250);
    expect(cashDeskSaleBody.data.platformFee).toBe(100);
    expect(cashDeskSaleBody.data.totalPaid).toBe(4850);

    const cashDeskPayment = await pool.query(
      `SELECT amount_transport, company_booking_fee, platform_fee, status
       FROM payments WHERE booking_id = $1 AND tenant_id = $2`,
      [cashDeskSaleBody.data.id, tenantId]
    );
    expect(cashDeskPayment.rowCount).toBe(1);
    expect(Number(cashDeskPayment.rows[0].amount_transport)).toBe(4500);
    expect(Number(cashDeskPayment.rows[0].company_booking_fee)).toBe(250);
    expect(Number(cashDeskPayment.rows[0].platform_fee)).toBe(100);
    expect(cashDeskPayment.rows[0].status).toBe("CONFIRMED");

    const cashDeskOperation = await pool.query(
      "SELECT amount FROM guichet_operations WHERE booking_id = $1 AND tenant_id = $2 AND type = 'SALE'",
      [cashDeskSaleBody.data.id, tenantId]
    );
    expect(cashDeskOperation.rowCount).toBe(1);
    expect(Number(cashDeskOperation.rows[0].amount)).toBe(4850);

    const cashDeskSessionBody = await cashDeskSession.json() as { data: { id: string } };
    const closeCashDesk = await fetch(`${baseUrl}/api/v1/guichet/session/${cashDeskSessionBody.data.id}/close`, {
      method: "POST",
      headers: headersA,
      body: JSON.stringify({ closingAmount: 54850 })
    });
    expect(closeCashDesk.status).toBe(200);
    const closeCashDeskBody = await closeCashDesk.json() as { data: { discrepancy: number } };
    expect(closeCashDeskBody.data.discrepancy).toBe(0);

    const updateResponse = await fetch(`${baseUrl}/api/v1/tarifs/${tariffBody.data.id}`, {
      method: "PATCH", headers: headersA,
      body: JSON.stringify({ fareAmount: 5200, companyBookingFee: 400 })
    });
    expect(updateResponse.status).toBe(200);

    const snapshots = await pool.query(
      `SELECT d.fare_amount, d.company_booking_fee, b.amount_transport, b.company_booking_fee AS booking_company_fee
       FROM departures d JOIN bookings b ON b.departure_id = d.id AND b.tenant_id = d.tenant_id
       WHERE d.id = $1 AND b.id = ANY($2::uuid[]) AND d.tenant_id = $3`,
      [departureBody.data.id,
        [bookingBody.data.id, publicReservationBody.data.bookingId, cashDeskSaleBody.data.id],
        tenantId]
    );
    expect(snapshots.rowCount).toBe(3);
    expect(Number(snapshots.rows[0].fare_amount)).toBe(4500);
    expect(Number(snapshots.rows[0].company_booking_fee)).toBe(250);
    expect(snapshots.rows.every(row => Number(row.amount_transport) === 4500)).toBe(true);
    expect(snapshots.rows.every(row => Number(row.booking_company_fee) === 250)).toBe(true);
  } finally {
    await pool.query("DELETE FROM tenants WHERE id = $1", [tenantB]);
  }
});

test("booking tickets, public reservations, cash desk and boarding stay isolated by tenant", async () => {
  const tenantBResult = await pool.query("INSERT INTO tenants (name) VALUES ('App Test Tenant B') RETURNING id, public_code");
  const tenantB = tenantBResult.rows[0].id as string;
  let userB: string | undefined;
  try {
    const emailB = `app-test-b-${Date.now()}@example.test`;
    const userResult = await pool.query(
      `INSERT INTO users (tenant_id, name, email, password_hash, role)
       VALUES ($1, 'App Test User B', $2, 'test-hash', 'administrateur') RETURNING id`,
      [tenantB, emailB]
    );
    userB = userResult.rows[0].id;
    const sessionB = `app-test-b-session-${Date.now()}`;
    await pool.query(
      "INSERT INTO user_sessions (id, user_id, tenant_id, refresh_token_hash, expires_at) VALUES ($1, $2, $3, $4, NOW() + INTERVAL '1 day')",
      [sessionB, userB, tenantB, "d".repeat(64)]
    );
    const tokenB = createAccessToken({ id: userB, email: emailB, role: "administrateur", tenantId: tenantB, sessionId: sessionB });
    const headersA = { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" };
    const headersB = { Authorization: `Bearer ${tokenB}`, "Content-Type": "application/json" };

    const departureResult = await pool.query(
      `INSERT INTO departures (tenant_id, origin, destination, departure_at, vehicle_code, capacity, fare_amount)
       VALUES ($1, 'Abidjan', 'Bouaké', NOW() + INTERVAL '3 hours', 'TEST-A', 3, 1500) RETURNING id`,
      [tenantId]
    );
    const departureId = departureResult.rows[0].id as string;
    const publicDepartureResult = await pool.query(
      `INSERT INTO departures (tenant_id, origin, destination, departure_at, vehicle_code, capacity, fare_amount)
       VALUES ($1, 'Abidjan', 'Yamoussoukro', NOW() + INTERVAL '5 hours', 'TEST-PUBLIC', 2, 2500) RETURNING id`,
      [tenantId]
    );
    const publicDepartureId = publicDepartureResult.rows[0].id as string;

    const bookingResponse = await fetch(`${baseUrl}/api/v1/voyages/departures/${departureId}/bookings`, {
      method: "POST", headers: headersA, body: JSON.stringify({ passengerName: "Passager Réservé" })
    });
    expect(bookingResponse.status).toBe(201);
    const bookingBody = await bookingResponse.json() as { data: { id: string; ticketToken: string; status: string; seatNumber: number } };
    expect(bookingBody.data.status).toBe("RESERVED");
    expect(bookingBody.data.seatNumber).toBe(1);

    const ticketResponse = await fetch(`${baseUrl}/api/v1/recherche/billet/${bookingBody.data.ticketToken}?images=true`, { headers: headersA });
    expect(ticketResponse.status).toBe(200);
    const ticketBody = await ticketResponse.json() as { data: { qrCode?: string; codeBarres?: string; valide: boolean } };
    expect(ticketBody.data.qrCode).toMatch(/^data:image\/png;base64,/);
    expect(ticketBody.data.codeBarres).toMatch(/^data:image\/png;base64,/);
    expect(ticketBody.data.valide).toBe(false);

    const foreignTicket = await fetch(`${baseUrl}/api/v1/recherche/billet/${bookingBody.data.ticketToken}`, { headers: headersB });
    expect(foreignTicket.status).toBe(404);
    const unpaidBoarding = await fetch(`${baseUrl}/api/v1/embarquement/valider`, {
      method: "POST", headers: headersA, body: JSON.stringify({ billetId: bookingBody.data.ticketToken })
    });
    expect(unpaidBoarding.status).toBe(409);

    const sessionResponse = await fetch(`${baseUrl}/api/v1/guichet/session`, {
      method: "POST", headers: headersA, body: JSON.stringify({ openingAmount: 50000 })
    });
    expect(sessionResponse.status).toBe(201);
    const sessionBody = await sessionResponse.json() as { data: { id: string } };

    const saleResponse = await fetch(`${baseUrl}/api/v1/guichet/vente`, {
      method: "POST", headers: headersA,
      body: JSON.stringify({ departureId, passengerName: "Passager Guichet" })
    });
    expect(saleResponse.status).toBe(201);
    const saleBody = await saleResponse.json() as { data: { id: string; ticketToken: string; totalPaid: number; seatNumber: number } };
    expect(saleBody.data.seatNumber).toBe(2);

    const earlyBoarding = await fetch(`${baseUrl}/api/v1/embarquement/valider`, {
      method: "POST", headers: headersA, body: JSON.stringify({ billetId: saleBody.data.ticketToken })
    });
    expect(earlyBoarding.status).toBe(409);

    const openBoarding = await fetch(`${baseUrl}/api/v1/voyages/departures/${departureId}/status`, {
      method: "PATCH", headers: headersA, body: JSON.stringify({ status: "BOARDING" })
    });
    expect(openBoarding.status).toBe(200);
    const boardingResponse = await fetch(`${baseUrl}/api/v1/embarquement/valider`, {
      method: "POST", headers: headersA, body: JSON.stringify({ billetId: saleBody.data.ticketToken, scannerId: "test-scanner" })
    });
    expect(boardingResponse.status).toBe(200);
    const duplicateBoarding = await fetch(`${baseUrl}/api/v1/embarquement/valider`, {
      method: "POST", headers: headersA, body: JSON.stringify({ billetId: saleBody.data.ticketToken })
    });
    expect(duplicateBoarding.status).toBe(409);
    const foreignBoarding = await fetch(`${baseUrl}/api/v1/embarquement/valider`, {
      method: "POST", headers: headersB, body: JSON.stringify({ billetId: saleBody.data.ticketToken })
    });
    expect(foreignBoarding.status).toBe(404);

    const foreignSession = await fetch(`${baseUrl}/api/v1/guichet/session/${sessionBody.data.id}`, { headers: headersB });
    expect(foreignSession.status).toBe(404);
    const closeResponse = await fetch(`${baseUrl}/api/v1/guichet/session/${sessionBody.data.id}/close`, {
      method: "POST", headers: headersA,
      body: JSON.stringify({ closingAmount: 50000 + saleBody.data.totalPaid })
    });
    expect(closeResponse.status).toBe(200);
    const closeBody = await closeResponse.json() as { data: { discrepancy: number } };
    expect(closeBody.data.discrepancy).toBe(0);

    const tenantAInfo = await pool.query("SELECT public_code FROM tenants WHERE id = $1", [tenantId]);
    const publicCodeA = tenantAInfo.rows[0].public_code as string;
    const publicList = await fetch(`${baseUrl}/api/public/${publicCodeA}/departs`);
    expect(publicList.status).toBe(200);
    const publicBooking = await fetch(`${baseUrl}/api/public/${publicCodeA}/reservations`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ departureId: publicDepartureId, passengerName: "Client Web", passengerPhone: "+2250700000000" })
    });
    expect(publicBooking.status).toBe(201);
    const publicBody = await publicBooking.json() as { data: { ticketToken: string; qrCode: string; paymentStatus: string } };
    expect(publicBody.data.qrCode).toMatch(/^data:image\/png;base64,/);
    expect(publicBody.data.paymentStatus).toBe("NOT_INITIATED");

    const publicTicket = await fetch(`${baseUrl}/api/public/${publicCodeA}/ticket/${publicBody.data.ticketToken}`);
    expect(publicTicket.status).toBe(200);
    const publicCodeB = tenantBResult.rows[0].public_code as string;
    const crossCompanyPublicTicket = await fetch(`${baseUrl}/api/public/${publicCodeB}/ticket/${publicBody.data.ticketToken}`);
    expect(crossCompanyPublicTicket.status).toBe(404);
    const crossCompanyPublicBooking = await fetch(`${baseUrl}/api/public/${publicCodeB}/reservations`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ departureId: publicDepartureId, passengerName: "Intrus", passengerPhone: "+2250700000000" })
    });
    expect(crossCompanyPublicBooking.status).toBe(404);
  } finally {
    await pool.query("DELETE FROM tenants WHERE id = $1", [tenantB]);
  }
});


test("courier workflow enforces company tariffs, driver handoff, transit and recipient delivery", async () => {
  const driverEmail = `app-test-courier-driver-${Date.now()}@example.test`;
  const driver = await pool.query(
    `INSERT INTO users (tenant_id, name, email, password_hash, role)
     VALUES ($1, 'Courier Driver', $2, 'test-hash', 'chauffeur') RETURNING id`,
    [tenantId, driverEmail]
  );
  const driverId = driver.rows[0].id as string;
  const driverSession = `app-test-courier-session-${Date.now()}`;
  await pool.query(
    "INSERT INTO user_sessions (id, user_id, tenant_id, refresh_token_hash, expires_at) VALUES ($1, $2, $3, $4, NOW() + INTERVAL '1 day')",
    [driverSession, driverId, tenantId, "d".repeat(64)]
  );
  const driverToken = createAccessToken({
    id: driverId, email: driverEmail, role: "chauffeur", tenantId, sessionId: driverSession
  });
  const driverHeaders = { Authorization: `Bearer ${driverToken}`, "Content-Type": "application/json" };
  const adminHeaders = { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" };

  const tariff = await fetch(`${baseUrl}/api/v1/courrier/tarifs`, {
    method: "POST", headers: adminHeaders,
    body: JSON.stringify({ origin: "Abidjan", destination: "Yamoussoukro", amountFcfa: 2500 })
  });
  expect(tariff.status).toBe(201);

  const transportTariff = await fetch(`${baseUrl}/api/v1/tarifs`, {
    method: "POST", headers: adminHeaders,
    body: JSON.stringify({ origin: "Abidjan", destination: "Yamoussoukro", fareAmount: 5000, companyBookingFee: 0 })
  });
  expect(transportTariff.status).toBe(201);

  const departure = await fetch(`${baseUrl}/api/v1/voyages/departures`, {
    method: "POST", headers: adminHeaders,
    body: JSON.stringify({
      origin: "Abidjan", destination: "Yamoussoukro",
      departureAt: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
      vehicleCode: "COURRIER-TEST", capacity: 30
    })
  });
  expect(departure.status).toBe(201);
  const departureBody = await departure.json() as { data: { id: string } };

  const created = await fetch(`${baseUrl}/api/v1/courrier/colis`, {
    method: "POST", headers: adminHeaders,
    body: JSON.stringify({
      origin: "Abidjan", destination: "Yamoussoukro",
      senderName: "Expéditeur Test", senderPhone: "+2250700000001",
      recipientName: "Destinataire Test", recipientPhone: "+2250700000002",
      description: "Documents administratifs", weightKg: 1.5, declaredValue: 10000
    })
  });
  expect(created.status).toBe(201);
  const createdBody = await created.json() as {
    data: { id: string; trackingCode: string; amountFcfa: number; status: string };
  };
  expect(Number(createdBody.data.amountFcfa)).toBe(2500);
  expect(createdBody.data.status).toBe("EN_ATTENTE_PAIEMENT");

  const cashSession = await fetch(`${baseUrl}/api/v1/guichet/session`, {
    method: "POST", headers: adminHeaders, body: JSON.stringify({ openingAmount: 0 })
  });
  expect(cashSession.status).toBe(201);

  const payment = await fetch(`${baseUrl}/api/v1/courrier/colis/${createdBody.data.id}/paiement`, {
    method: "POST", headers: adminHeaders, body: JSON.stringify({ paymentMethod: "cash" })
  });
  expect(payment.status).toBe(200);

  const receipt = await fetch(`${baseUrl}/api/v1/courrier/colis/${createdBody.data.id}/recu`, { headers: adminHeaders });
  expect(receipt.status).toBe(200);
  const receiptBody = await receipt.json() as { data: { type: string; trackingCode: string; amountFcfa: number } };
  expect(receiptBody.data.type).toBe("recu_courrier");
  expect(receiptBody.data.trackingCode).toBe(createdBody.data.trackingCode);
  expect(receiptBody.data.amountFcfa).toBe(2500);

  const assignment = await fetch(`${baseUrl}/api/v1/courrier/colis/${createdBody.data.id}/affectation`, {
    method: "PATCH", headers: adminHeaders,
    body: JSON.stringify({ departureId: departureBody.data.id, driverUserId: driverId })
  });
  expect(assignment.status).toBe(200);

  const driverAssignments = await fetch(`${baseUrl}/api/v1/courrier/chauffeur/affectations`, { headers: driverHeaders });
  expect(driverAssignments.status).toBe(200);
  const assignmentsBody = await driverAssignments.json() as { data: Array<{ id: string }> };
  expect(assignmentsBody.data.some((item) => item.id === createdBody.data.id)).toBe(true);

  const handoff = await fetch(`${baseUrl}/api/v1/courrier/colis/${createdBody.data.id}/prise-en-charge`, {
    method: "PATCH", headers: driverHeaders, body: JSON.stringify({})
  });
  expect(handoff.status).toBe(200);
  const transit = await fetch(`${baseUrl}/api/v1/courrier/colis/${createdBody.data.id}/en-transit`, {
    method: "PATCH", headers: driverHeaders, body: JSON.stringify({})
  });
  expect(transit.status).toBe(200);

  const arrival = await fetch(`${baseUrl}/api/v1/courrier/colis/${createdBody.data.id}/arrivee`, {
    method: "PATCH", headers: adminHeaders, body: JSON.stringify({})
  });
  expect(arrival.status).toBe(200);
  const delivery = await fetch(`${baseUrl}/api/v1/courrier/colis/${createdBody.data.id}/remise`, {
    method: "PATCH", headers: adminHeaders,
    body: JSON.stringify({ receiverName: "Destinataire Test", receiverReference: "CNI-TEST" })
  });
  expect(delivery.status).toBe(200);

  const tracking = await fetch(`${baseUrl}/api/v1/courrier/suivi/${createdBody.data.trackingCode}`, {
    headers: adminHeaders
  });
  expect(tracking.status).toBe(200);
  const trackingBody = await tracking.json() as {
    data: { parcel: { status: string; paymentStatus: string }; history: Array<{ eventType: string }> };
  };
  expect(trackingBody.data.parcel.status).toBe("REMIS");
  expect(trackingBody.data.parcel.paymentStatus).toBe("PAID");

  const publicTracking = await fetch(`${baseUrl}/api/public/courrier/${createdBody.data.trackingCode}`);
  expect(publicTracking.status).toBe(200);
  const publicTrackingBody = await publicTracking.json() as {
    data: { parcel: { status: string; trackingCode: string; senderPhone?: string; recipientPhone?: string } };
  };
  expect(publicTrackingBody.data.parcel.status).toBe("REMIS");
  expect(publicTrackingBody.data.parcel.trackingCode).toBe(createdBody.data.trackingCode);
  expect(publicTrackingBody.data.parcel.senderPhone).toBeUndefined();
  expect(publicTrackingBody.data.parcel.recipientPhone).toBeUndefined();

  expect(trackingBody.data.history.map((event) => event.eventType)).toEqual([
    "ENREGISTRE", "PAYE", "AFFECTE", "CONFIE_CHAUFFEUR", "EN_TRANSIT", "ARRIVE", "REMIS"
  ]);

  const cashClose = await fetch(`${baseUrl}/api/v1/guichet/session/current`, { headers: adminHeaders });
  expect(cashClose.status).toBe(200);
  const cashCloseBody = await cashClose.json() as { data: { id: string } };
  const close = await fetch(`${baseUrl}/api/v1/guichet/session/${cashCloseBody.data.id}/close`, {
    method: "POST", headers: adminHeaders, body: JSON.stringify({ closingAmount: 2500 })
  });
  expect(close.status).toBe(200);
  const closeBody = await close.json() as { data: { discrepancy: number } };
  expect(closeBody.data.discrepancy).toBe(0);
});


test("administrator provisions a role-specific staff account and deactivation revokes access", async () => {
  const email = `app-test-courier-agent-${Date.now()}@example.test`;
  const headers = { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" };
  const employee = await fetch(`${baseUrl}/api/v1/personnel`, {
    method: "POST", headers,
    body: JSON.stringify({ nom: "Agent Courrier Test", poste: "Agent courrier", role: "agent_courrier", email })
  });
  expect(employee.status).toBe(201);
  const employeeBody = await employee.json() as { data: { id: string } };

  const account = await fetch(`${baseUrl}/api/v1/personnel/${employeeBody.data.id}/compte`, {
    method: "POST", headers,
    body: JSON.stringify({ motDePasse: "MotDePasseTest!2026" })
  });
  expect(account.status).toBe(201);

  const stored = await pool.query("SELECT id, role, password_hash FROM users WHERE email = $1 AND tenant_id = $2", [email, tenantId]);
  expect(stored.rowCount).toBe(1);
  expect(stored.rows[0].role).toBe("agent_courrier");
  expect(await bcrypt.compare("MotDePasseTest!2026", stored.rows[0].password_hash)).toBe(true);
  const agentSession = `app-test-courier-agent-session-${Date.now()}`;
  await pool.query(
    "INSERT INTO user_sessions (id, user_id, tenant_id, refresh_token_hash, expires_at) VALUES ($1, $2, $3, $4, NOW() + INTERVAL '1 day')",
    [agentSession, stored.rows[0].id, tenantId, "e".repeat(64)]
  );
  const agentToken = createAccessToken({ id: stored.rows[0].id, email, role: stored.rows[0].role, tenantId, sessionId: agentSession });
  const agentHeaders = { Authorization: `Bearer ${agentToken}`, "Content-Type": "application/json" };

  const finance = await fetch(`${baseUrl}/api/v1/finance/`, { headers: agentHeaders });
  expect(finance.status).toBe(403);
  const courierRead = await fetch(`${baseUrl}/api/v1/courrier/colis`, { headers: agentHeaders });
  expect(courierRead.status).toBe(200);

  const deactivate = await fetch(`${baseUrl}/api/v1/personnel/${employeeBody.data.id}`, {
    method: "PUT", headers, body: JSON.stringify({ statut: "inactif" })
  });
  expect(deactivate.status).toBe(200);
  const blockedSession = await fetch(`${baseUrl}/api/v1/courrier/colis`, { headers: agentHeaders });
  expect(blockedSession.status).toBe(401);
});
