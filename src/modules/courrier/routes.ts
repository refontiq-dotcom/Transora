/**
 * Service courrier : réception, tarification, encaissement, acheminement et remise.
 * Toutes les opérations sont strictement limitées au tenant authentifié.
 */
import { randomBytes } from "node:crypto";
import { NextFunction, Request, Response, Router } from "express";
import { body, param, query, validationResult } from "express-validator";
import { PoolClient } from "pg";
import { pool } from "../../db/pool";
import { authorize, hasRole } from "../../middleware/auth";

const router = Router();
const courierReaders = authorize([
  "administrateur", "responsable_exploitation", "responsable_financier",
  "responsable_courrier", "agent_courrier"
]);
const manageTariffs = authorize(["administrateur", "responsable_courrier"]);
const createParcel = authorize(["administrateur", "responsable_courrier", "agent_courrier"]);
const receivePayment = authorize(["administrateur", "caissier", "responsable_courrier", "agent_courrier"]);
const assignParcel = authorize(["administrateur", "responsable_exploitation", "responsable_courrier"]);
const driverOnly = authorize(["chauffeur"]);
const stationCourier = authorize(["administrateur", "responsable_courrier", "agent_courrier"]);

const validate = (req: Request, res: Response, next: NextFunction) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({
    success: false, message: "Données invalides", errors: errors.array()
  });
  return next();
};

const tenant = (req: Request, res: Response): string | undefined => {
  if (!req.tenantId || !req.user) {
    res.status(401).json({ success: false, message: "Session entreprise manquante" });
    return undefined;
  }
  return req.tenantId;
};

const addEvent = async (
  client: PoolClient,
  tenantId: string,
  parcelId: string,
  actorId: string,
  eventType: string,
  notes = "",
  departureId: string | null = null,
  metadata: Record<string, unknown> = {}
) => {
  await client.query(
    `INSERT INTO courier_events
       (tenant_id, parcel_id, actor_user_id, event_type, notes, departure_id, metadata)
     VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb)`,
    [tenantId, parcelId, actorId, eventType, notes, departureId, JSON.stringify(metadata)]
  );
};

const parcelSelect = `
  SELECT id, tracking_code AS "trackingCode", origin, destination,
         sender_name AS "senderName", sender_phone AS "senderPhone",
         recipient_name AS "recipientName", recipient_phone AS "recipientPhone",
         description, weight_kg AS "weightKg", declared_value AS "declaredValue",
         amount_fcfa AS "amountFcfa", payment_status AS "paymentStatus",
         payment_method AS "paymentMethod", status, departure_id AS "departureId",
         assigned_driver_user_id AS "driverUserId", receiver_name AS "receiverName",
         receiver_reference AS "receiverReference", paid_at AS "paidAt",
         assigned_at AS "assignedAt", arrival_at AS "arrivalAt",
         delivered_at AS "deliveredAt", created_at AS "createdAt"
  FROM courier_parcels`;

router.get("/tarifs", courierReaders, async (req: Request, res: Response, next: NextFunction) => {
  const tenantId = tenant(req, res);
  if (!tenantId) return;
  try {
    const result = await pool.query(
      `SELECT id, origin, destination, amount_fcfa AS "amountFcfa",
              is_active AS "isActive", updated_at AS "updatedAt"
       FROM courier_route_tariffs WHERE tenant_id = $1
       ORDER BY origin, destination`,
      [tenantId]
    );
    return res.json({ success: true, data: result.rows });
  } catch (error) { return next(error); }
});

