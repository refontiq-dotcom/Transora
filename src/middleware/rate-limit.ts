import { NextFunction, Request, Response } from "express";

interface WindowEntry {
  count: number;
  resetAt: number;
}

interface RateLimitOptions {
  windowMs: number;
  maxRequests: number;
  message: string;
}

export const createRateLimiter = ({ windowMs, maxRequests, message }: RateLimitOptions) => {
  const windows = new Map<string, WindowEntry>();

  return (req: Request, res: Response, next: NextFunction) => {
    const now = Date.now();
    const key = req.ip || req.socket.remoteAddress || "unknown";
    let entry = windows.get(key);

    if (!entry || entry.resetAt <= now) {
      if (windows.size >= 10_000) {
        for (const [ip, window] of windows) {
          if (window.resetAt <= now) windows.delete(ip);
        }
        if (windows.size >= 10_000 && !windows.has(key)) {
          return res.status(503).json({
            success: false,
            message: "Protection anti-abus temporairement indisponible"
          });
        }
      }
      entry = { count: 0, resetAt: now + windowMs };
      windows.set(key, entry);
    }

    entry.count += 1;
    const remaining = Math.max(0, maxRequests - entry.count);
    const retryAfterSeconds = Math.max(1, Math.ceil((entry.resetAt - now) / 1000));
    res.setHeader("RateLimit-Limit", String(maxRequests));
    res.setHeader("RateLimit-Remaining", String(remaining));
    res.setHeader("RateLimit-Reset", String(Math.ceil(entry.resetAt / 1000)));

    if (entry.count > maxRequests) {
      res.setHeader("Retry-After", String(retryAfterSeconds));
      return res.status(429).json({ success: false, message });
    }
    return next();
  };
};
