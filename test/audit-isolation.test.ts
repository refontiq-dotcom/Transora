import jwt from "jsonwebtoken";
import { AddressInfo } from "node:net";
import { beforeAll, afterAll, expect, test } from "vitest";
import app from "../src/app";
import { pool } from "../src/db/pool";

let server: ReturnType<typeof app.listen>;
let baseUrl: string;
let tenantAId: string;
let tenantBId: string;
let userAId: string;
let userBId: string;
let tokenA: string;
let tokenB: string;

beforeAll(async () => {
  server = app.listen(0);
  await new Promise<void>((resolve, reject) => {
    server.once("listening", resolve);
    server.once("error", reject);
  });
  const address = server.address() as AddressInfo;
  baseUrl = `http://127.0.0.1:${address.port}`;

  process.env.JWT_SECRET = "audit-isolation-test-secret-key-at-least-32-chars";

  // Créer deux tenants distincts
  const ta = await pool.query(
    "INSERT INTO tenants (name) VALUES ('Tenant A') RETURNING id"
  );
  tenantAId = ta.rows[0].id;
  const tb = await pool.query(
    "INSERT INTO tenants (name) VALUES ('Tenant B') RETURNING id"
  );
  tenantBId = tb.rows[0].id;

  const userA = await pool.query(
    `INSERT INTO users (tenant_id, name, email, password_hash, role)
     VALUES ($1, 'User A', 'a@tenant.test', 'test-hash', 'administrateur')
     RETURNING id`,
    [tenantAId]
  );
  userAId = userA.rows[0].id;

  const userB = await pool.query(
    `INSERT INTO users (tenant_id, name, email, password_hash, role)
     VALUES ($1, 'User B', 'b@tenant.test', 'test-hash', 'administrateur')
     RETURNING id`,
    [tenantBId]
  );
  userBId = userB.rows[0].id;

  // Les JWT utilisent des utilisateurs réellement présents en base.
  tokenA = jwt.sign(
    { email: "a@tenant.test", role: "administrateur", tenantId: tenantAId },
    process.env.JWT_SECRET,
    { subject: userAId }
  );
  tokenB = jwt.sign(
    { email: "b@tenant.test", role: "administrateur", tenantId: tenantBId },
    process.env.JWT_SECRET,
    { subject: userBId }
  );
});

afterAll(async () => {
  await pool.query("DELETE FROM audit_events WHERE tenant_id = $1", [tenantAId]);
  await pool.query("DELETE FROM audit_events WHERE tenant_id = $1", [tenantBId]);
  await pool.query("DELETE FROM users WHERE id = $1", [userAId]);
  await pool.query("DELETE FROM users WHERE id = $1", [userBId]);
  await pool.query("DELETE FROM tenants WHERE id = $1", [tenantAId]);
  await pool.query("DELETE FROM tenants WHERE id = $1", [tenantBId]);

  await new Promise<void>((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
});

const headersA = () => ({
  Authorization: `Bearer ${tokenA}`,
  "Content-Type": "application/json"
});

const headersB = () => ({
  Authorization: `Bearer ${tokenB}`,
  "Content-Type": "application/json"
});

test("POST /audit/evenement enregistre un événement pour le tenant A", async () => {
  const response = await fetch(`${baseUrl}/api/v1/audit/evenement`, {
    method: "POST",
    headers: headersA(),
    body: JSON.stringify({
      type: "création",
      sujet: "nouveau départ",
      action: "CREATE",
      details: { departId: "dep-1" }
    })
  });
  expect(response.status).toBe(201);
  const body = await response.json();
  expect(body.success).toBe(true);
});

test("POST /audit/evenement enregistre un événement pour le tenant B", async () => {
  const response = await fetch(`${baseUrl}/api/v1/audit/evenement`, {
    method: "POST",
    headers: headersB(),
    body: JSON.stringify({
      type: "modification",
      sujet: "mise à jour billet",
      action: "UPDATE",
      details: { billetId: "bil-1" }
    })
  });
  expect(response.status).toBe(201);
  const body = await response.json();
  expect(body.success).toBe(true);
});

test("GET /audit : le tenant A ne voit que ses propres événements (isolation)", async () => {
  const response = await fetch(`${baseUrl}/api/v1/audit`, {
    headers: headersA()
  });
  expect(response.status).toBe(200);
  const body = await response.json();
  expect(body.success).toBe(true);
  const evenements = body.data.evenements;
  // Tous les événements doivent appartenir au tenant A
  for (const ev of evenements) {
    // On ne peut pas vérifier tenant_id directement car il n'est pas retourné,
    // mais on vérifie que les sujets correspondent à ceux insérés par A
    if (ev.sujet === "mise à jour billet") {
      throw new Error("Le tenant A voit un événement du tenant B !");
    }
  }
  expect(evenements.length).toBeGreaterThanOrEqual(1);
  expect(
    evenements.find((ev: any) => ev.sujet === "nouveau départ")
  ).toBeDefined();
});

test("GET /audit : le tenant B ne voit que ses propres événements (isolation)", async () => {
  const response = await fetch(`${baseUrl}/api/v1/audit`, {
    headers: headersB()
  });
  expect(response.status).toBe(200);
  const body = await response.json();
  expect(body.success).toBe(true);
  const evenements = body.data.evenements;
  for (const ev of evenements) {
    if (ev.sujet === "nouveau départ") {
      throw new Error("Le tenant B voit un événement du tenant A !");
    }
  }
  expect(evenements.length).toBeGreaterThanOrEqual(1);
  expect(
    evenements.find((ev: any) => ev.sujet === "mise à jour billet")
  ).toBeDefined();
});

test("GET /audit/rapport : le tenant A ne voit que ses propres stats", async () => {
  const response = await fetch(`${baseUrl}/api/v1/audit/rapport`, {
    headers: headersA()
  });
  expect(response.status).toBe(200);
  const body = await response.json();
  expect(body.success).toBe(true);
  expect(body.data.tenantId).toBe(tenantAId);
  expect(body.data.resume.totalEvenements).toBeGreaterThanOrEqual(1);
});

test("Requête sans token est rejetée (401)", async () => {
  const response = await fetch(`${baseUrl}/api/v1/audit`, {
    headers: { "Content-Type": "application/json" }
  });
  expect(response.status).toBe(401);
});