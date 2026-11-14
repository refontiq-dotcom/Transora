import { createHmac } from "node:crypto";
import { NextFunction, Request, Response } from "express";
import { pool } from "../db/pool";

type AuthRateLimitRule = {
  scope: string;
  identifier: (req: Request) => string;
  maxAttempts: number;
  windowSeconds: number;
};

type AuthRateLimitOptions = { limits: AuthRateLimitRule[] };

let requestsSinceCleanup = 0;

const hashIdentifier = (identifier: string, secret: string): string =>
  createHmac("sha256", secret).update(identifier).digest("hex");

export const authRateLimit = ({ limits }: AuthRateLimitOptions) =>
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    const secret = process.env.JWT_SECRET;
    if (!secret || secret.length < 32) {
      res.status(503).json({ success: false, message: "Protection de l’authentification indisponible" });
      return;
    }

    try {
      for (const rule of limits) {
        const identifier = rule.identifier(req).slice(0, 320);
        if (!identifier) continue;

        const result = await pool.query<{ attempts: number; reset_at: Date | string }>(
          `INSERT INTO auth_rate_limits (scope, identifier_hash, attempts, window_started_at)
           VALUES ($1, $2, 1, NOW())
           ON CONFLICT (scope, identifier_hash) DO UPDATE
           SET attempts = CASE
                 WHEN auth_rate_limits.window_started_at <= NOW() - ($3 * INTERVAL '1 second') THEN 1
                 ELSE auth_rate_limits.attempts + 1
               END,
               window_started_at = CASE
                 WHEN auth_rate_limits.window_started_at <= NOW() - ($3 * INTERVAL '1 second') THEN NOW()
                 ELSE auth_rate_limits.window_started_at
               END
           RETURNING attempts, window_started_at + ($3 * INTERVAL '1 second') AS reset_at`,
          [rule.scope, hashIdentifier(identifier, secret), rule.windowSeconds]
        );

        const row = result.rows[0];
        if (row && Number(row.attempts) > rule.maxAttempts) {
          const retryAt = new Date(row.reset_at).getTime();
          const retryAfter = Math.max(1, Math.ceil((retryAt - Date.now()) / 1000));
          res.setHeader("Retry-After", String(retryAfter));
          res.status(429).json({
            success: false,
            message: "Trop de tentatives. Réessayez plus tard.",
            retryAfter
          });
          return;
        }
      }

      requestsSinceCleanup += 1;
      if (requestsSinceCleanup >= 500) {
        requestsSinceCleanup = 0;
        void pool.query(
          "DELETE FROM auth_rate_limits WHERE window_started_at < NOW() - INTERVAL '24 hours'"
        ).catch(() => undefined);
      }

      next();
    } catch (error) {
      next(error);
    }
  };
