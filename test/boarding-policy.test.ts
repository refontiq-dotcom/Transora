import { afterAll, beforeAll, expect, test } from "vitest";
import app from "../src/app";
import { pool } from "../src/db/pool";
import { createAccessToken } from "../src/lib/jwt";
import type { AddressInfo } from "node:net";

let server: ReturnType<typeof app.listen>;
let baseUrl: string;
let tenantId: string;
let userId: string;
let token: string;
let bookingId: string;
let sourceDepartureId: string;
let targetDepartureId: string;
let originalTicketToken: string;
const previousJwtSecret = process.env.JWT_SECRET;

beforeAll(async () => {
  process.env.JWT_SECRET = "test-boarding-policy-secret-at-least-32";
  server = app.listen(0);
  await new Promise<void>((resolve, reject) => {
    server.once("listening", resolve);
    server.once("error", reject);
  });
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

  const tenant = await pool.query("INSERT INTO tenants (name) VALUES ('Boarding Policy Test') RETURNING id");
  tenantId = tenant.rows[0].id;
  const user = await pool.query(
    `INSERT INTO users (tenant_id, name, email, password_hash, role)
     VALUES ($1, 'Boarding Admin', $2, 'test-hash', 'administrateur') RETURNING id`,
    [tenantId, `boarding-policy-${Date.now()}@example.test`]
  );
  userId = user.rows[0].id;
  const sessionId = `boarding-policy-session-${Date.now()}`;
  await pool.query(
    "INSERT INTO user_sessions (id, user_id, tenant_id, refresh_token_hash, expires_at) VALUES ($1,$2,$3,$4,NOW()+INTERVAL '1 day')",
    [sessionId, userId, tenantId, "b".repeat(64)]
  );
  token = createAccessToken({ id: userId, email: "boarding-policy@example.test", role: "administrateur", tenantId, sessionId });

  const policyResponse = await fetch(`${baseUrl}/api/v1/embarquement/policy`, {
    method: "PUT",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      boardingOpenMinutesBefore: 60,
      boardingDeadlineMinutesBefore: 5,
      gracePeriodMinutes: 0,
      allowRebookingAfterNoShow: true,
      maxRebookings: 1,
      rebookingFeeAmount: 0,
      refundPolicy: "NONE",
      refundPercentage: 0,
      autoFindNextDeparture: true
    })
  });
  expect(policyResponse.status).toBe(200);

  const source = await pool.query(
    `INSERT INTO departures (tenant_id, origin, destination, departure_at, vehicle_code, capacity, fare_amount, company_booking_fee, status)
     VALUES ($1,'Ville Test A','Ville Test B',NOW()-INTERVAL '10 minutes','BUS-ABSENT',2,10000,0,'BOARDING')
     RETURNING id`,
    [tenantId]
  );
  sourceDepartureId = source.rows[0].id;
  const target = await pool.query(
    `INSERT INTO departures (tenant_id, origin, destination, departure_at, vehicle_code, capacity, fare_amount, company_booking_fee, status)
     VALUES ($1,'Ville Test A','Ville Test B',NOW()+INTERVAL '1 day','BUS-REPORT',2,10000,0,'SCHEDULED')
     RETURNING id`,
    [tenantId]
  );
  targetDepartureId = target.rows[0].id;

  const booking = await pool.query(
    `INSERT INTO bookings (tenant_id, departure_id, passenger_name, amount_transport, company_booking_fee, platform_fee, status, seat_number, segment_range)
     VALUES ($1,$2,'Passager absent',10000,0,100,'PAID',1,'[0,)'::int4range)
     RETURNING id, ticket_token, boarding_policy_version, boarding_policy_snapshot`,
    [tenantId, sourceDepartureId]
  );
  bookingId = booking.rows[0].id;
  originalTicketToken = booking.rows[0].ticket_token;
  expect(booking.rows[0].boarding_policy_snapshot.gracePeriodMinutes).toBe(0);

  // A later policy change must not alter the terms accepted by this booking.
  const laterPolicy = await fetch(`${baseUrl}/api/v1/embarquement/policy`, {
    method: "PUT",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ gracePeriodMinutes: 120 })
  });
  expect(laterPolicy.status).toBe(200);

  await pool.query(
    `INSERT INTO payments (tenant_id, booking_id, amount_transport, company_booking_fee, platform_fee, payment_method, status, proof, confirmed_by, confirmed_at)
     VALUES ($1,$2,10000,0,100,'cash','CONFIRMED','TEST-PAID',$3,NOW())`,
    [tenantId, bookingId, userId]
  );
});

