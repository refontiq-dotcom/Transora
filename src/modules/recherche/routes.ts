import { NextFunction, Request, Response, Router } from "express";
import { param, query, validationResult } from "express-validator";
import bwipjs from "bwip-js";
import QRCode from "qrcode";
import { pool } from "../../db/pool";

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

router.get(
  "/",
  [query("q").isString().trim().isLength({ min: 2, max: 100 })],
  validate,
  async (req: Request, res: Response, next: NextFunction) => {
    if (!req.tenantId) {
      return res.status(401).json({ success: false, message: "Tenant non identifié" });
    }

    try {
      const term = String(req.query.q).trim();
      const normalizedTerm = term.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
      const result = await pool.query(
        `WITH matches AS (
           SELECT 'billet'::text AS type, b.id::text AS id, b.passenger_name AS title,
                  d.origin || ' → ' || d.destination AS subtitle,
                  concat_ws(' · ',
                    CASE p.status
                      WHEN 'CONFIRMED' THEN 'Paiement confirmé'
                      WHEN 'PENDING' THEN 'Paiement à confirmer'
                      WHEN 'CANCELLED' THEN 'Paiement annulé'
                      ELSE 'Paiement non initié'
                    END,
                    CASE p.payment_method
                      WHEN 'cash' THEN 'Espèces'
                      WHEN 'card' THEN 'Carte'
                      WHEN 'mobile_money' THEN 'Mobile Money'
                      WHEN 'bank_transfer' THEN 'Virement'
                      ELSE NULL
                    END,
                    p.payment_method,
                    p.status,
                    'Départ ' || to_char(d.departure_at, 'DD/MM/YYYY HH24:MI')
                  ) AS detail,
                  b.status AS status,
                  b.created_at AS created_at,
                  '#payments' AS href,
                  CASE WHEN b.id::text = $2 OR p.id::text = $2 THEN 0 ELSE 1 END AS rank
           FROM bookings b
           JOIN departures d ON d.id = b.departure_id AND d.tenant_id = b.tenant_id
           LEFT JOIN payments p ON p.booking_id = b.id AND p.tenant_id = b.tenant_id
           WHERE b.tenant_id = $1 AND b.status <> 'CANCELLED'
             AND strpos(translate(lower(concat_ws(' ', b.id::text, p.id::text, b.passenger_name,
                 d.origin, d.destination, p.payment_method, p.status, p.proof,
                 b.amount_transport::text, b.platform_fee::text,
                 (b.amount_transport + b.platform_fee)::text,
                 to_char(d.departure_at, 'DD/MM/YYYY HH24:MI'), 'Mobile Money',
                 'Paiement confirmé', 'Paiement à confirmer', 'Espèces', 'Virement')),
                 'àâäéèêëîïôöùûüç', 'aaaeeeeiioouuuc'), $3) > 0

           UNION ALL

           SELECT 'départ', d.id::text, d.origin || ' → ' || d.destination,
                  d.vehicle_code,
                  to_char(d.departure_at, 'DD/MM/YYYY HH24:MI'),
                  d.status, d.departure_at, '#voyages',
                  CASE WHEN d.id::text = $2 THEN 0 ELSE 1 END
           FROM departures d
           WHERE d.tenant_id = $1
             AND strpos(translate(lower(concat_ws(' ', d.id::text, d.origin, d.destination,
                 d.vehicle_code, d.status, to_char(d.departure_at, 'DD/MM/YYYY HH24:MI'))),
                 'àâäéèêëîïôöùûüç', 'aaaeeeeiioouuuc'), $3) > 0

           UNION ALL

           SELECT 'véhicule', v.id::text, v.registration, v.model,
                  concat_ws(' · ', v.status, v.manufacture_year::text),
                  v.status, v.created_at, '#flotte',
                  CASE WHEN v.id::text = $2 THEN 0 ELSE 1 END
           FROM vehicles v
           WHERE v.tenant_id = $1 AND v.deleted_at IS NULL
             AND strpos(translate(lower(concat_ws(' ', v.id::text, v.registration, v.model, v.status,
                 v.manufacture_year::text)), 'àâäéèêëîïôöùûüç', 'aaaeeeeiioouuuc'), $3) > 0

           UNION ALL

           SELECT 'opération', f.id::text, f.description, f.category,
                  concat_ws(' · ', f.type, f.amount_fcfa::text || ' FCFA', f.reference),
                  f.type, f.created_at, '#reports',
                  CASE WHEN f.id::text = $2 THEN 0 ELSE 1 END
           FROM financial_operations f
           WHERE f.tenant_id = $1
             AND strpos(translate(lower(concat_ws(' ', f.id::text, f.description, f.category, f.type,
                 f.reference, f.amount_fcfa::text, to_char(f.created_at, 'DD/MM/YYYY'))),
                 'àâäéèêëîïôöùûüç', 'aaaeeeeiioouuuc'), $3) > 0
         )
         SELECT type, id, title, subtitle, detail, status, created_at AS "createdAt", href
         FROM matches
         ORDER BY rank, created_at DESC
         LIMIT 30`,
        [req.tenantId, term.toLowerCase(), normalizedTerm]
      );
      return res.json({
        success: true,
        data: { résultats: result.rows, count: result.rowCount }
      });
    } catch (error) {
      return next(error);
    }
  }
);