router.post("/tarifs", manageTariffs, [
  body("origin").isString().trim().isLength({ min: 2, max: 100 }),
  body("destination").isString().trim().isLength({ min: 2, max: 100 }),
  body("amountFcfa").isInt({ min: 1, max: 2000000000 })
], validate, async (req: Request, res: Response, next: NextFunction) => {
  const tenantId = tenant(req, res);
  if (!tenantId) return;
  if (String(req.body.origin).trim().toLowerCase() === String(req.body.destination).trim().toLowerCase()) {
    return res.status(400).json({ success: false, message: "Les gares de départ et d'arrivée doivent être différentes" });
  }
  try {
    const result = await pool.query(
      `INSERT INTO courier_route_tariffs (tenant_id, origin, destination, amount_fcfa)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (tenant_id,
         (lower(regexp_replace(btrim(origin), '[[:space:]]+', ' ', 'g'))),
         (lower(regexp_replace(btrim(destination), '[[:space:]]+', ' ', 'g'))))
       DO UPDATE SET amount_fcfa = EXCLUDED.amount_fcfa, is_active = TRUE, updated_at = NOW()
       RETURNING id, origin, destination, amount_fcfa AS "amountFcfa", is_active AS "isActive"`,
      [tenantId, String(req.body.origin).trim(), String(req.body.destination).trim(), Number(req.body.amountFcfa)]
    );
    return res.status(201).json({ success: true, data: result.rows[0] });
  } catch (error) { return next(error); }
});

router.patch("/tarifs/:id", manageTariffs, [
  param("id").isUUID(),
  body("amountFcfa").optional().isInt({ min: 1, max: 2000000000 }),
  body("isActive").optional().isBoolean()
], validate, async (req: Request, res: Response, next: NextFunction) => {
  const tenantId = tenant(req, res);
  if (!tenantId) return;
  if (req.body.amountFcfa === undefined && req.body.isActive === undefined) {
    return res.status(400).json({ success: false, message: "Aucune modification fournie" });
  }
  try {
    const result = await pool.query(
      `UPDATE courier_route_tariffs
       SET amount_fcfa = COALESCE($3, amount_fcfa),
           is_active = COALESCE($4, is_active), updated_at = NOW()
       WHERE id = $1 AND tenant_id = $2
       RETURNING id, origin, destination, amount_fcfa AS "amountFcfa", is_active AS "isActive"`,
      [req.params.id, tenantId, req.body.amountFcfa ?? null, req.body.isActive ?? null]
    );
    if (!result.rowCount) return res.status(404).json({ success: false, message: "Tarif courrier introuvable" });
    return res.json({ success: true, data: result.rows[0] });
  } catch (error) { return next(error); }
});

