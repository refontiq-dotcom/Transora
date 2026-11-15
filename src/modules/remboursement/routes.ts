import { NextFunction, Request, Response, Router } from "express";
import { body, param, validationResult } from "express-validator";
import { PoolClient } from "pg";
import { pool } from "../../db/pool";
import { authorize } from "../../middleware/auth";

const router = Router();
const managers = authorize(["administrateur", "responsable_financier"]);
const validate = (req: Request, res: Response, next: NextFunction) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ success: false, message: "Données invalides", errors: errors.array() });
  next();
};

type RefundPolicy = { version?: number; refundPolicy?: "NONE" | "FULL" | "PARTIAL"; refundPercentage?: number };

export function calculateRefundableAmount(transport: number, companyFee: number, snapshot: RefundPolicy): number {
  const percent = snapshot.refundPolicy === "FULL" ? 100
    : snapshot.refundPolicy === "PARTIAL" ? Number(snapshot.refundPercentage || 0) : 0;
  if (!Number.isInteger(percent) || percent < 0 || percent > 100) return 0;
  // Le frais plateforme est volontairement exclu : son traitement n'a pas été arrêté.
  return Math.floor((Math.max(0, transport) + Math.max(0, companyFee)) * percent / 100);
}

router.get("/", managers, async (req: Request, res: Response, next: NextFunction) => {
  if (!req.tenantId) return res.status(401).json({ success: false, message: "Tenant non identifié" });
  try {
    const result = await pool.query(
      `SELECT r.id, r.booking_id AS "bookingId", b.passenger_name AS "passengerName",
              r.reason, r.customer_explanation AS "explanation", r.payment_channel AS "paymentChannel",
              r.refundable_basis AS "refundableBasis", r.refundable_amount AS "refundableAmount",
              r.policy_version AS "policyVersion", r.status, r.decision_note AS "decisionNote",
              r.created_at AS "createdAt", r.decided_at AS "decidedAt", r.settled_at AS "settledAt"
       FROM refund_requests r
       JOIN bookings b ON b.id = r.booking_id AND b.tenant_id = r.tenant_id
       WHERE r.tenant_id = $1
       ORDER BY r.created_at DESC LIMIT 200`,
      [req.tenantId]
    );
    return res.json({ success: true, data: result.rows });
  } catch (error) { return next(error); }
});

