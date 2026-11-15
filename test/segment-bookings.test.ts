import { afterAll, beforeAll, expect, test } from "vitest";
import app from "../src/app";
import { pool } from "../src/db/pool";
import { createAccessToken } from "../src/lib/jwt";
import type { AddressInfo } from "node:net";

let server: ReturnType<typeof app.listen>;
let baseUrl: string;
let tenantId: string;
let departureId: string;
let originStopId: string;
let middleStopId: string;
let destinationStopId: string;
let token: string;
const previousJwtSecret = process.env.JWT_SECRET;

beforeAll(async () => {
  process.env.JWT_SECRET = "test-segment-bookings-secret-at-least-32";
  server = app.listen(0);
  await new Promise<void>((resolve, reject) => {
    server.once("listening", resolve);
    server.once("error", reject);
  });
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

  const tenant = await pool.query("INSERT INTO tenants (name) VALUES ('Segment Booking Test') RETURNING id");
  tenantId = tenant.rows[0].id;
  const user = await pool.query(
    `INSERT INTO users (tenant_id, name, email, password_hash, role)
     VALUES ($1, 'Segment Agent', $2, 'test-hash', 'administrateur') RETURNING id`,
    [tenantId, `segment-booking-${Date.now()}@example.test`]
  );
  const sessionId = `segment-booking-session-${Date.now()}`;
  await pool.query(
    "INSERT INTO user_sessions (id, user_id, tenant_id, refresh_token_hash, expires_at) VALUES ($1,$2,$3,$4,NOW()+INTERVAL '1 day')",
    [sessionId, user.rows[0].id, tenantId, `hash-${Date.now()}`]
  );
  token = createAccessToken({ id: user.rows[0].id, email: "segment@example.test", role: "administrateur", tenantId, sessionId });

  const cities = await pool.query(
    "INSERT INTO company_cities (tenant_id, name) VALUES ($1,'Segment Ville A'),($1,'Segment Ville B'),($1,'Segment Ville C') RETURNING id,name",
    [tenantId]
  );
  const stations = await pool.query(
    "INSERT INTO stations (tenant_id,city_id,name) VALUES ($1,$2,'Gare A'),($1,$3,'Gare B'),($1,$4,'Gare C') RETURNING id,name",
    [tenantId, cities.rows[0].id, cities.rows[1].id, cities.rows[2].id]
  );
  const route = await pool.query(
    "INSERT INTO transport_routes (tenant_id,name,origin_station_id,destination_station_id) VALUES ($1,'Ligne segment test',$2,$3) RETURNING id",
    [tenantId, stations.rows[0].id, stations.rows[2].id]
  );
  await pool.query(
    `INSERT INTO route_stops (tenant_id,route_id,station_id,stop_order,distance_from_origin_km,duration_from_origin_minutes)
     VALUES ($1,$2,$3,0,0,0),($1,$2,$4,1,150,120),($1,$2,$5,2,300,240)`,
    [tenantId, route.rows[0].id, stations.rows[0].id, stations.rows[1].id, stations.rows[2].id]
  );
  const stops = await pool.query("SELECT id, stop_order FROM route_stops WHERE tenant_id=$1 AND route_id=$2 ORDER BY stop_order", [tenantId, route.rows[0].id]);
  originStopId = stops.rows[0].id;
  middleStopId = stops.rows[1].id;
  destinationStopId = stops.rows[2].id;

  await pool.query(
    `INSERT INTO company_route_tariffs (tenant_id,origin,destination,fare_amount,company_booking_fee)
     VALUES ($1,'Segment Ville A','Segment Ville B',5000,200),
            ($1,'Segment Ville B','Segment Ville C',6000,200),
            ($1,'Segment Ville A','Segment Ville C',10000,300)`,
    [tenantId]
  );
  const departure = await pool.query(
    `INSERT INTO departures (tenant_id,origin,destination,departure_at,vehicle_code,capacity,fare_amount,company_booking_fee,route_id)
     VALUES ($1,'Segment Ville A','Segment Ville C',NOW()+INTERVAL '2 days','SEG-TEST',2,10000,300,$2) RETURNING id`,
    [tenantId, route.rows[0].id]
  );
  departureId = departure.rows[0].id;
});

afterAll(async () => {
  if (tenantId) {
    await pool.query("DELETE FROM bookings WHERE tenant_id=$1", [tenantId]);
    await pool.query("DELETE FROM departures WHERE tenant_id=$1", [tenantId]);
    await pool.query("DELETE FROM route_stops WHERE tenant_id=$1", [tenantId]);
    await pool.query("DELETE FROM transport_routes WHERE tenant_id=$1", [tenantId]);
    await pool.query("DELETE FROM stations WHERE tenant_id=$1", [tenantId]);
    await pool.query("DELETE FROM company_cities WHERE tenant_id=$1", [tenantId]);
    await pool.query("DELETE FROM tenants WHERE id=$1", [tenantId]);
  }
  if (previousJwtSecret === undefined) delete process.env.JWT_SECRET;
  else process.env.JWT_SECRET = previousJwtSecret;
  if (server) await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
});

const book = async (origin: string, destination: string, passengerName: string) => {
  const response = await fetch(`${baseUrl}/api/v1/voyages/departures/${departureId}/bookings`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ passengerName, originStopId: origin, destinationStopId: destination })
  });
  return { response, body: await response.json() as { data?: { seatNumber: number; amountTransport: number }; message?: string } };
};

test("un même siège peut être réutilisé sur deux segments qui ne se chevauchent pas", async () => {
  const first = await book(originStopId, middleStopId, "Passager A-B");
  expect(first.response.status).toBe(201);
  expect(first.body.data?.seatNumber).toBe(1);
  expect(first.body.data?.amountTransport).toBe(5000);

  const second = await book(middleStopId, destinationStopId, "Passager B-C");
  expect(second.response.status).toBe(201);
  expect(second.body.data?.seatNumber).toBe(1);
  expect(second.body.data?.amountTransport).toBe(6000);
});

test("un segment qui chevauche deux réservations existantes reçoit un autre siège", async () => {
  const whole = await book(originStopId, destinationStopId, "Passager A-C");
  expect(whole.response.status).toBe(201);
  expect(whole.body.data?.seatNumber).toBe(2);
  expect(whole.body.data?.amountTransport).toBe(10000);
});

test("un départ lié à une ligne refuse une réservation sans gares de segment", async () => {
  const response = await fetch(`${baseUrl}/api/v1/voyages/departures/${departureId}/bookings`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ passengerName: "Sans segment" })
  });
  expect(response.status).toBe(400);
});

test("un segment dont les arrêts sont inversés est refusé", async () => {
  const invalid = await book(destinationStopId, originStopId, "Ordre invalide");
  expect(invalid.response.status).toBe(400);
});
