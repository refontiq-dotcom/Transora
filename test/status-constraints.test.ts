import { expect, test, beforeAll, afterAll } from "vitest";
import { pool } from "../src/db/pool";

let tenantId: string;
let departureId: string;

beforeAll(async () => {
  const t = await pool.query(
    "INSERT INTO tenants (name) VALUES ('Test Constraints') RETURNING id"
  );
  tenantId = t.rows[0].id;

  const d = await pool.query(
    `INSERT INTO departures
       (tenant_id, origin, destination, departure_at, vehicle_code, capacity, status)
     VALUES ($1, 'A', 'D', NOW() + INTERVAL '1 day', 'BUS01', 50, 'SCHEDULED')
     RETURNING id`,
    [tenantId]
  );
  departureId = d.rows[0].id;
});

afterAll(async () => {
  await pool.query("DELETE FROM bookings WHERE departure_id = $1", [departureId]);
  await pool.query("DELETE FROM departures WHERE id = $1", [departureId]);
  await pool.query("DELETE FROM tenants WHERE id = $1", [tenantId]);
});

test("refuse un statut de départ invalide (CHECK constraint departures_status_check)", async () => {
  await expect(
    pool.query(
      `INSERT INTO departures
         (tenant_id, origin, destination, departure_at, vehicle_code, capacity, status)
       VALUES ($1, 'A', 'D', NOW() + INTERVAL '1 day', 'BUS02', 50, 'INCONNU')`,
      [tenantId]
    )
  ).rejects.toMatchObject({ code: "23514" });
});

test("refuse un statut de réservation invalide (CHECK constraint bookings_status_check)", async () => {
  await expect(
    pool.query(
      `INSERT INTO bookings
         (tenant_id, departure_id, passenger_name, amount_transport, platform_fee, status)
       VALUES ($1, $2, 'Test Passager', 1000, 100, 'INCONNU')`,
      [tenantId, departureId]
    )
  ).rejects.toMatchObject({ code: "23514" });
});

test("accepte un statut de départ valide (SCHEDULED)", async () => {
  const res = await pool.query(
    `INSERT INTO departures
       (tenant_id, origin, destination, departure_at, vehicle_code, capacity, status)
     VALUES ($1, 'A', 'D', NOW() + INTERVAL '1 day', 'BUS03', 50, 'SCHEDULED')
     RETURNING id`,
    [tenantId]
  );
  expect(res.rowCount).toBe(1);
  await pool.query("DELETE FROM departures WHERE id = $1", [res.rows[0].id]);
});

test("accepte un statut de réservation valide (PAID)", async () => {
  const res = await pool.query(
    `INSERT INTO bookings
       (tenant_id, departure_id, passenger_name, amount_transport, platform_fee, status)
     VALUES ($1, $2, 'Test Passager', 1000, 100, 'PAID')
     RETURNING id`,
    [tenantId, departureId]
  );
  expect(res.rowCount).toBe(1);
  await pool.query("DELETE FROM bookings WHERE id = $1", [res.rows[0].id]);
});