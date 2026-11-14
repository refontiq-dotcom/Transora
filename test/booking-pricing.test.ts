import jwt from "jsonwebtoken";
import { AddressInfo } from "node:net";
import { afterAll, beforeAll, expect, test } from "vitest";
import app from "../src/app";
import { pool } from "../src/db/pool";

const jwtSecret = "booking-pricing-test-secret-key-at-least-32-characters";
let server: ReturnType<typeof app.listen>;
let baseUrl: string;
let tenantId: string;
let userId: string;
let token: string;

beforeAll(async () => {
  process.env.JWT_SECRET = jwtSecret;
  server = app.listen(0);
  await new Promise<void>((resolve, reject) => {
    server.once("listening", resolve);
    server.once("error", reject);
  });
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

  const tenant = await pool.query(
    "INSERT INTO tenants (name) VALUES ('Booking pricing test') RETURNING id"
  );
  tenantId = tenant.rows[0].id;
  const user = await pool.query(
    `INSERT INTO users (tenant_id, name, email, password_hash, role)
     VALUES ($1, 'Pricing Admin', $2, 'test-hash', 'administrateur')
     RETURNING id`,
    [tenantId, `pricing-${tenantId}@test.local`]
  );
  userId = user.rows[0].id;
  token = jwt.sign(
    { email: `pricing-${tenantId}@test.local`, role: "administrateur", tenantId },
    jwtSecret,
    { subject: userId }
  );
});

afterAll(async () => {
  if (tenantId) await pool.query("DELETE FROM tenants WHERE id = $1", [tenantId]);
  if (server) {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => error ? reject(error) : resolve());
    });
  }
});

const authHeaders = {
  Authorization: () => `Bearer ${token}`,
  "Content-Type": "application/json"
};

test("a booking uses the tenant route fare, ignores a client-supplied amount, and snapshots the 100 FCFA fee", async () => {
  const fareResponse = await fetch(`${baseUrl}/api/v1/voyages/fares`, {
    method: "PUT",
    headers: { Authorization: authHeaders.Authorization(), "Content-Type": "application/json" },
    body: JSON.stringify({ origin: "Abidjan", destination: "Bouaké", amountFcfa: 24500 })
  });
  expect(fareResponse.status).toBe(200);

  const departureResponse = await fetch(`${baseUrl}/api/v1/voyages/departures`, {
    method: "POST",
    headers: { Authorization: authHeaders.Authorization(), "Content-Type": "application/json" },
    body: JSON.stringify({
      origin: "ABIDJAN",
      destination: "BOUAKÉ",
      departureAt: new Date(Date.now() + 86_400_000).toISOString(),
      vehicleCode: "PRICING-TEST",
      capacity: 12
    })
  });
  expect(departureResponse.status).toBe(201);
  const departure = await departureResponse.json() as { data: { id: string } };

  const bookingResponse = await fetch(
    `${baseUrl}/api/v1/voyages/departures/${departure.data.id}/bookings`,
    {
      method: "POST",
      headers: { Authorization: authHeaders.Authorization(), "Content-Type": "application/json" },
      body: JSON.stringify({ passengerName: "Passenger Test", amountTransport: 1 })
    }
  );
  expect(bookingResponse.status).toBe(201);
  const booking = await bookingResponse.json() as {
    data: { id: string; amountTransport: number; platformFee: number };
  };
  expect(Number(booking.data.amountTransport)).toBe(24500);
  expect(Number(booking.data.platformFee)).toBe(100);

  const paymentResponse = await fetch(`${baseUrl}/api/v1/paiements/init`, {
    method: "POST",
    headers: { Authorization: authHeaders.Authorization(), "Content-Type": "application/json" },
    body: JSON.stringify({ billetId: booking.data.id, moyenPaiement: "cash" })
  });
  expect(paymentResponse.status).toBe(201);
  const payment = await paymentResponse.json() as {
    data: { montantTransport: number; fraisTransora: number; totalPayeur: number };
  };
  expect(Number(payment.data.montantTransport)).toBe(24500);
  expect(Number(payment.data.fraisTransora)).toBe(100);
  expect(Number(payment.data.totalPayeur)).toBe(24600);

  const fareUpdate = await fetch(`${baseUrl}/api/v1/voyages/fares`, {
    method: "PUT",
    headers: { Authorization: authHeaders.Authorization(), "Content-Type": "application/json" },
    body: JSON.stringify({ origin: "abidjan", destination: "bouaké", amountFcfa: 26000 })
  });
  expect(fareUpdate.status).toBe(200);
  const storedBooking = await pool.query(
    "SELECT amount_transport, platform_fee FROM bookings WHERE id = $1",
    [booking.data.id]
  );
  expect(Number(storedBooking.rows[0].amount_transport)).toBe(24500);
  expect(Number(storedBooking.rows[0].platform_fee)).toBe(100);
});

test("a booking without a configured tenant fare is rejected", async () => {
  const departureResponse = await fetch(`${baseUrl}/api/v1/voyages/departures`, {
    method: "POST",
    headers: { Authorization: authHeaders.Authorization(), "Content-Type": "application/json" },
    body: JSON.stringify({
      origin: "Yamoussoukro",
      destination: "Daloa",
      departureAt: new Date(Date.now() + 172_800_000).toISOString(),
      vehicleCode: "NO-FARE-TEST",
      capacity: 8
    })
  });
  expect(departureResponse.status).toBe(201);
  const departure = await departureResponse.json() as { data: { id: string } };

  const bookingResponse = await fetch(
    `${baseUrl}/api/v1/voyages/departures/${departure.data.id}/bookings`,
    {
      method: "POST",
      headers: { Authorization: authHeaders.Authorization(), "Content-Type": "application/json" },
      body: JSON.stringify({ passengerName: "No Fare", amountTransport: 999999 })
    }
  );
  expect(bookingResponse.status).toBe(409);
  const count = await pool.query(
    "SELECT COUNT(*)::int AS count FROM bookings WHERE departure_id = $1",
    [departure.data.id]
  );
  expect(count.rows[0].count).toBe(0);
});