router.post("/colis", createParcel, [
  body("origin").isString().trim().isLength({ min: 2, max: 100 }),
  body("destination").isString().trim().isLength({ min: 2, max: 100 }),
  body("senderName").isString().trim().isLength({ min: 2, max: 160 }),
  body("senderPhone").isString().trim().isLength({ min: 6, max: 30 }),
  body("recipientName").isString().trim().isLength({ min: 2, max: 160 }),
  body("recipientPhone").isString().trim().isLength({ min: 6, max: 30 }),
  body("description").isString().trim().isLength({ min: 2, max: 500 }),
  body("weightKg").optional({ nullable: true }).isFloat({ min: 0.01, max: 10000 }),
  body("declaredValue").optional().isInt({ min: 0, max: 2000000000 })
], validate, async (req: Request, res: Response, next: NextFunction) => {
  const tenantId = tenant(req, res);
  if (!tenantId || !req.user) return;
  if (String(req.body.origin).trim().toLowerCase() === String(req.body.destination).trim().toLowerCase()) {
    return res.status(400).json({ success: false, message: "Les gares de départ et d'arrivée doivent être différentes" });
  }
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const tariff = await client.query(
      `SELECT amount_fcfa FROM courier_route_tariffs
       WHERE tenant_id = $1 AND is_active = TRUE
         AND lower(regexp_replace(btrim(origin), '[[:space:]]+', ' ', 'g')) =
             lower(regexp_replace(btrim($2), '[[:space:]]+', ' ', 'g'))
         AND lower(regexp_replace(btrim(destination), '[[:space:]]+', ' ', 'g')) =
             lower(regexp_replace(btrim($3), '[[:space:]]+', ' ', 'g'))
       LIMIT 1 FOR SHARE`,
      [tenantId, String(req.body.origin).trim(), String(req.body.destination).trim()]
    );
    if (!tariff.rowCount) {
      await client.query("ROLLBACK");
      return res.status(409).json({ success: false, message: "Aucun tarif courrier actif n'est configuré pour ce trajet" });
    }
    const trackingCode = `TRC-${randomBytes(5).toString("hex").toUpperCase()}`;
    const inserted = await client.query(
      `INSERT INTO courier_parcels
         (tenant_id, tracking_code, origin, destination, sender_name, sender_phone,
          recipient_name, recipient_phone, description, weight_kg, declared_value,
          amount_fcfa, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
       RETURNING id, tracking_code AS "trackingCode", origin, destination,
                 sender_name AS "senderName", recipient_name AS "recipientName",
                 amount_fcfa AS "amountFcfa", payment_status AS "paymentStatus", status, created_at AS "createdAt"`,
      [
        tenantId, trackingCode, String(req.body.origin).trim(), String(req.body.destination).trim(),
        String(req.body.senderName).trim(), String(req.body.senderPhone).trim(),
        String(req.body.recipientName).trim(), String(req.body.recipientPhone).trim(),
        String(req.body.description).trim(), req.body.weightKg ?? null,
        Number(req.body.declaredValue ?? 0), Number(tariff.rows[0].amount_fcfa), req.user.id
      ]
    );
    await addEvent(client, tenantId, inserted.rows[0].id, req.user.id, "ENREGISTRE", "Colis enregistré à la gare de départ");
    await client.query("COMMIT");
    return res.status(201).json({ success: true, data: inserted.rows[0], message: "Colis enregistré. Le paiement est en attente." });
  } catch (error) {
    await client.query("ROLLBACK");
    return next(error);
  } finally { client.release(); }
});

router.get("/chauffeur/affectations", driverOnly, async (req: Request, res: Response, next: NextFunction) => {
  const tenantId = tenant(req, res);
  if (!tenantId || !req.user) return;
  try {
    const result = await pool.query(
      `${parcelSelect}
       WHERE tenant_id = $1 AND assigned_driver_user_id = $2
         AND status IN ('AFFECTE', 'CONFIE_CHAUFFEUR', 'EN_TRANSIT')
       ORDER BY assigned_at DESC`,
      [tenantId, req.user.id]
    );
    return res.json({ success: true, data: result.rows });
  } catch (error) { return next(error); }
});

router.get("/colis", courierReaders, [
  query("status").optional().isIn(["EN_ATTENTE_PAIEMENT", "EN_ATTENTE_AFFECTATION", "AFFECTE", "CONFIE_CHAUFFEUR", "EN_TRANSIT", "ARRIVE", "REMIS", "ANNULE"])
], validate, async (req: Request, res: Response, next: NextFunction) => {
  const tenantId = tenant(req, res);
  if (!tenantId) return;
  try {
    const result = await pool.query(
      `${parcelSelect}
       WHERE tenant_id = $1 AND ($2::text IS NULL OR status = $2)
       ORDER BY created_at DESC LIMIT 300`,
      [tenantId, typeof req.query.status === "string" ? req.query.status : null]
    );
    return res.json({ success: true, data: result.rows });
  } catch (error) { return next(error); }
});

