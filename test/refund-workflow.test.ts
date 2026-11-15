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
const previousJwtSecret = process.env.JWT_SECRET;

beforeAll(async () => {
  process.env.JWT_SECRET = "test-refund-secret-at-least-32-characters";
  server = app.listen(0);
  await new Promise<void>((resolve, reject) => {
    server.once("listening", resolve);
    server.once("error", reject);
  });
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const tenant = await pool.query("INSERT INTO tenants (name) VALUES ('Refund Workflow Test') RETURNING id");
  tenantId = tenant.rows[0].id;
  const user = await pool.query(
    `INSERT INTO users (tenant_id, name, email, password_hash, role)
     VALUES ($1,'Refund Manager',$2,'test-hash','administrateur') RETURNING id`,
    [tenantId, `refund-manager-${Date.now()}@example.test`]
  );
  userId = user.rows[0].id;
  const sessionId = `refund-session-${Date.now()}`;
  await pool.query(
    "INSERT INTO user_sessions (id,user_id,tenant_id,refresh_token_hash,expires_at) VALUES ($1,$2,$3,$4,NOW()+INTERVAL '1 day')",
    [sessionId, userId, tenantId, (Date.now().toString(36) + Math.random().toString(36).slice(2, 10).toUpperCase() + "d".repeat(44))]
  );
  token = createAccessToken({ id: userId, email: "refund-manager@example.test", role: "administrateur", tenantId, sessionId });
  await pool.query(
    "INSERT INTO guichet_sessions (tenant_id,opened_by,opening_amount) VALUES ($1,$2,100000)",
    [tenantId, userId]
  );
});

afterAll(async () => {
  if (tenantId) await pool.query("DELETE FROM tenants WHERE id=$1", [tenantId]);
  if (previousJwtSecret === undefined) delete process.env.JWT_SECRET;
  else process.env.JWT_SECRET = previousJwtSecret;
  if (server) await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
});

const headers = () => ({ Authorization: `Bearer ${token}`, "Content-Type": "application/json" });

async function createPaidBooking(paymentMethod: "cash" | "wave"): Promise<string> {
  const departure = await pool.query(
    `INSERT INTO departures (tenant_id,origin,destination,departure_at,vehicle_code,capacity,fare_amount)
     VALUES ($1,'Abidjan','Bouaké',NOW()+INTERVAL '1 day',$2,2,10000) RETURNING id`,
    [tenantId, `REFUND-${paymentMethod}-${Date.now()}`]
  );
  const booking = await pool.query(
    `INSERT INTO bookings
      (tenant_id,departure_id,passenger_name,amount_transport,company_booking_fee,platform_fee,status,seat_number,segment_range,boarding_policy_version,boarding_policy_snapshot)
     VALUES ($1,$2,$3,10000,500,100,'PAID',1,'[0,)'::int4range,3,
       '{"version":3,"refundPolicy":"PARTIAL","refundPercentage":40}'::jsonb)
     RETURNING id`,
    [tenantId, departure.rows[0].id, `Client ${paymentMethod}`]
  );
  await pool.query(
    `INSERT INTO payments (tenant_id,booking_id,amount_transport,company_booking_fee,platform_fee,payment_method,status,proof,confirmed_by,confirmed_at)
     VALUES ($1,$2,10000,500,100,$3,'CONFIRMED','TEST-CONFIRMED',$4,NOW())`,
    [tenantId, booking.rows[0].id, paymentMethod, userId]
  );
  return booking.rows[0].id;
}

test("le remboursement espèces exige une demande, puis une approbation et une caisse ouverte", async () => {
  const bookingId = await createPaidBooking("cash");
  const requested = await fetch(`${baseUrl}/api/v1/remboursements/requests`, {
    method: "POST", headers: headers(), body: JSON.stringify({ bookingId, reason: "CUSTOMER_CANCELLED" })
  });
  expect(requested.status).toBe(201);
  const requestBody = await requested.json() as { data: { id: string; refundableAmount: number; status: string } };
  expect(Number(requestBody.data.refundableAmount)).toBe(4200);
  expect(requestBody.data.status).toBe("REQUESTED");

  const approved = await fetch(`${baseUrl}/api/v1/remboursements/${requestBody.data.id}/approve`, {
    method: "PATCH", headers: headers(), body: JSON.stringify({})
  });
  expect(approved.status).toBe(200);
  const approvedBody = await approved.json() as { data: { status: string } };
  expect(approvedBody.data.status).toBe("PAID");

  const state = await pool.query(
    `SELECT r.status, b.status AS booking_status,
            (SELECT COUNT(*)::int FROM guichet_operations g WHERE g.booking_id=b.id AND g.type='REFUND') AS cash_refunds,
            (SELECT COUNT(*)::int FROM financial_operations f WHERE f.reference=r.id::text AND f.type='remboursement') AS financial_refunds
     FROM refund_requests r JOIN bookings b ON b.id=r.booking_id WHERE r.id=$1`,
    [requestBody.data.id]
  );
  expect(state.rows[0]).toEqual({ status: "PAID", booking_status: "REFUNDED", cash_refunds: 1, financial_refunds: 1 });
});

test("un remboursement en ligne approuvé reste en attente de confirmation du prestataire", async () => {
  const bookingId = await createPaidBooking("wave");
  const requested = await fetch(`${baseUrl}/api/v1/remboursements/requests`, {
    method: "POST", headers: headers(), body: JSON.stringify({ bookingId, reason: "SERVICE_FAILURE" })
  });
  expect(requested.status).toBe(201);
  const requestBody = await requested.json() as { data: { id: string; paymentChannel: string } };
  expect(requestBody.data.paymentChannel).toBe("ONLINE");

  const approved = await fetch(`${baseUrl}/api/v1/remboursements/${requestBody.data.id}/approve`, {
    method: "PATCH", headers: headers(), body: JSON.stringify({})
  });
  expect(approved.status).toBe(200);
  const approvedBody = await approved.json() as { data: { status: string }; message: string };
  expect(approvedBody.data.status).toBe("APPROVED_PENDING_PROVIDER");
  expect(approvedBody.message).toContain("aucun remboursement n'est déclaré effectué");
  const booking = await pool.query("SELECT status FROM bookings WHERE id=$1 AND tenant_id=$2", [bookingId, tenantId]);
  expect(booking.rows[0].status).toBe("PAID");
});