router.post("/requests", managers, [
  body("bookingId").isUUID(),
  body("reason").isIn(["CUSTOMER_CANCELLED", "NO_SHOW", "COMPANY_CANCELLED", "SERVICE_FAILURE", "DUPLICATE_PAYMENT", "OTHER"]),
  body("explanation").optional().isString().trim().isLength({ max: 1000 })
], validate, async (req: Request, res: Response, next: NextFunction) => {
  if (!req.tenantId || !req.user) return res.status(401).json({ success: false, message: "Tenant non identifié" });
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await client.query(
      `SELECT b.id, b.status AS booking_status, b.amount_transport, b.company_booking_fee,
              b.platform_fee, b.boarding_policy_version, b.boarding_policy_snapshot,
              p.id AS payment_id, p.status AS payment_status, p.payment_method
       FROM bookings b
       JOIN payments p ON p.booking_id = b.id AND p.tenant_id = b.tenant_id
       WHERE b.id = $1 AND b.tenant_id = $2
       FOR UPDATE OF b, p`,
      [req.body.bookingId, req.tenantId]
    );
    const booking = result.rows[0];
    if (!booking) { await client.query("ROLLBACK"); return res.status(404).json({ success: false, message: "Billet ou paiement introuvable." }); }
    if (booking.payment_status !== "CONFIRMED" || !["PAID", "NO_SHOW", "CANCELLED"].includes(booking.booking_status)) {
      await client.query("ROLLBACK");
      return res.status(409).json({ success: false, message: "Seul un billet payé et annulé, absent ou encore remboursable peut être traité." });
    }
    const snapshot = (booking.boarding_policy_snapshot || {}) as RefundPolicy;
    const amount = calculateRefundableAmount(Number(booking.amount_transport), Number(booking.company_booking_fee), snapshot);
    if (amount <= 0) {
      await client.query("ROLLBACK");
      return res.status(409).json({ success: false, message: "La politique enregistrée lors de la réservation ne prévoit aucun remboursement." });
    }
    const prior = await client.query(
      `SELECT COALESCE(SUM(refundable_amount),0)::bigint AS reserved
       FROM refund_requests WHERE tenant_id=$1 AND booking_id=$2
         AND status IN ('REQUESTED','APPROVED_PENDING_PROVIDER','PAID')`,
      [req.tenantId, booking.id]
    );
    if (Number(prior.rows[0].reserved) + amount > Number(booking.amount_transport) + Number(booking.company_booking_fee)) {
      await client.query("ROLLBACK");
      return res.status(409).json({ success: false, message: "Le montant remboursable a déjà été demandé ou versé." });
    }
    const channel = booking.payment_method === "cash" ? "CASH" : "ONLINE";
    const inserted = await client.query(
      `INSERT INTO refund_requests
        (tenant_id, booking_id, payment_id, requested_by, reason, customer_explanation,
         payment_channel, refundable_basis, refundable_amount, policy_version, policy_snapshot)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::jsonb)
       RETURNING id, booking_id AS "bookingId", payment_channel AS "paymentChannel",
                 refundable_amount AS "refundableAmount", status, created_at AS "createdAt"`,
      [req.tenantId, booking.id, booking.payment_id, req.user.id, req.body.reason,
        String(req.body.explanation || "").trim(), channel,
        Number(booking.amount_transport) + Number(booking.company_booking_fee), amount,
        Number(booking.boarding_policy_version || snapshot.version || 1), JSON.stringify(snapshot)]
    );
    await client.query(
      `INSERT INTO audit_events (tenant_id, actor_user_id, type, subject, action, details)
       VALUES ($1,$2,'création','remboursement','Demande de remboursement créée',$3::jsonb)`,
      [req.tenantId, req.user.id, JSON.stringify({ refundRequestId: inserted.rows[0].id, bookingId: booking.id, amount, channel })]
    );
    await client.query("COMMIT");
    return res.status(201).json({ success: true, data: inserted.rows[0], message: "Demande créée. Validation d'un responsable requise." });
  } catch (error) {
    await client.query("ROLLBACK");
    if ((error as { code?: string }).code === "23505") return res.status(409).json({ success: false, message: "Une demande de remboursement est déjà en cours pour ce billet." });
    return next(error);
  } finally { client.release(); }
});

router.patch("/:id/reject", managers, [param("id").isUUID(), body("note").optional().isString().trim().isLength({ max: 1000 })], validate,
  async (req: Request, res: Response, next: NextFunction) => {
    if (!req.tenantId || !req.user) return res.status(401).json({ success: false, message: "Tenant non identifié" });
    try {
      const result = await pool.query(
        `UPDATE refund_requests SET status='REJECTED', approved_by=$3, decided_at=NOW(),
                decision_note=$4
         WHERE id=$1 AND tenant_id=$2 AND status='REQUESTED'
         RETURNING id, status, decided_at AS "decidedAt"`,
        [req.params.id, req.tenantId, req.user.id, String(req.body.note || "").trim()]
      );
      if (!result.rowCount) return res.status(409).json({ success: false, message: "Demande introuvable ou déjà traitée." });
      await pool.query(
        `INSERT INTO audit_events (tenant_id, actor_user_id, type, subject, action, details)
         VALUES ($1,$2,'modification','remboursement','Demande de remboursement rejetée',$3::jsonb)`,
        [req.tenantId, req.user.id, JSON.stringify({ refundRequestId: req.params.id, note: req.body.note || "" })]
      );
      return res.json({ success: true, data: result.rows[0] });
    } catch (error) { return next(error); }
  }
);

