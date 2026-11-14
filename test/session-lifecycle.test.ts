import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AddressInfo } from "node:net";
import app from "../src/app";
import { pool } from "../src/db/pool";

describe("Auth session lifecycle", () => {
  let server: ReturnType<typeof app.listen>;
  let baseUrl: string;
  let email: string;
  let tenantId: string;
  let userId: string;
  let cookie = "";
  let accessToken = "";

  beforeAll(async () => {
    server = app.listen(0);
    await new Promise<void>((resolve, reject) => {
      server.once("listening", resolve);
      server.once("error", reject);
    });
    baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    email = `session-${Date.now()}@example.test`;
    const registration = await fetch(`${baseUrl}/api/v1/auth/register`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: "Session Test", email, password: "correct-horse-battery-staple",
        companyName: `Session Tenant ${Date.now()}`
      })
    });
    expect(registration.status).toBe(201);
    const payload = await registration.json() as any;
    accessToken = payload.data.token;
    tenantId = payload.data.user.tenantId;
    userId = payload.data.user.id;
    cookie = registration.headers.get("set-cookie")?.split(";")[0] || "";
    expect(cookie).toContain("transora_refresh=");
  });

  afterAll(async () => {
    if (userId) await pool.query("DELETE FROM users WHERE id = $1", [userId]);
    if (tenantId) await pool.query("DELETE FROM tenants WHERE id = $1", [tenantId]);
    await new Promise<void>((resolve, reject) =>
      server.close((error) => error ? reject(error) : resolve())
    );
  });

  it("creates a server session and a short-lived access token", async () => {
    const result = await pool.query(
      "SELECT id, expires_at FROM user_sessions WHERE user_id = $1 AND tenant_id = $2",
      [userId, tenantId]
    );
    expect(result.rowCount).toBe(1);
    const claims = JSON.parse(Buffer.from(accessToken.split(".")[1], "base64url").toString());
    expect(claims.sessionId).toBe(result.rows[0].id);
    expect(claims.exp - claims.iat).toBe(15 * 60);
  });

  it("rotates the refresh token and invalidates the previous token", async () => {
    const refreshed = await fetch(`${baseUrl}/api/v1/auth/refresh`, {
      method: "POST", headers: { Cookie: cookie }
    });
    expect(refreshed.status).toBe(200);
    const nextCookie = refreshed.headers.get("set-cookie")?.split(";")[0] || "";
    expect(nextCookie).not.toBe(cookie);
    const replay = await fetch(`${baseUrl}/api/v1/auth/refresh`, {
      method: "POST", headers: { Cookie: cookie }
    });
    expect(replay.status).toBe(401);
    cookie = nextCookie;
    accessToken = ((await refreshed.json()) as any).data.token;
  });

  it("revokes a session on logout and rejects its access token", async () => {
    const logout = await fetch(`${baseUrl}/api/v1/auth/logout`, {
      method: "POST", headers: { Authorization: `Bearer ${accessToken}`, Cookie: cookie }
    });
    expect(logout.status).toBe(200);
    const protectedResponse = await fetch(`${baseUrl}/api/v1/dashboard`, {
      headers: { Authorization: `Bearer ${accessToken}` }
    });
    expect(protectedResponse.status).toBe(401);
  });
});
