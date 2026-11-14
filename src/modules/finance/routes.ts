import { NextFunction, Request, Response, Router } from "express";
import { body, query, validationResult } from "express-validator";
import { pool } from "../../db/pool";

const router = Router();
const operationTypes = ["revenu", "dépense", "remboursement", "commission", "frais_transora"];

const validate = (req: Request, res: Response, next: NextFunction) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ success: false, message: "Données invalides", errors: errors.array() });
  }
  next();
};

const requireTenant = (req: Request, res: Response): string | undefined => {
  if (!req.tenantId) {
    res.status(401).json({ success: false, message: "Tenant non identifié" });
    return undefined;
  }
  return req.tenantId;
};

const dateFilters = [
  query("startDate").optional().isISO8601(),
  query("endDate").optional().isISO8601()
];

const financialRowsQuery = `
  SELECT id, type, amount, category, description, reference, created_at AS "createdAt", source
  FROM (
    SELECT id, type, amount_fcfa::numeric AS amount, category, description,
           reference, created_at, 'saisie'::text AS source
    FROM financial_operations
    WHERE tenant_id = $1
      AND ($2::date IS NULL OR created_at >= $2::date)
      AND ($3::date IS NULL OR created_at < $3::date + INTERVAL '1 day')
    UNION ALL
    SELECT id, 'revenu'::text, amount_transport::numeric, 'billetterie'::text,
           'Paiement confirmé'::text, booking_id::text, confirmed_at, 'paiement'::text
    FROM payments
    WHERE tenant_id = $1 AND status = 'CONFIRMED'
      AND ($2::date IS NULL OR confirmed_at >= $2::date)
      AND ($3::date IS NULL OR confirmed_at < $3::date + INTERVAL '1 day')
    UNION ALL
    SELECT id, 'revenu'::text, company_booking_fee::numeric, 'frais compagnie'::text,
           'Frais de réservation compagnie'::text, booking_id::text, confirmed_at, 'paiement'::text
    FROM payments
    WHERE tenant_id = $1 AND status = 'CONFIRMED' AND company_booking_fee > 0
      AND ($2::date IS NULL OR confirmed_at >= $2::date)
      AND ($3::date IS NULL OR confirmed_at < $3::date + INTERVAL '1 day')
    UNION ALL
    SELECT id, 'frais_transora'::text, platform_fee::numeric, 'commission'::text,
           'Frais TRANSORA sur paiement confirmé'::text, booking_id::text,
           confirmed_at, 'paiement'::text
    FROM payments
    WHERE tenant_id = $1 AND status = 'CONFIRMED'
      AND ($2::date IS NULL OR confirmed_at >= $2::date)
      AND ($3::date IS NULL OR confirmed_at < $3::date + INTERVAL '1 day')
  ) operations
  ORDER BY created_at DESC
  LIMIT 500`;

const csvCell = (value: unknown): string =>
  `"${String(value ?? "").replaceAll("\"", "\"\"")}"`;

router.post(
  "/operation",
  [
    body("type").isIn(operationTypes),
    body("montant").isInt({ min: 0, max: 2_000_000_000 }),
    body("catégorie").optional().isString().trim().isLength({ max: 120 }),
    body("description").optional().isString().trim().isLength({ max: 2000 }),
    body("référence").optional({ nullable: true }).isString().trim().isLength({ max: 200 })
  ],
  validate,
  async (req: Request, res: Response, next: NextFunction) => {
    const tenantId = requireTenant(req, res);
    if (!tenantId) return;
    try {
      const result = await pool.query(
        `INSERT INTO financial_operations
           (tenant_id, type, amount_fcfa, category, description, reference, recorded_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         RETURNING id, type, amount_fcfa AS "montant", category AS "catégorie",
                   description, reference AS "référence", created_at AS "enregistréLe"`,
        [
          tenantId, req.body.type, Number(req.body.montant),
          req.body.catégorie || "générale", req.body.description || "",
          req.body.référence || null, req.user?.id || null
        ]
      );
      return res.status(201).json({ success: true, data: result.rows[0] });
    } catch (error) {
      return next(error);
    }
  }
);

router.get(
  "/",
  [...dateFilters, query("type").optional().isIn(operationTypes)],
  validate,
  async (req: Request, res: Response, next: NextFunction) => {
    const tenantId = requireTenant(req, res);
    if (!tenantId) return;
    try {
      const startDate = typeof req.query.startDate === "string" ? req.query.startDate : null;
      const endDate = typeof req.query.endDate === "string" ? req.query.endDate : null;
      const result = await pool.query(
        `${financialRowsQuery.replace("LIMIT 500", "LIMIT 500")}`,
        [tenantId, startDate, endDate]
      );
      const operations = req.query.type
        ? result.rows.filter((row) => row.type === req.query.type)
        : result.rows;
      return res.json({ success: true, data: { opérations: operations, count: operations.length } });
    } catch (error) {
      return next(error);
    }
  }
);