router.get(
  "/billet/:id",
  [
    param("id").isUUID().withMessage("L'identifiant du billet est invalide"),
    query("images").optional().isBoolean()
  ],
  validate,
  async (req: Request, res: Response, next: NextFunction) => {
    if (!req.tenantId) {
      return res.status(401).json({ success: false, message: "Tenant non identifié" });
    }

    try {
      const result = await pool.query<{
        id: string;
        passenger_name: string;
        amount_transport: number;
        platform_fee: number;
        booking_status: string;
        origin: string;
        destination: string;
        departure_at: Date;
        vehicle_code: string;
        departure_status: string;
        payment_status: string | null;
        payment_method: string | null;
        ticket_token: string;
        seat_number: number | null;
        company_name: string;
        boarded_at: Date | null;
      }>(
        `SELECT b.id, b.ticket_token, b.seat_number, b.passenger_name,
                b.amount_transport, b.platform_fee, b.status AS booking_status,
                d.origin, d.destination, d.departure_at, d.vehicle_code,
                d.status AS departure_status, t.name AS company_name,
                p.status AS payment_status, p.payment_method, be.boarded_at
         FROM bookings b
         JOIN departures d ON d.id = b.departure_id AND d.tenant_id = b.tenant_id
         JOIN tenants t ON t.id = b.tenant_id
         LEFT JOIN payments p ON p.booking_id = b.id AND p.tenant_id = b.tenant_id
         LEFT JOIN boarding_events be ON be.booking_id = b.id AND be.tenant_id = b.tenant_id
         WHERE (b.id = $1 OR b.ticket_token = $1) AND b.tenant_id = $2`,
        [req.params.id, req.tenantId]
      );
      const booking = result.rows[0];
      if (!booking) {
        return res.status(404).json({ success: false, message: "Billet introuvable dans cette entreprise" });
      }

      const isPaid = booking.booking_status === "PAID" && booking.payment_status === "CONFIRMED";
      const isCancelled = booking.booking_status === "CANCELLED" || booking.departure_status === "CANCELLED";
      const isExpired = new Date(booking.departure_at).getTime() < Date.now();
      const isBoarded = Boolean(booking.boarded_at);
      const valid = isPaid && !isCancelled && !isExpired && !isBoarded;
      const includeImages = req.query.images === "true";
      const motif = isCancelled
        ? "La réservation ou le départ a été annulé."
        : !isPaid
        ? "Le paiement de ce billet n'est pas confirmé."
        : isExpired
        ? "L'heure de départ de ce billet est passée."
        : isBoarded
        ? "Ce billet a déjà été utilisé pour l'embarquement."
        : null;

      let qrCode: string | undefined;
      let codeBarres: string | undefined;
      if (includeImages && !isCancelled) {
        const [qr, barcode] = await Promise.all([
          QRCode.toDataURL(booking.ticket_token, {
            errorCorrectionLevel: "M",
            margin: 2,
            width: 280,
            color: { dark: "#09271B", light: "#FFFFFF" }
          }),
          bwipjs.toBuffer({
            bcid: "code128",
            text: booking.ticket_token.toUpperCase(),
            scale: 3,
            height: 12,
            includetext: true,
            textxalign: "center",
            paddingwidth: 10,
            paddingheight: 8,
            backgroundcolor: "FFFFFF",
            barcolor: "09271B"
          })
        ]);
        qrCode = qr;
        codeBarres = `data:image/png;base64,${barcode.toString("base64")}`;
      }

      return res.json({
        success: true,
        data: {
          billetId: booking.id,
          passager: booking.passenger_name,
          compagnie: booking.company_name,
          siege: booking.seat_number,
          statutReservation: booking.booking_status,
          embarqueLe: booking.boarded_at,
          origine: booking.origin,
          destination: booking.destination,
          départLe: booking.departure_at,
          véhicule: booking.vehicle_code,
          montantTotal: Number(booking.amount_transport) + Number(booking.platform_fee),
          moyenPaiement: booking.payment_method,
          statutPaiement: booking.payment_status || "NOT_INITIATED",
          valide: valid,
          motif,
          qrCode,
          codeBarres
        }
      });
    } catch (error) {
      return next(error);
    }
  }
);

export default router;
