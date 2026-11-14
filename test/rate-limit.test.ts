import express from "express";
import type { Server } from "node:http";
import { AddressInfo } from "node:net";
import { afterAll, beforeAll, expect, test, vi } from "vitest";
import {
  createRateLimiter,
  MemoryRateLimitStore,
  RedisRestRateLimitStore,
  createRateLimitStoreFromEnv
} from "../src/middleware/rate-limit";

let server: Server;
let baseUrl: string;

beforeAll(async () => {
  const app = express();
  app.post("/login", createRateLimiter({
    namespace: "test-login",
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

test("memory store keeps independent counters for separate keys", async () => {
  const store = new MemoryRateLimitStore();
  const first = await store.consume("auth:one", 60_000);
  const second = await store.consume("auth:two", 60_000);
  const third = await store.consume("auth:one", 60_000);

  expect(first.count).toBe(1);
  expect(second.count).toBe(1);
  expect(third.count).toBe(2);
  expect(first.resetAt).toBe(third.resetAt);
});

test("Redis store uses one atomic Lua increment with an expiry", async () => {
  const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response(
    JSON.stringify({ result: [3, 45_000] }),
    { status: 200, headers: { "Content-Type": "application/json" } }
  ));
  const store = new RedisRestRateLimitStore({
    url: "https://example.upstash.io",
    token: "test-token",
    fetcher
  });

  const result = await store.consume("transora:rate-limit:auth-login:hashed-ip", 60_000);

  expect(result.count).toBe(3);
  expect(result.resetAt).toBeGreaterThan(Date.now());
  expect(fetcher).toHaveBeenCalledOnce();
  const request = fetcher.mock.calls[0][1];
  expect(request?.method).toBe("POST");
  expect(request?.headers).toMatchObject({ Authorization: "Bearer test-token" });
  const command = JSON.parse(String(request?.body)) as string[];
  expect(command[0]).toBe("EVAL");
  expect(command[2]).toBe("1");
  expect(command[3]).toBe("transora:rate-limit:auth-login:hashed-ip");
  expect(command[4]).toBe("60000");
  expect(command[1]).toContain("INCR");
  expect(command[1]).toContain("PEXPIRE");
});

test("Redis store rejects non-HTTPS endpoints", () => {
  expect(() => new RedisRestRateLimitStore({
    url: "http://redis.example.test",
    token: "test-token"
  })).toThrow("HTTPS");
});

test("Redis store rejects unavailable or malformed responses", async () => {
  const unavailableFetcher = vi.fn<typeof fetch>().mockResolvedValue(
    new Response("unavailable", { status: 503 })
  );
  const unavailableStore = new RedisRestRateLimitStore({
    url: "https://example.upstash.io",
    token: "test-token",
    fetcher: unavailableFetcher
  });
  await expect(unavailableStore.consume("key", 60_000)).rejects.toThrow();

  const malformedFetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response(
    JSON.stringify({ result: ["not-a-counter", -1] }),
    { status: 200 }
  ));
  const malformedStore = new RedisRestRateLimitStore({
    url: "https://example.upstash.io",
    token: "test-token",
    fetcher: malformedFetcher
  });
  await expect(malformedStore.consume("key", 60_000)).rejects.toThrow();
});

test("rate limiter fails closed with 503 when its shared store fails", async () => {
  const failingApp = express();
  failingApp.post("/login", createRateLimiter({
    namespace: "failing-test",
    windowMs: 60_000,
    maxRequests: 2,
    message: "Too many attempts",
    store: { consume: async () => { throw new Error("Redis unavailable"); } }
  }), (_req, res) => res.json({ success: true }));
  const failingServer = failingApp.listen(0);
  await new Promise<void>((resolve, reject) => {
    failingServer.once("listening", resolve);
    failingServer.once("error", reject);
  });
  const address = failingServer.address() as AddressInfo;
  try {
    const response = await fetch(`http://127.0.0.1:${address.port}/login`, { method: "POST" });
    expect(response.status).toBe(503);
    expect(response.headers.get("retry-after")).toBe("1");
  } finally {
    await new Promise<void>((resolve, reject) => {
      failingServer.close((error) => error ? reject(error) : resolve());
    });
  }
});


test("rate limit Redis keys hash client IP addresses", async () => {
  const keys: string[] = [];
  const keyCaptureApp = express();
  keyCaptureApp.post("/login", createRateLimiter({
    namespace: "key-test",
    windowMs: 60_000,
    maxRequests: 2,
    message: "Too many attempts",
    store: {
      consume: async (key) => {
        keys.push(key);
        return { count: 1, resetAt: Date.now() + 60_000 };
      }
    }
  }), (_req, res) => res.json({ success: true }));
  const keyServer = keyCaptureApp.listen(0);
  await new Promise<void>((resolve, reject) => {
    keyServer.once("listening", resolve);
    keyServer.once("error", reject);
  });
  const address = keyServer.address() as AddressInfo;
  try {
    const response = await fetch(`http://127.0.0.1:${address.port}/login`, { method: "POST" });
    expect(response.status).toBe(200);
    expect(keys).toHaveLength(1);
    expect(keys[0]).toMatch(/^transora:rate-limit:key-test:[a-f0-9]{64}$/);
    expect(keys[0]).not.toContain("127.0.0.1");
  } finally {
    await new Promise<void>((resolve, reject) => {
      keyServer.close((error) => error ? reject(error) : resolve());
    });
  }
});

test("rate limit store requires both Redis environment variables", async () => {
  const previousUrl = process.env.REDIS_REST_URL;
  const previousToken = process.env.REDIS_REST_TOKEN;
  try {
    delete process.env.REDIS_REST_URL;
    delete process.env.REDIS_REST_TOKEN;
    expect(createRateLimitStoreFromEnv()).toBeInstanceOf(MemoryRateLimitStore);

    process.env.REDIS_REST_URL = "https://example.upstash.io";
    delete process.env.REDIS_REST_TOKEN;
    await expect(createRateLimitStoreFromEnv().consume("key", 60_000)).rejects.toThrow();
  } finally {
    if (previousUrl === undefined) delete process.env.REDIS_REST_URL;
    else process.env.REDIS_REST_URL = previousUrl;
    if (previousToken === undefined) delete process.env.REDIS_REST_TOKEN;
    else process.env.REDIS_REST_TOKEN = previousToken;
  }
});
