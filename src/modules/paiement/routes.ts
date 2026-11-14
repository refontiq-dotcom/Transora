/**
 * Module: Réservation et billetterie avec paiement
 * Les montants sont lus depuis la réservation en base, jamais depuis le tenant fourni par le client.
 */

import { NextFunction, Router, Request, Response } from "express";
import { body, query, validationResult } from "express-validator";
import { PoolClient } from "pg";
import { pool } from "../../db/pool";
import { authorizePermission } from "../../middleware/rbac";

const router = Router();

// Les comptes applicatifs disponibles sont actuellement administrateurs d'entreprise.
router.use(authorizePermission("payments.manage"));

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

router.get("/", async (req: Request, res: Response, next: NextFunction) => {
  const tenantId = req.tenantId;
  if (!tenantId) {
    return res.status(401).json({ success: false, message: "Tenant non identifié" });
  }

  try {
    const result = await pool.query(
      `SELECT b.id AS "billetId", b.passenger_name AS "passager",
              b.amount_transport AS "montantTransport", b.platform_fee AS "fraisTransora",
              b.status AS "statutRéservation", d.origin AS "origine",
              d.destination AS "destination", d.departure_at AS "départLe",
              p.id AS "transactionId", p.payment_method AS "moyenPaiement",
              COALESCE(p.status, 'NOT_INITIATED') AS statut,
              p.proof AS preuve, p.created_at AS "crééLe", p.confirmed_at AS "confirméLe"
       FROM bookings b
       JOIN departures d ON d.id = b.departure_id AND d.tenant_id = b.tenant_id
       LEFT JOIN payments p ON p.booking_id = b.id AND p.tenant_id = b.tenant_id
       WHERE b.tenant_id = $1 AND b.status <> 'CANCELLED'
       ORDER BY b.created_at DESC
       LIMIT 200`,
      [tenantId]
    );
    return res.json({ success: true, data: { paiements: result.rows } });
  } catch (error) {
    return next(error);
  }
});

router.post(
  "/init",
  [
    body("billetId").isUUID().withMessage("L'ID billet est invalide"),
    body("moyenPaiement")
      .optional()
      .isIn(["cash", "card", "mobile_money", "bank_transfer"])
      .withMessage("Moyen de paiement invalide")
  ],
  validate,
  async (req: Request, res: Response, next: NextFunction) => {
    const tenantId = req.tenantId;
    if (!tenantId) {
      return res.status(401).json({ success: false, message: "Tenant non identifié" });
    }

    try {
      const { billetId, moyenPaiement } = req.body;
      const bookingResult = await pool.query<{
        amount_transport: number;
        platform_fee: number;
        status: string;
      }>(
        `SELECT amount_transport, platform_fee, status
         FROM bookings WHERE id = $1 AND tenant_id = $2`,
        [billetId, tenantId]
      );
      const booking = bookingResult.rows[0];
      if (!booking) {
        return res.status(404).json({ success: false, message: "Réservation introuvable" });
      }
      if (booking.status !== "RESERVED") {
        return res.status(409).json({
          success: false,
          message: "Cette réservation ne peut pas être payée"
        });
      }

      const payment = await pool.query(
        `INSERT INTO payments
           (tenant_id, booking_id, amount_transport, platform_fee, payment_method)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (booking_id) DO NOTHING
         RETURNING id, booking_id AS "billetId", amount_transport AS "montantTransport",
                   platform_fee AS "fraisTransora", payment_method AS "moyenPaiement",
                   status AS "statut", created_at AS "crééLe"`,
        [
          tenantId,
          billetId,
          booking.amount_transport,
          booking.platform_fee,
          moyenPaiement || "cash"
        ]
      );
      if (payment.rowCount === 0) {
        return res.status(409).json({
          success: false,
          message: "Un paiement a déjà été initialisé pour cette réservation"
        });
      }
      const transaction = payment.rows[0];
      return res.status(201).json({
        success: true,
        data: {
          ...transaction,
          totalPayeur: Number(transaction.montantTransport) + Number(transaction.fraisTransora)
        },
        message: "Paiement initialisé"
      });
    } catch (error) {
      return next(error);
    }
  }
);

