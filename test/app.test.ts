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

    const ownTariffs = await fetch(`${baseUrl}/api/v1/tarifs`, { headers: headersA });
    const ownBody = await ownTariffs.json() as { data: { tariffs: Array<{ id: string }> } };
    expect(ownBody.data.tariffs.some(item => item.id === tariffBody.data.id)).toBe(true);

    const foreignTariffs = await fetch(`${baseUrl}/api/v1/tarifs`, { headers: headersB });
    const foreignBody = await foreignTariffs.json() as { data: { tariffs: unknown[] } };
    expect(foreignBody.data.tariffs).toHaveLength(0);

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

    const updateResponse = await fetch(`${baseUrl}/api/v1/tarifs/${tariffBody.data.id}`, {
      method: "PATCH", headers: headersA,
      body: JSON.stringify({ fareAmount: 5200, companyBookingFee: 400 })
    });
    expect(updateResponse.status).toBe(200);

    const snapshots = await pool.query(
      `SELECT d.fare_amount, d.company_booking_fee, b.amount_transport, b.company_booking_fee AS booking_company_fee
       FROM departures d JOIN bookings b ON b.departure_id = d.id AND b.tenant_id = d.tenant_id
       WHERE d.id = $1 AND b.id = $2 AND d.tenant_id = $3`,
      [departureBody.data.id, bookingBody.data.id, tenantId]
    );
    expect(Number(snapshots.rows[0].fare_amount)).toBe(4500);
    expect(Number(snapshots.rows[0].company_booking_fee)).toBe(250);
    expect(Number(snapshots.rows[0].amount_transport)).toBe(4500);
    expect(Number(snapshots.rows[0].booking_company_fee)).toBe(250);
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
