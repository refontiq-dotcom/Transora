import express from "express";
import type { Server } from "node:http";
import { AddressInfo } from "node:net";
import { afterAll, beforeAll, expect, test } from "vitest";
import { createRateLimiter } from "../src/middleware/rate-limit";

let server: Server;
let baseUrl: string;

beforeAll(async () => {
  const app = express();
  app.post("/login", createRateLimiter({
    windowMs: 60_000,
    maxRequests: 2,
    message: "Too many attempts"
  }), (_req, res) => res.json({ success: true }));
  server = app.listen(0);
  await new Promise<void>((resolve, reject) => {
    server.once("listening", resolve);
    server.once("error", reject);
  });
  const address = server.address() as AddressInfo;
  baseUrl = `http://127.0.0.1:${address.port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve());
  });
});

test("rate limiter blocks requests after the configured threshold", async () => {
  const first = await fetch(`${baseUrl}/login`, { method: "POST" });
  const second = await fetch(`${baseUrl}/login`, { method: "POST" });
  const third = await fetch(`${baseUrl}/login`, { method: "POST" });

  expect(first.status).toBe(200);
  expect(second.status).toBe(200);
  expect(third.status).toBe(429);
  expect(third.headers.get("retry-after")).toBeTruthy();
  const body = await third.json() as { success?: boolean };
  expect(body.success).toBe(false);
});