router.post(
  "/confirm",
  [
    body("transactionId").isUUID().withMessage("L'ID transaction est invalide"),
    body("preuvePaiement").isString().trim().notEmpty().withMessage("La preuve de paiement est requise")
  ],
  validate,
  async (req: Request, res: Response, next: NextFunction) => {
    const tenantId = req.tenantId;
    if (!tenantId) {
      return res.status(401).json({ success: false, message: "Tenant non identifié" });
    }

    let client: PoolClient | undefined;
    let transactionStarted = false;
    try {
      if (req.user?.role !== "administrateur") {
        return res.status(403).json({
          success: false,
          message: "Seul un administrateur peut confirmer un paiement"
        });
      }

      client = await pool.connect();
      const { transactionId, preuvePaiement } = req.body;
      await client.query("BEGIN");
      transactionStarted = true;
      const paymentResult = await client.query<{
        booking_id: string;
        status: string;
        payment_method: string;
      }>(
        `SELECT booking_id, status, payment_method FROM payments
         WHERE id = $1 AND tenant_id = $2 FOR UPDATE`,
        [transactionId, tenantId]
      );
      const payment = paymentResult.rows[0];
      if (!payment) {
        await client.query("ROLLBACK");
        transactionStarted = false;
        return res.status(404).json({ success: false, message: "Transaction introuvable" });
      }
      if (payment.status === "CONFIRMED") {
        await client.query("COMMIT");
        transactionStarted = false;
        return res.json({
          success: true,
          data: { id: transactionId, statut: "CONFIRMED" },
          message: "Paiement déjà confirmé"
        });
      }
      if (payment.status !== "PENDING") {
        await client.query("ROLLBACK");
        transactionStarted = false;
        return res.status(409).json({
          success: false,
          message: "Cette transaction ne peut pas être confirmée"
        });
      }

      await client.query(
        `UPDATE payments
         SET status = 'CONFIRMED', confirmed_at = NOW(), proof = $2, confirmed_by = $3
         WHERE id = $1`,
        [transactionId, preuvePaiement.trim(), req.user.id]
      );
      await client.query(
        "UPDATE bookings SET status = 'PAID' WHERE id = $1 AND tenant_id = $2",
        [payment.booking_id, tenantId]
      );
      await client.query("COMMIT");
      transactionStarted = false;

      return res.json({
        success: true,
        data: {
          id: transactionId,
          statut: "CONFIRMED",
          confirméLe: new Date().toISOString(),
          réservationPayée: true
        },
        message: "Paiement confirmé et réservation mise à jour"
      });
    } catch (error) {
      if (client && transactionStarted) {
        await client.query("ROLLBACK");
      }
      return next(error);
    } finally {
      client?.release();
    }
  }
);

router.get(
  "/stats",
  [
    query("périodeDebut").optional().isISO8601(),
    query("périodeFin").optional().isISO8601()
  ],
  validate,
  async (req: Request, res: Response, next: NextFunction) => {
    const tenantId = req.tenantId;
    if (!tenantId) {
      return res.status(401).json({ success: false, message: "Tenant non identifié" });
    }

    try {
      const début = req.query["périodeDebut"] ? String(req.query["périodeDebut"]) : null;
      const fin = req.query["périodeFin"] ? String(req.query["périodeFin"]) : null;
      const result = await pool.query<{
        bookings: string;
        revenue_transport: string;
        transora_fees: string;
      }>(
        `SELECT COUNT(*) AS bookings,
                COALESCE(SUM(amount_transport), 0) AS revenue_transport,
                COALESCE(SUM(platform_fee), 0) AS transora_fees
         FROM payments
         WHERE tenant_id = $1 AND status = 'CONFIRMED'
           AND ($2::date IS NULL OR confirmed_at >= $2::date)
           AND ($3::date IS NULL OR confirmed_at < $3::date + INTERVAL '1 day')`,
        [tenantId, début, fin]
      );
      const totals = result.rows[0];
      return res.json({
        success: true,
        data: {
          période: { début, fin },
          résumés: {
            billetsTraités: Number(totals.bookings),
            revenusTransport: Number(totals.revenue_transport),
            fraisTransora: Number(totals.transora_fees)
          }
        }
      });
    } catch (error) {
      return next(error);
    }
  }
);

export default router;