router.get("/suivi/:trackingCode", courierReaders, [
  param("trackingCode").isString().trim().isLength({ min: 8, max: 40 })
], validate, async (req: Request, res: Response, next: NextFunction) => {
  const tenantId = tenant(req, res);
  if (!tenantId) return;
  try {
    const parcel = await pool.query(
      `${parcelSelect} WHERE tenant_id = $1 AND tracking_code = $2`,
      [tenantId, req.params.trackingCode]
    );
    if (!parcel.rowCount) return res.status(404).json({ success: false, message: "Courrier introuvable" });
    const events = await pool.query(
      `SELECT event_type AS "eventType", notes, created_at AS "createdAt"
       FROM courier_events WHERE tenant_id = $1 AND parcel_id = $2 ORDER BY created_at, id`,
      [tenantId, parcel.rows[0].id]
    );
    return res.json({ success: true, data: { parcel: parcel.rows[0], history: events.rows } });
  } catch (error) { return next(error); }
});

router.post("/colis/:id/paiement", receivePayment, [
  param("id").isUUID(),
  body("paymentMethod").optional().isIn(["cash"])
], validate, async (req: Request, res: Response, next: NextFunction) => {
  const tenantId = tenant(req, res);
  if (!tenantId || !req.user) return;
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const parcel = await client.query(
      "SELECT id, tracking_code, amount_fcfa, payment_status FROM courier_parcels WHERE id = $1 AND tenant_id = $2 FOR UPDATE",
      [req.params.id, tenantId]
    );
    if (!parcel.rowCount) { await client.query("ROLLBACK"); return res.status(404).json({ success: false, message: "Courrier introuvable" }); }
    if (parcel.rows[0].payment_status === "PAID") { await client.query("ROLLBACK"); return res.status(409).json({ success: false, message: "Ce courrier est déjà payé" }); }
    const amount = Number(parcel.rows[0].amount_fcfa);
    await client.query(
      `INSERT INTO courier_payments (tenant_id, parcel_id, amount_fcfa, payment_method, received_by)
       VALUES ($1, $2, $3, 'cash', $4)`,
      [tenantId, req.params.id, amount, req.user.id]
    );
    await client.query(
      `UPDATE courier_parcels SET payment_status = 'PAID', payment_method = 'cash',
         paid_by = $3, paid_at = NOW(), status = 'EN_ATTENTE_AFFECTATION', updated_at = NOW()
       WHERE id = $1 AND tenant_id = $2`,
      [req.params.id, tenantId, req.user.id]
    );
    await client.query(
      `INSERT INTO financial_operations (tenant_id, type, amount_fcfa, category, description, reference, recorded_by)
       VALUES ($1, 'revenu', $2, 'courrier', $3, $4, $5)`,
      [tenantId, amount, `Paiement courrier ${parcel.rows[0].tracking_code}`, parcel.rows[0].tracking_code, req.user.id]
    );
    await addEvent(client, tenantId, req.params.id, req.user.id, "PAYE", "Paiement en espèces enregistré");
    await client.query("COMMIT");
    return res.json({ success: true, data: { trackingCode: parcel.rows[0].tracking_code, amountFcfa: amount, paymentStatus: "PAID" } });
  } catch (error) {
    await client.query("ROLLBACK");
    return next(error);
  } finally { client.release(); }
});

