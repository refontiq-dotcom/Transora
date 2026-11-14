import type { Request, Response } from "express";
import app from "../src/app";

// Vercel rewrites incoming paths to /api/*; restore the original Express path.
export default function handler(req: Request, res: Response): void {
  const originalUrl = req.url || "/";
  req.url = originalUrl === "/api/root"
    ? "/"
    : originalUrl.replace(/^\/api(?=\/|$)/, "") || "/";
  app(req, res);
}
