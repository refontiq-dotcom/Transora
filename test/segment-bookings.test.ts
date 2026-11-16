import { afterAll, beforeAll, expect, test } from "vitest";
import app from "../src/app";
import { pool } from "../src/db/pool";
import { createAccessToken } from "../src/lib/jwt";
import type { AddressInfo } from "node:net";

let server: ReturnType<typeof app.listen>;
let baseUrl: string;
let tenantId: string;
let userId: string;
let firstSegmentBookingId: string;
let secondSegmentBookingId: string;
let publicCode: string;
let departureId: string;
let holdDepartureId: string;
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

  const tenant = await pool.query("INSERT INTO tenants (name) VALUES ('Segment Booking Test') RETURNING id, public_code");
  tenantId = tenant.rows[0].id;
  publicCode = tenant.rows[0].public_code;
  const user = await pool.query(
    `INSERT INTO users (tenant_id, name, email, password_hash, role)
     VALUES ($1, 'Segment Agent', $2, 'test-hash', 'administrateur') RETURNING id`,
    [tenantId, `segment-booking-${Date.now()}@example.test`]
  );
  userId = user.rows[0].id;
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
     VALUES ($1,'Segment Ville A','Segment Ville C',NOW()+INTERVAL '30 minutes','SEG-TEST',2,10000,300,$2) RETURNING id`,
    [tenantId, route.rows[0].id]
  );
  departureId = departure.rows[0].id;
  const holdDeparture = await pool.query(
    `INSERT INTO departures (tenant_id,origin,destination,departure_at,vehicle_code,capacity,fare_amount,company_booking_fee,route_id)
     VALUES ($1,'Segment Ville A','Segment Ville C',NOW()+INTERVAL '3 days','HOLD-TEST',2,10000,300,$2) RETURNING id`,
    [tenantId, route.rows[0].id]
  );
  holdDepartureId = holdDeparture.rows[0].id;
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
  return { response, body: await response.json() as { data?: { id: string; seatNumber: number; amountTransport: number }; message?: string } };
};

test("un même siège peut être réutilisé sur deux segments qui ne se chevauchent pas", async () => {
  const first = await book(originStopId, middleStopId, "Passager A-B");
  expect(first.response.status).toBe(201);
  expect(first.body.data?.seatNumber).toBe(1);
  expect(first.body.data?.amountTransport).toBe(5000);
  firstSegmentBookingId = first.body.data!.id;

  const second = await book(middleStopId, destinationStopId, "Passager B-C");
  expect(second.response.status).toBe(201);
  expect(second.body.data?.seatNumber).toBe(1);
  expect(second.body.data?.amountTransport).toBe(6000);
  secondSegmentBookingId = second.body.data!.id;
});

test("la réservation publique affiche les places disponibles pour le segment choisi", async () => {
  const response = await fetch(
    `${baseUrl}/api/public/${publicCode}/departs/${departureId}/places?originStopId=${originStopId}&destinationStopId=${middleStopId}`
  );
  expect(response.status).toBe(200);
  const result = await response.json() as { data: { origin: string; destination: string; availableCount: number; seats: Array<{ number: number; available: boolean }> } };
  expect(result.data.origin).toBe("Segment Ville A");
  expect(result.data.destination).toBe("Segment Ville B");
  expect(result.data.availableCount).toBe(1);
  expect(result.data.seats[0]).toEqual({ number: 1, available: false });
  expect(result.data.seats[1]).toEqual({ number: 2, available: true });
});

test("le contrôleur confirme la descente réelle avant d'autoriser la montée sur le même siège", async () => {
  await pool.query("UPDATE bookings SET status='PAID' WHERE id=ANY($1::uuid[]) AND tenant_id=$2", [[firstSegmentBookingId, secondSegmentBookingId], tenantId]);
  await pool.query(
    `INSERT INTO payments (tenant_id, booking_id, amount_transport, platform_fee, payment_method, status, proof, confirmed_by, confirmed_at)
     SELECT tenant_id, id, amount_transport, platform_fee, 'cash', 'CONFIRMED', 'TEST-PAID', $2, NOW()
     FROM bookings WHERE id=ANY($1::uuid[])`,
    [[firstSegmentBookingId, secondSegmentBookingId], userId]
  );
  await pool.query(
    `INSERT INTO boarding_events (tenant_id, booking_id, departure_id, boarded_by)
     VALUES ($1,$2,$3,$4)`,
    [tenantId, firstSegmentBookingId, departureId, userId]
  );
  await pool.query("UPDATE departures SET status='BOARDING' WHERE id=$1 AND tenant_id=$2", [departureId, tenantId]);

  const url = `${baseUrl}/api/v1/embarquement/operations/${departureId}/${middleStopId}`;
  const headers = { Authorization: `Bearer ${token}` };
  const beforeResponse = await fetch(url, { headers });
  expect(beforeResponse.status).toBe(200);
  const before = await beforeResponse.json() as { data: { summary: { expectedDescents: number; expectedBoardings: number; seatsBlockedByPreviousPassenger: number }; boardings: Array<{ seatBlockedByPreviousPassenger: boolean }> } };
  expect(before.data.summary.expectedDescents).toBe(1);
  expect(before.data.summary.expectedBoardings).toBe(1);
  expect(before.data.summary.seatsBlockedByPreviousPassenger).toBe(1);
  expect(before.data.boardings[0].seatBlockedByPreviousPassenger).toBe(true);

  const wrongStop = await fetch(`${baseUrl}/api/v1/embarquement/operations/descendre`, {
    method: "POST", headers: { ...headers, "Content-Type": "application/json" },
    body: JSON.stringify({ billetId: firstSegmentBookingId, stopId: originStopId })
  });
  expect(wrongStop.status).toBe(409);

  const alighting = await fetch(`${baseUrl}/api/v1/embarquement/operations/descendre`, {
    method: "POST", headers: { ...headers, "Content-Type": "application/json" },
    body: JSON.stringify({ billetId: firstSegmentBookingId, stopId: middleStopId })
  });
  expect(alighting.status).toBe(200);

  const afterResponse = await fetch(url, { headers });
  const after = await afterResponse.json() as { data: { summary: { confirmedDescents: number; seatsBlockedByPreviousPassenger: number }; boardings: Array<{ seatBlockedByPreviousPassenger: boolean }> } };
  expect(after.data.summary.confirmedDescents).toBe(1);
  expect(after.data.summary.seatsBlockedByPreviousPassenger).toBe(0);
  expect(after.data.boardings[0].seatBlockedByPreviousPassenger).toBe(false);

  await pool.query("UPDATE departures SET status='DEPARTED' WHERE id=$1 AND tenant_id=$2", [departureId, tenantId]);
  await pool.query(
    "INSERT INTO stop_arrival_events (tenant_id, departure_id, stop_id, arrived_by) VALUES ($1,$2,$3,$4)",
    [tenantId, departureId, middleStopId, userId]
  );

  const boarding = await fetch(`${baseUrl}/api/v1/embarquement/valider`, {
    method: "POST", headers: { ...headers, "Content-Type": "application/json" },
    body: JSON.stringify({ billetId: secondSegmentBookingId })
  });
  expect(boarding.status).toBe(200);
  await pool.query("UPDATE departures SET status=$3 WHERE id=$1 AND tenant_id=$2", [departureId, tenantId, "SCHEDULED"]);
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


test("une réservation publique bloque temporairement un siège puis le libère à expiration", async () => {
  const createHold = async (seatNumber?: number) => fetch(`${baseUrl}/api/public/${publicCode}/reservations`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      departureId: holdDepartureId,
      passengerName: "Client temporaire",
      passengerPhone: "+2250700000000",
      policyAccepted: true,
      originStopId,
      destinationStopId,
      amountTransport: 1,
      ...(seatNumber === undefined ? {} : { seatNumber })
    })
  });

  const firstResponse = await createHold(2);
  expect(firstResponse.status).toBe(201);
  const first = await firstResponse.json() as { data: { bookingId: string; seatNumber: number; transportAmount: number; bookingStatus: string; holdExpiresAt: string | null } };
  expect(first.data.bookingStatus).toBe("HELD");
  expect(first.data.seatNumber).toBe(2);
  expect(first.data.transportAmount).toBe(10000);
  expect(first.data.holdExpiresAt).toBeTruthy();

  const departureDate = await pool.query(
    "SELECT departure_at::date::text AS selected_date FROM departures WHERE id=$1 AND tenant_id=$2",
    [holdDepartureId, tenantId]
  );
  const headers = { Authorization: `Bearer ${token}` };
  const dashboardResponse = await fetch(
    `${baseUrl}/api/v1/dashboard?date=${departureDate.rows[0].selected_date}`,
    { headers }
  );
  expect(dashboardResponse.status).toBe(200);
  const dashboard = await dashboardResponse.json() as { data: { metrics: { reservedSeatsToday: number } } };
  expect(dashboard.data.metrics.reservedSeatsToday).toBeGreaterThanOrEqual(1);

  const paymentListResponse = await fetch(`${baseUrl}/api/v1/paiements`, { headers });
  expect(paymentListResponse.status).toBe(200);
  const paymentList = await paymentListResponse.json() as { data: { paiements: Array<{ billetId: string; statut: string; statutRéservation: string }> } };
  expect(paymentList.data.paiements).toEqual(expect.arrayContaining([
    expect.objectContaining({ billetId: first.data.bookingId, statut: "NOT_INITIATED", statutRéservation: "HELD" })
  ]));

  const duplicateSeatResponse = await createHold(2);
  expect(duplicateSeatResponse.status).toBe(409);

  await pool.query(
    "UPDATE bookings SET hold_expires_at=NOW()-INTERVAL '1 minute' WHERE id=$1 AND tenant_id=$2",
    [first.data.bookingId, tenantId]
  );

  const secondResponse = await createHold();
  expect(secondResponse.status).toBe(201);
  const second = await secondResponse.json() as { data: { bookingId: string; seatNumber: number; bookingStatus: string } };
  expect(second.data.seatNumber).toBe(1);
  expect(second.data.bookingStatus).toBe("HELD");

  const expired = await pool.query("SELECT status FROM bookings WHERE id=$1", [first.data.bookingId]);
  expect(expired.rows[0].status).toBe("EXPIRED");
});

test("un paiement ne peut pas confirmer un hold expiré", async () => {
  const response = await fetch(`${baseUrl}/api/public/${publicCode}/reservations`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      departureId: holdDepartureId,
      passengerName: "Client paiement expiré",
      passengerPhone: "+2250700000001",
      policyAccepted: true,
      originStopId,
      destinationStopId
    })
  });
  expect(response.status).toBe(201);
  const hold = await response.json() as { data: { bookingId: string } };

  const init = await fetch(`${baseUrl}/api/v1/paiements/init`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ billetId: hold.data.bookingId, moyenPaiement: "mobile_money" })
  });
  expect(init.status).toBe(201);
  const payment = await init.json() as { data: { id: string } };

  await pool.query(
    "UPDATE bookings SET hold_expires_at=NOW()-INTERVAL '1 minute' WHERE id=$1 AND tenant_id=$2",
    [hold.data.bookingId, tenantId]
  );

  const confirmation = await fetch(`${baseUrl}/api/v1/paiements/confirm`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ transactionId: payment.data.id, preuvePaiement: "TEST-PROOF" })
  });
  expect(confirmation.status).toBe(409);

  const state = await pool.query(
    `SELECT b.status AS booking_status, p.status AS payment_status
     FROM bookings b JOIN payments p ON p.booking_id=b.id
     WHERE b.id=$1 AND b.tenant_id=$2`,
    [hold.data.bookingId, tenantId]
  );
  expect(state.rows[0]).toEqual({ booking_status: "EXPIRED", payment_status: "CANCELLED" });
});