router.patch("/:id/approve", managers, [param("id").isUUID()], validate,
  async (req: Request, res: Response, next: NextFunction) => {
    if (!req.tenantId || !req.user) return res.status(401).json({ success: false, message: "Tenant non identifié" });
    const client: PoolClient = await pool.connect();
    try {
      await client.query("BEGIN");
      const result = await client.query(
        `SELECT r.*, p.payment_method, b.id AS booking_id
         FROM refund_requests r
         JOIN payments p ON p.id=r.payment_id AND p.tenant_id=r.tenant_id
         JOIN bookings b ON b.id=r.booking_id AND b.tenant_id=r.tenant_id
         WHERE r.id=$1 AND r.tenant_id=$2
         FOR UPDATE OF r, b, p`,
        [req.params.id, req.tenantId]
      );
      const refund = result.rows[0];
      if (!refund || refund.status !== "REQUESTED") {
        await client.query("ROLLBACK");
        return res.status(409).json({ success: false, message: "Demande introuvable ou déjà traitée." });
      }
      if (refund.payment_channel === "ONLINE") {
        const pending = await client.query(
          `UPDATE refund_requests SET status='APPROVED_PENDING_PROVIDER',
             approved_by=$3, decided_at=NOW(), decision_note='Approuvé; attente du remboursement confirmé par le prestataire'
           WHERE id=$1 AND tenant_id=$2 AND status='REQUESTED'
           RETURNING id, status, refundable_amount AS "refundableAmount"`,
          [req.params.id, req.tenantId, req.user.id]
        );
        await client.query(
          `INSERT INTO audit_events (tenant_id, actor_user_id, type, subject, action, details)
           VALUES ($1,$2,'modification','remboursement','Remboursement en ligne approuvé; prestataire requis',$3::jsonb)`,
          [req.tenantId, req.user.id, JSON.stringify({ refundRequestId: req.params.id, amount: refund.refundable_amount })]
        );
        await client.query("COMMIT");
        return res.json({ success: true, data: pending.rows[0], message: "Approuvé. Le paiement en ligne reste en attente : aucun remboursement n'est déclaré effectué sans confirmation du prestataire." });
      }
      const session = await client.query(
        `SELECT id FROM guichet_sessions WHERE tenant_id=$1 AND status='OPEN' ORDER BY opened_at DESC LIMIT 1 FOR UPDATE`,
        [req.tenantId]
      );
      if (!session.rowCount) {
        await client.query("ROLLBACK");
        return res.status(409).json({ success: false, message: "Ouvrez une session de caisse avant de remettre l'argent au client." });
      }
      await client.query(
        `UPDATE refund_requests SET status='PAID', approved_by=$3, settled_by=$3,
           decided_at=NOW(), settled_at=NOW(), cash_session_id=$4,
           decision_note='Remboursement espèces remis et enregistré en caisse'
         WHERE id=$1 AND tenant_id=$2`,
        [req.params.id, req.tenantId, req.user.id, session.rows[0].id]
      );
      await client.query(
        `INSERT INTO guichet_operations (tenant_id, session_id, booking_id, type, amount, payment_method, description, recorded_by)
         VALUES ($1,$2,$3,'REFUND',$4,'cash',$5,$6)`,
        [req.tenantId, session.rows[0].id, refund.booking_id, refund.refundable_amount,
          "Remboursement billet " + refund.booking_id, req.user.id]
      );
      await client.query(
        `INSERT INTO financial_operations (tenant_id, type, amount_fcfa, category, description, reference, recorded_by)
         VALUES ($1,'remboursement',$2,'billetterie','Remboursement espèces',$3,$4)`,
        [req.tenantId, refund.refundable_amount, req.params.id, req.user.id]
      );
      await client.query(
        "UPDATE bookings SET status='REFUNDED' WHERE id=$1 AND tenant_id=$2",
        [refund.booking_id, req.tenantId]
      );
      await client.query(
        `INSERT INTO audit_events (tenant_id, actor_user_id, type, subject, action, details)
         VALUES ($1,$2,'paiement','remboursement','Remboursement espèces exécuté',$3::jsonb)`,
        [req.tenantId, req.user.id, JSON.stringify({ refundRequestId: req.params.id, bookingId: refund.booking_id, amount: refund.refundable_amount, cashSessionId: session.rows[0].id })]
      );
      await client.query("COMMIT");
      return res.json({ success: true, data: { id: req.params.id, status: "PAID", refundableAmount: refund.refundable_amount }, message: "Remboursement espèces exécuté et inscrit dans la caisse et le journal financier." });
    } catch (error) {
      await client.query("ROLLBACK");
      return next(error);
    } finally { client.release(); }
  }
);

export default router;