router.get(
  "/stats",
  dateFilters,
  validate,
  async (req: Request, res: Response, next: NextFunction) => {
    const tenantId = requireTenant(req, res);
    if (!tenantId) return;
    const startDate = typeof req.query.startDate === "string" ? req.query.startDate : null;
    const endDate = typeof req.query.endDate === "string" ? req.query.endDate : null;
    try {
      const [payments, manual] = await Promise.all([
        pool.query<{
          tickets: string;
          transport_revenue: string;
          company_booking_fees: string;
          transora_fees: string;
        }>(
          `SELECT COUNT(*) AS tickets,
                  COALESCE(SUM(amount_transport), 0) AS transport_revenue,
                  COALESCE(SUM(company_booking_fee), 0) AS company_booking_fees,
                  COALESCE(SUM(platform_fee), 0) AS transora_fees
           FROM payments
           WHERE tenant_id = $1 AND status = 'CONFIRMED'
             AND ($2::date IS NULL OR confirmed_at >= $2::date)
             AND ($3::date IS NULL OR confirmed_at < $3::date + INTERVAL '1 day')`,
          [tenantId, startDate, endDate]
        ),
        pool.query<{
          expenses: string;
          refunds: string;
          manual_revenue: string;
        }>(
          `SELECT
             COALESCE(SUM(amount_fcfa) FILTER (WHERE type = 'dépense'), 0) AS expenses,
             COALESCE(SUM(amount_fcfa) FILTER (WHERE type = 'remboursement'), 0) AS refunds,
             COALESCE(SUM(amount_fcfa) FILTER (WHERE type IN ('revenu', 'commission')), 0) AS manual_revenue
           FROM financial_operations
           WHERE tenant_id = $1
             AND ($2::date IS NULL OR created_at >= $2::date)
             AND ($3::date IS NULL OR created_at < $3::date + INTERVAL '1 day')`,
          [tenantId, startDate, endDate]
        )
      ]);
      const paid = payments.rows[0];
      const manualTotals = manual.rows[0];
      const transportRevenue = Number(paid.transport_revenue) + Number(manualTotals.manual_revenue);
      const companyBookingFees = Number(paid.company_booking_fees);
      const expenses = Number(manualTotals.expenses);
      const refunds = Number(manualTotals.refunds);
      return res.json({
        success: true,
        data: {
          période: { début: startDate, fin: endDate },
          résumé: {
            billetsTraités: Number(paid.tickets),
            revenusTransport: transportRevenue,
            fraisCompagnie: companyBookingFees,
            fraisTransora: Number(paid.transora_fees),
            dépensesTotales: expenses,
            remboursements: refunds,
            bénéficeNetEntreprise: transportRevenue + companyBookingFees - expenses - refunds
          }
        }
      });
    } catch (error) {
      return next(error);
    }
  }
);

router.get(
  "/rapportexport",
  [...dateFilters, query("format").optional().isIn(["json", "csv"])],
  validate,
  async (req: Request, res: Response, next: NextFunction) => {
    const tenantId = requireTenant(req, res);
    if (!tenantId) return;
    try {
      const startDate = typeof req.query.startDate === "string" ? req.query.startDate : null;
      const endDate = typeof req.query.endDate === "string" ? req.query.endDate : null;
      const result = await pool.query(
        financialRowsQuery,
        [tenantId, startDate, endDate]
      );
      if (req.query.format === "csv") {
        const headers = ["id", "type", "amount", "category", "description", "reference", "createdAt", "source"];
        const lines = [
          headers.join(","),
          ...result.rows.map((row) => headers.map((header) => csvCell(row[header])).join(","))
        ];
        res.type("text/csv; charset=utf-8");
        res.setHeader("Content-Disposition", 'attachment; filename="rapport-financier.csv"');
        return res.send(`\uFEFF${lines.join("\r\n")}`);
      }
      return res.json({
        success: true,
        data: {
          type: "rapport_financier",
          généréLe: new Date().toISOString(),
          période: { début: startDate, fin: endDate },
          opérations: result.rows
        }
      });
    } catch (error) {
      return next(error);
    }
  }
);

export default router;