router.patch("/colis/:id/affectation", assignParcel, [
  param("id").isUUID(),
  body("departureId").isUUID(),
  body("driverUserId").isUUID()
], validate, async (req: Request, res: Response, next: NextFunction) => {
  const tenantId = tenant(req, res);
  if (!tenantId || !req.user) return;
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const parcel = await client.query(
      "SELECT id, origin, destination, payment_status, status FROM courier_parcels WHERE id = $1 AND tenant_id = $2 FOR UPDATE",
      [req.params.id, tenantId]
    );
    if (!parcel.rowCount) { await client.query("ROLLBACK"); return res.status(404).json({ success: false, message: "Courrier introuvable" }); }
    if (parcel.rows[0].payment_status !== "PAID" || !["EN_ATTENTE_AFFECTATION", "AFFECTE"].includes(parcel.rows[0].status)) {
      await client.query("ROLLBACK");
      return res.status(409).json({ success: false, message: "Le courrier doit être payé et encore affectable" });
    }
    const [departure, driver] = await Promise.all([
      client.query(
        `SELECT id FROM departures WHERE id = $1 AND tenant_id = $2
         AND status IN ('SCHEDULED', 'BOARDING')
         AND lower(regexp_replace(btrim(origin), '[[:space:]]+', ' ', 'g')) =
             lower(regexp_replace(btrim($3), '[[:space:]]+', ' ', 'g'))
         AND lower(regexp_replace(btrim(destination), '[[:space:]]+', ' ', 'g')) =
             lower(regexp_replace(btrim($4), '[[:space:]]+', ' ', 'g')) FOR SHARE`,
        [req.body.departureId, tenantId, parcel.rows[0].origin, parcel.rows[0].destination]
      ),
      client.query("SELECT id, role FROM users WHERE id = $1 AND tenant_id = $2", [req.body.driverUserId, tenantId])
    ]);
    if (!departure.rowCount) { await client.query("ROLLBACK"); return res.status(409).json({ success: false, message: "Le départ doit correspondre au trajet du colis et être planifié" }); }
    if (!driver.rowCount || !hasRole(driver.rows[0].role, ["chauffeur"])) {
      await client.query("ROLLBACK");
      return res.status(400).json({ success: false, message: "Le compte affecté doit avoir le rôle chauffeur" });
    }
    await client.query(
      `UPDATE courier_parcels SET departure_id = $3, assigned_driver_user_id = $4,
         assigned_by = $5, assigned_at = NOW(), status = 'AFFECTE', updated_at = NOW()
       WHERE id = $1 AND tenant_id = $2`,
      [req.params.id, tenantId, req.body.departureId, req.body.driverUserId, req.user.id]
    );
    await addEvent(client, tenantId, req.params.id, req.user.id, "AFFECTE", "Courrier affecté à un départ et à un chauffeur", req.body.departureId);
    await client.query("COMMIT");
    return res.json({ success: true, message: "Courrier affecté au voyage et au chauffeur" });
  } catch (error) {
    await client.query("ROLLBACK");
    return next(error);
  } finally { client.release(); }
});

router.patch("/colis/:id/prise-en-charge", driverOnly, [param("id").isUUID()], validate,
  async (req: Request, res: Response, next: NextFunction) => {
    const tenantId = tenant(req, res);
    if (!tenantId || !req.user) return;
    try {
      const result = await pool.query(
        `UPDATE courier_parcels SET status = 'CONFIE_CHAUFFEUR', updated_at = NOW()
         WHERE id = $1 AND tenant_id = $2 AND assigned_driver_user_id = $3 AND status = 'AFFECTE'
         RETURNING id, departure_id`,
        [req.params.id, tenantId, req.user.id]
      );
      if (!result.rowCount) return res.status(409).json({ success: false, message: "Courrier non affecté à ce chauffeur ou déjà pris en charge" });
      await pool.query(
        `INSERT INTO courier_events (tenant_id, parcel_id, actor_user_id, event_type, notes, departure_id)
         VALUES ($1, $2, $3, 'CONFIE_CHAUFFEUR', 'Prise en charge confirmée par le chauffeur', $4)`,
        [tenantId, req.params.id, req.user.id, result.rows[0].departure_id]
      );
      return res.json({ success: true, message: "Prise en charge du courrier confirmée" });
    } catch (error) { return next(error); }
  }
);

