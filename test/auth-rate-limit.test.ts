import { beforeEach, describe, expect, it, vi } from "vitest";

const query = vi.fn();
vi.mock("../src/db/pool", () => ({ pool: { query } }));

import express from "express";
import { authRateLimit } from "../src/middleware/auth-rate-limit";

describe("authRateLimit", () => {
  beforeEach(() => {
    query.mockReset();
    query.mockResolvedValue({ rows: [{ attempts: 1, reset_at: new Date(Date.now() + 60_000) }] });
    process.env.JWT_SECRET = "test-secret-that-is-at-least-32-characters-long";
  });

  const request = async (middleware: ReturnType<typeof authRateLimit>, headers: Record<string, string> = {}) => {
    const app = express();
    app.use(express.json());
    app.post("/auth", middleware, (_req, res) => res.status(200).json({ success: true }));
    const server = app.listen(0);
    await new Promise<void>((resolve) => server.once("listening", resolve));
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("Test server did not bind");
    try {
      return await fetch(`http://127.0.0.1:${address.port}/auth`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...headers },
        body: JSON.stringify({ email: "person@example.test" })
      });
    } finally {
      await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    }
  };

  it("allows attempts while all counters remain within their limits", async () => {
    const middleware = authRateLimit({
      limits: [{ scope: "login:ip", identifier: (req) => req.ip || "unknown", maxAttempts: 5, windowSeconds: 900 }]
    });
    const response = await request(middleware);
    expect(response.status).toBe(200);
    expect(query).toHaveBeenCalledOnce();
  });

  it("blocks attempts beyond the configured limit and returns Retry-After", async () => {
    query.mockResolvedValue({ rows: [{ attempts: 6, reset_at: new Date(Date.now() + 45_000) }] });
    const middleware = authRateLimit({
      limits: [{ scope: "login:email", identifier: (req) => String(req.body.email), maxAttempts: 5, windowSeconds: 900 }]
    });
    const response = await request(middleware);
    expect(response.status).toBe(429);
    expect(Number(response.headers.get("retry-after"))).toBeGreaterThan(0);
    expect(query).toHaveBeenCalledOnce();
  });

  it("fails closed when the signing secret is unavailable", async () => {
    delete process.env.JWT_SECRET;
    const middleware = authRateLimit({
      limits: [{ scope: "login:ip", identifier: (req) => req.ip || "unknown", maxAttempts: 5, windowSeconds: 900 }]
    });
    const response = await request(middleware);
    expect(response.status).toBe(503);
    expect(query).not.toHaveBeenCalled();
  });

  it("passes database errors to the centralized error handler", async () => {
    query.mockRejectedValue(new Error("database unavailable"));
    const app = express();
    app.use(express.json());
    app.post("/auth", authRateLimit({
      limits: [{ scope: "login:ip", identifier: (req) => req.ip || "unknown", maxAttempts: 5, windowSeconds: 900 }]
    }), (_req, res) => res.sendStatus(200));
    app.use((error: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
      res.status(503).json({ message: error.message });
    });
    const server = app.listen(0);
    await new Promise<void>((resolve) => server.once("listening", resolve));
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("Test server did not bind");
    try {
      const response = await fetch(`http://127.0.0.1:${address.port}/auth`, { method: "POST" });
      expect(response.status).toBe(503);
    } finally {
      await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    }
  });
});