afterAll(async () => {
  if (tenantId) await pool.query("DELETE FROM tenants WHERE id = $1", [tenantId]);
  if (previousJwtSecret === undefined) delete process.env.JWT_SECRET;
  else process.env.JWT_SECRET = previousJwtSecret;
  if (server) await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
});

const headers = () => ({ Authorization: `Bearer ${token}`, "Content-Type": "application/json" });

test("la compagnie configure sa politique et les billets conservent leur version", async () => {
  const response = await fetch(`${baseUrl}/api/v1/embarquement/policy`, { headers: headers() });
  expect(response.status).toBe(200);
  const result = await response.json() as { data: { gracePeriodMinutes: number; allowRebookingAfterNoShow: boolean; maxRebookings: number } };
  expect(result.data.gracePeriodMinutes).toBe(120);
  expect(result.data.allowRebookingAfterNoShow).toBe(true);
  expect(result.data.maxRebookings).toBe(1);

  const booking = await pool.query(
    "SELECT boarding_policy_snapshot, boarding_policy_version FROM bookings WHERE id=$1 AND tenant_id=$2",
    [bookingId, tenantId]
  );
  expect(booking.rows[0].boarding_policy_snapshot.gracePeriodMinutes).toBe(0);
});

test("une absence ne peut être confirmée qu'après le délai accepté et libère le siège du segment", async () => {
  const response = await fetch(`${baseUrl}/api/v1/embarquement/absence`, {
    method: "POST", headers: headers(), body: JSON.stringify({ bookingId })
  });
  expect(response.status).toBe(200);
  const result = await response.json() as { data: { status: string; seatReleasedForSegment: boolean } };
  expect(result.data.status).toBe("NO_SHOW");
  expect(result.data.seatReleasedForSegment).toBe(true);

  const state = await pool.query("SELECT status, boarding_status FROM bookings WHERE id=$1", [bookingId]);
  expect(state.rows[0]).toEqual({ status: "NO_SHOW", boarding_status: "NO_SHOW" });

  const reused = await pool.query(
    `INSERT INTO bookings (tenant_id, departure_id, passenger_name, amount_transport, company_booking_fee, platform_fee, status, seat_number, segment_range)
     VALUES ($1,$2,'Passager remplaçant',10000,0,100,'PAID',1,'[0,)'::int4range) RETURNING id`,
    [tenantId, sourceDepartureId]
  );
  expect(reused.rowCount).toBe(1);
});

test("les départs alternatifs sont proposés sans déplacer le billet automatiquement", async () => {
  const response = await fetch(`${baseUrl}/api/v1/embarquement/alternatives/${bookingId}`, { headers: headers() });
  expect(response.status).toBe(200);
  const result = await response.json() as { data: { alternatives: Array<{ departureId: string; suggestedSeat: number }>; remainingRebookings: number } };
  expect(result.data.alternatives[0].departureId).toBe(targetDepartureId);
  expect(result.data.alternatives[0].suggestedSeat).toBe(1);
  expect(result.data.remainingRebookings).toBe(1);

  const before = await pool.query("SELECT departure_id, status, ticket_token FROM bookings WHERE id=$1", [bookingId]);
  expect(before.rows[0].departure_id).toBe(sourceDepartureId);
  expect(before.rows[0].status).toBe("NO_SHOW");
  expect(before.rows[0].ticket_token).toBe(originalTicketToken);
});

test("le report exige le consentement du voyageur et invalide l'ancien QR code", async () => {
  const rejected = await fetch(`${baseUrl}/api/v1/embarquement/rebook/${bookingId}`, {
    method: "POST", headers: headers(),
    body: JSON.stringify({ targetDepartureId, passengerConsent: false, consentMethod: "IN_PERSON" })
  });
  expect(rejected.status).toBe(400);

  const response = await fetch(`${baseUrl}/api/v1/embarquement/rebook/${bookingId}`, {
    method: "POST", headers: headers(),
    body: JSON.stringify({ targetDepartureId, passengerConsent: true, consentMethod: "IN_PERSON", consentReference: "Accord verbal au guichet" })
  });
  expect(response.status).toBe(200);
  const result = await response.json() as { data: { departureId: string; status: string; ticketToken: string; seatNumber: number } };
  expect(result.data.departureId).toBe(targetDepartureId);
  expect(result.data.status).toBe("PAID");
  expect(result.data.seatNumber).toBe(1);
  expect(result.data.ticketToken).not.toBe(originalTicketToken);

  const oldScan = await fetch(`${baseUrl}/api/v1/embarquement/scan/${originalTicketToken}`, { headers: headers() });
  expect(oldScan.status).toBe(404);
  const events = await pool.query("SELECT COUNT(*)::int AS count FROM booking_rebooking_events WHERE booking_id=$1", [bookingId]);
  expect(events.rows[0].count).toBe(1);
});