router.patch("/colis/:id/en-transit", driverOnly, [param("id").isUUID()], validate,
  async (req: Request, res: Response, next: NextFunction) => {
    const tenantId = tenant(req, res);
    if (!tenantId || !req.user) return;
    try {
      const result = await pool.query(
        `UPDATE courier_parcels SET status = 'EN_TRANSIT', updated_at = NOW()
         WHERE id = $1 AND tenant_id = $2 AND assigned_driver_user_id = $3 AND status = 'CONFIE_CHAUFFEUR'
         RETURNING id, departure_id`,
        [req.params.id, tenantId, req.user.id]
      );
      if (!result.rowCount) return res.status(409).json({ success: false, message: "Le courrier doit d'abord être pris en charge par ce chauffeur" });
      await pool.query(
        `INSERT INTO courier_events (tenant_id, parcel_id, actor_user_id, event_type, notes, departure_id)
         VALUES ($1, $2, $3, 'EN_TRANSIT', 'Départ du courrier confirmé', $4)`,
        [tenantId, req.params.id, req.user.id, result.rows[0].departure_id]
      );
      return res.json({ success: true, message: "Courrier déclaré en transit" });
    } catch (error) { return next(error); }
  }
);

router.patch("/colis/:id/arrivee", stationCourier, [param("id").isUUID()], validate,
  async (req: Request, res: Response, next: NextFunction) => {
    const tenantId = tenant(req, res);
    if (!tenantId || !req.user) return;
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const parcel = await client.query(
        `UPDATE courier_parcels SET status = 'ARRIVE', arrival_confirmed_by = $3,
           arrival_at = NOW(), updated_at = NOW()
         WHERE id = $1 AND tenant_id = $2 AND status = 'EN_TRANSIT'
         RETURNING id, departure_id`,
        [req.params.id, tenantId, req.user.id]
      );
      if (!parcel.rowCount) { await client.query("ROLLBACK"); return res.status(409).json({ success: false, message: "Seul un courrier en transit peut être réceptionné" }); }
      await addEvent(client, tenantId, req.params.id, req.user.id, "ARRIVE", "Courrier réceptionné à la gare de destination", parcel.rows[0].departure_id);
      await client.query("COMMIT");
      return res.json({ success: true, message: "Arrivée du courrier confirmée à la gare" });
    } catch (error) { await client.query("ROLLBACK"); return next(error); }
    finally { client.release(); }
  }
);

router.patch("/colis/:id/remise", stationCourier, [
  param("id").isUUID(),
  body("receiverName").isString().trim().isLength({ min: 2, max: 160 }),
  body("receiverReference").optional().isString().trim().isLength({ max: 120 })
], validate, async (req: Request, res: Response, next: NextFunction) => {
  const tenantId = tenant(req, res);
  if (!tenantId || !req.user) return;
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await client.query(
      `UPDATE courier_parcels SET status = 'REMIS', receiver_name = $3,
         receiver_reference = $4, delivered_by = $5, delivered_at = NOW(), updated_at = NOW()
       WHERE id = $1 AND tenant_id = $2 AND status = 'ARRIVE'
       RETURNING id, tracking_code`,
      [req.params.id, tenantId, String(req.body.receiverName).trim(), req.body.receiverReference ?? null, req.user.id]
    );
    if (!result.rowCount) { await client.query("ROLLBACK"); return res.status(409).json({ success: false, message: "Le courrier doit être réceptionné à destination avant sa remise" }); }
    await addEvent(client, tenantId, req.params.id, req.user.id, "REMIS", `Remis à ${String(req.body.receiverName).trim()}`);
    await client.query("COMMIT");
    return res.json({ success: true, data: result.rows[0], message: "Remise au destinataire enregistrée" });
  } catch (error) { await client.query("ROLLBACK"); return next(error); }
  finally { client.release(); }
});

router.get("/colis/:id", courierReaders, [param("id").isUUID()], validate,
  async (req: Request, res: Response, next: NextFunction) => {
    const tenantId = tenant(req, res);
    if (!tenantId) return;
    try {
      const result = await pool.query(`${parcelSelect} WHERE id = $1 AND tenant_id = $2`, [req.params.id, tenantId]);
      if (!result.rowCount) return res.status(404).json({ success: false, message: "Courrier introuvable" });
      return res.json({ success: true, data: result.rows[0] });
    } catch (error) { return next(error); }
  }
);

export default router;
