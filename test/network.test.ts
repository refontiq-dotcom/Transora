import { afterAll, beforeAll, expect, test } from "vitest";
import app from "../src/app";
import { pool } from "../src/db/pool";
import { createAccessToken } from "../src/lib/jwt";
import type { AddressInfo } from "node:net";

let server: ReturnType<typeof app.listen>;
let baseUrl: string;
let tenantId: string;
let otherTenantId: string;
let userId: string;
let sessionId: string;
let token: string;
const previousJwtSecret = process.env.JWT_SECRET;

beforeAll(async () => {
  process.env.JWT_SECRET = "test-network-session-token-secret-at-least-32";
  server = app.listen(0);
  await new Promise<void>((resolve, reject) => {
    server.once("listening", resolve);
    server.once("error", reject);
  });
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const tenants = await pool.query(
    "INSERT INTO tenants (name) VALUES ('Network Test A'), ('Network Test B') RETURNING id"
  );
  tenantId = tenants.rows[0].id;
  otherTenantId = tenants.rows[1].id;
  const user = await pool.query(
    `INSERT INTO users (tenant_id, name, email, password_hash, role)
     VALUES ($1, 'Network Admin', $2, 'test-hash', 'administrateur') RETURNING id`,
    [tenantId, `network-${Date.now()}@example.test`]
  );
  userId = user.rows[0].id;
  sessionId = `network-session-${Date.now()}`;
  await pool.query(
    "INSERT INTO user_sessions (id, user_id, tenant_id, refresh_token_hash, expires_at) VALUES ($1, $2, $3, $4, NOW() + INTERVAL '1 day')",
    [sessionId, userId, tenantId, (Date.now().toString(36) + Math.random().toString(36).slice(2, 10).toUpperCase() + "d".repeat(44))]
  );
  token = createAccessToken({ id: userId, email: "network@example.test", role: "administrateur", tenantId, sessionId });
});

afterAll(async () => {
  if (tenantId) await pool.query("DELETE FROM tenants WHERE id = ANY($1::uuid[])", [[tenantId, otherTenantId]]);
  if (previousJwtSecret === undefined) delete process.env.JWT_SECRET;
  else process.env.JWT_SECRET = previousJwtSecret;
  if (server) await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
});

test("le réseau exige une authentification", async () => {
  const response = await fetch(`${baseUrl}/api/v1/reseau/cities`);
  expect(response.status).toBe(401);
});

test("une compagnie ne voit que ses villes et le tenant du corps est ignoré", async () => {
  const created = await fetch(`${baseUrl}/api/v1/reseau/cities`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ name: "Abidjan", tenantId: otherTenantId })
  });
  expect(created.status).toBe(201);
  const cityBody = await created.json() as { data: { id: string } };
  const ownList = await fetch(`${baseUrl}/api/v1/reseau/cities`, {
    headers: { Authorization: `Bearer ${token}` }
  });
  expect(ownList.status).toBe(200);
  const ownBody = await ownList.json() as { data: { cities: Array<{ id: string }> } };
  expect(ownBody.data.cities.map(city => city.id)).toContain(cityBody.data.id);

  const otherCompany = await pool.query(
    "SELECT id FROM company_cities WHERE tenant_id = $1 AND id = $2",
    [otherTenantId, cityBody.data.id]
  );
  expect(otherCompany.rowCount).toBe(0);
});

test("une ligne refuse des arrêts qui ne commencent pas à sa gare d'origine", async () => {
  const response = await fetch(`${baseUrl}/api/v1/reseau/routes`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      name: "Ligne invalide", originStationId: "00000000-0000-4000-8000-000000000001",
      destinationStationId: "00000000-0000-4000-8000-000000000002",
      stops: [
        { stationId: "00000000-0000-4000-8000-000000000003", distanceFromOriginKm: 0, durationFromOriginMinutes: 0 },
        { stationId: "00000000-0000-4000-8000-000000000002", distanceFromOriginKm: 100, durationFromOriginMinutes: 90 }
      ]
    })
  });
  expect(response.status).toBe(400);
});
