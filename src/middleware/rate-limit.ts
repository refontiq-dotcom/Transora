import { createHash } from "node:crypto";
import { NextFunction, Request, Response } from "express";

interface RateLimitWindow { count: number; resetAt: number; }
export interface RateLimitStore {
  consume(key: string, windowMs: number): Promise<RateLimitWindow>;
}

export class MemoryRateLimitStore implements RateLimitStore {
  private readonly windows = new Map<string, RateLimitWindow>();
  async consume(key: string, windowMs: number): Promise<RateLimitWindow> {
    const now = Date.now();
    let entry = this.windows.get(key);
    if (!entry || entry.resetAt <= now) {
      if (this.windows.size >= 10_000) {
        for (const [storedKey, window] of this.windows) {
          if (window.resetAt <= now) this.windows.delete(storedKey);
        }
        if (this.windows.size >= 10_000 && !this.windows.has(key)) {
          throw new Error("Rate limit memory store capacity reached");
        }
      }
      entry = { count: 0, resetAt: now + windowMs };
      this.windows.set(key, entry);
    }
    entry.count += 1;
    return { ...entry };
  }
}

const REDIS_INCREMENT_SCRIPT = [
  "local count = redis.call('INCR', KEYS[1])",
  "if count == 1 then redis.call('PEXPIRE', KEYS[1], ARGV[1]) end",
  "local ttl = redis.call('PTTL', KEYS[1])",
  "return { count, ttl }"
].join("\n");

interface RedisRestRateLimitStoreOptions { url: string; token: string; fetcher?: typeof fetch; }

export class RedisRestRateLimitStore implements RateLimitStore {
  private readonly url: string;
  private readonly token: string;
  private readonly fetcher: typeof fetch;

  constructor({ url, token, fetcher = fetch }: RedisRestRateLimitStoreOptions) {
    const parsedUrl = new URL(url);
    if (parsedUrl.protocol !== "https:") throw new Error("Redis REST endpoint must use HTTPS");
    if (!token.trim()) throw new Error("Redis REST token is required");
    this.url = parsedUrl.toString();
    this.token = token;
    this.fetcher = fetcher;
  }

  async consume(key: string, windowMs: number): Promise<RateLimitWindow> {
    const response = await this.fetcher(this.url, {
      method: "POST",
      headers: { Authorization: `Bearer ${this.token}`, "Content-Type": "application/json" },
      body: JSON.stringify(["EVAL", REDIS_INCREMENT_SCRIPT, "1", key, String(windowMs)])
    });
    if (!response.ok) throw new Error("Redis rate limit request failed");
    const payload = await response.json() as { result?: unknown; error?: string };
    if (payload.error || !Array.isArray(payload.result) || payload.result.length !== 2) {
      throw new Error("Redis returned an invalid rate limit response");
    }
    const count = Number(payload.result[0]);
    const ttlMs = Number(payload.result[1]);
    if (!Number.isSafeInteger(count) || count < 1 || !Number.isFinite(ttlMs) || ttlMs < 0) {
      throw new Error("Redis returned invalid rate limit counters");
    }
    return { count, resetAt: Date.now() + Math.max(1, ttlMs) };
  }
}

const unavailableStore: RateLimitStore = {
  async consume() { throw new Error("Redis rate limit configuration is incomplete"); }
};

export const createRateLimitStoreFromEnv = (): RateLimitStore => {
  const url = process.env.REDIS_REST_URL;
  const token = process.env.REDIS_REST_TOKEN;
  if (!url && !token) return new MemoryRateLimitStore();
  if (!url || !token) return unavailableStore;
  return new RedisRestRateLimitStore({ url, token });
};

interface RateLimitOptions {
  windowMs: number;
  maxRequests: number;
  message: string;
  namespace?: string;
  store?: RateLimitStore;
}

export const createRateLimiter = ({
  windowMs, maxRequests, message, namespace = "default",
  store = new MemoryRateLimitStore()
}: RateLimitOptions) => {
  return (req: Request, res: Response, next: NextFunction): void => {
    const ip = req.ip || req.socket.remoteAddress || "unknown";
    const ipHash = createHash("sha256").update(ip).digest("hex");
    const key = `transora:rate-limit:${namespace}:${ipHash}`;
    void store.consume(key, windowMs).then(({ count, resetAt }) => {
      if (res.headersSent) return;
      const remaining = Math.max(0, maxRequests - count);
      const retryAfterSeconds = Math.max(1, Math.ceil((resetAt - Date.now()) / 1000));
      res.setHeader("RateLimit-Limit", String(maxRequests));
      res.setHeader("RateLimit-Remaining", String(remaining));
      res.setHeader("RateLimit-Reset", String(Math.ceil(resetAt / 1000)));
      if (count > maxRequests) {
        res.setHeader("Retry-After", String(retryAfterSeconds));
        res.status(429).json({ success: false, message });
        return;
      }
      next();
    }).catch(() => {
      if (res.headersSent) return;
      res.setHeader("Retry-After", "1");
      res.status(503).json({
        success: false,
        message: "Protection anti-abus temporairement indisponible"
      });
    });
  };
};
