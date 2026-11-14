/**
 * Module: Authentification et Autorisation
 *
 * Gère la création de tenants (entreprises), utilisateurs, rôles et permissions.
 * Multi-tenant : chaque tenant a son propre espace de noms d'utilisateurs.
 */

import { NextFunction, Router, Request, Response } from "express";
import { body, validationResult } from "express-validator";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { pool } from "../../db/pool";
import { authRateLimit } from "../../middleware/auth-rate-limit";

const router = Router();

const validate = (req: Request, res: Response, next: NextFunction) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({
      success: false,
      message: "Données invalides",
      errors: errors.array()
    });
  }
  next();
};

const isUniqueViolation = (error: unknown): boolean =>
  typeof error === "object" &&
  error !== null &&
  "code" in error &&
  error.code === "23505";

const createToken = (user: { id: string; email: string; role: string; tenantId: string }) => {
  const secret = process.env.JWT_SECRET;
  if (!secret) {
    throw new Error("JWT_SECRET n'est pas configuré");
  }

  return jwt.sign(
    { email: user.email, role: user.role, tenantId: user.tenantId },
    secret,
    { subject: user.id, expiresIn: "8h" }
  );
};

router.post(
  "/register",
  authRateLimit({
    limits: [
      { scope: "register:ip", identifier: (req) => req.ip || req.socket.remoteAddress || "unknown", maxAttempts: 3, windowSeconds: 3600 },
      { scope: "register:email", identifier: (req) => String(req.body?.email || "").trim().toLowerCase(), maxAttempts: 2, windowSeconds: 3600 }
    ]
  }),
  [
    body("name").isString().trim().notEmpty(),
    body("email").isEmail().normalizeEmail(),
    body("password").isString().isLength({ min: 12 }),
    body("companyName").isString().trim().notEmpty(),
    body("siret").optional().isString().trim()
  ],
  validate,
  async (req: Request, res: Response) => {
  try {
    if (!process.env.JWT_SECRET || process.env.JWT_SECRET.length < 32) {
      return res.status(503).json({
        success: false,
        message: "Authentification indisponible - JWT_SECRET doit contenir au moins 32 caractères"
      });
    }

    const { name, email, password, companyName, siret } = req.body;

    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const tenantResult = await client.query<{ id: string }>(
        "INSERT INTO tenants (name, siret) VALUES ($1, $2) RETURNING id",
        [companyName.trim(), siret || null]
      );
      const tenantId = tenantResult.rows[0].id;
      const passwordHash = await bcrypt.hash(password, 12);
      const userResult = await client.query<{ id: string; email: string; role: string }>(
        `INSERT INTO users (tenant_id, name, email, password_hash, role)
         VALUES ($1, $2, $3, $4, 'administrateur')
         RETURNING id, email, role`,
        [tenantId, name.trim(), email.toLowerCase(), passwordHash]
      );
      const user = { ...userResult.rows[0], tenantId };
      const token = createToken(user);
      await client.query("COMMIT");

      return res.status(201).json({
        success: true,
        data: {
          token,
          user: { id: user.id, name: name.trim(), email: user.email, role: user.role, tenantId }
        },
        message: "Entreprise créée avec succès"
      });
    } catch (error) {
      await client.query("ROLLBACK");
      if (isUniqueViolation(error)) {
        return res.status(409).json({
          success: false,
          message: "Une entreprise ou un utilisateur utilise déjà ces informations"
        });
      }
      throw error;
    } finally {
      client.release();
    }
  } catch (error) {
    console.error("Erreur lors de l'enregistrement du tenant:", error);
    return res.status(500).json({
      success: false,
      message: "Erreur interne du serveur"
    });
  }
});

router.post(
  "/login",
  authRateLimit({
    limits: [
      { scope: "login:ip", identifier: (req) => req.ip || req.socket.remoteAddress || "unknown", maxAttempts: 10, windowSeconds: 900 },
      { scope: "login:email", identifier: (req) => String(req.body?.email || "").trim().toLowerCase(), maxAttempts: 5, windowSeconds: 900 }
    ]
  }),
  [
    body("email").isEmail().normalizeEmail(),
    body("password").isString().notEmpty()
  ],
  validate,
  async (req: Request, res: Response) => {
  try {
    if (!process.env.JWT_SECRET || process.env.JWT_SECRET.length < 32) {
      return res.status(503).json({
        success: false,
        message: "Authentification indisponible - JWT_SECRET doit contenir au moins 32 caractères"
      });
    }

    const { email, password } = req.body;

    const result = await pool.query<{
      id: string;
      name: string;
      email: string;
      role: string;
      tenant_id: string;
      password_hash: string;
    }>(
      `SELECT id, name, email, role, tenant_id, password_hash
       FROM users WHERE email = $1`,
      [email.toLowerCase()]
    );
    const user = result.rows[0];
    if (!user || !(await bcrypt.compare(password, user.password_hash))) {
      return res.status(401).json({
        success: false,
        message: "Adresse e-mail ou mot de passe incorrect"
      });
    }

    return res.json({
      success: true,
      data: {
        token: createToken({
          id: user.id,
          email: user.email,
          role: user.role,
          tenantId: user.tenant_id
        }),
        user: {
          id: user.id,
          name: user.name,
          email: user.email,
          role: user.role,
          tenantId: user.tenant_id
        }
      }
    });
  } catch (error) {
    console.error("Erreur lors de la connexion:", error);
    return res.status(500).json({
      success: false,
      message: "Erreur interne du serveur"
    });
  }
});

export default router;