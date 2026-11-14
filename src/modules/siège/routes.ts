import { NextFunction, Request, Response, Router } from "express";
import { body, query, validationResult } from "express-validator";
import { PoolClient } from "pg";
import { pool } from "../../db/pool";

const router = Router();
const validate = (req: Request, res: Response, next: NextFunction) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ success: false, message: "Données invalides", errors: errors.array() });
  next();
};

router.get("/availability", [
  query("trajetId").isUUID().withMessage("L'identifiant du départ est requis")
], validate, async (req: Request, res: Response, next: NextFunction) => {
  if (!req.tenantId) return res.status(401).json({ success: false, message: "Tenant non identifié" });
  try {
    const departure = await pool.query(
      "SELECT id, capacity FROM departures WHERE id = $1 AND tenant_id = $2",
      [req.query.trajetId, req.tenantId]
    );
    if (!departure.rowCount) return res.status(404).json({ success: false, message: "Départ introuvable dans cette compagnie" });
    const occupied = await pool.query(
      "SELECT seat_number FROM bookings WHERE departure_id = $1 AND tenant_id = $2 AND status <> 'CANCELLED' AND seat_number IS NOT NULL",
      [req.query.trajetId, req.tenantId]
    );
    const taken = new Set(occupied.rows.map((row: { seat_number: number }) => Number(row.seat_number)));
    const seats = Array.from({ length: Number(departure.rows[0].capacity) }, (_, index) => ({
      numero: index + 1, statut: taken.has(index + 1) ? "RESERVE" : "DISPONIBLE"
    }));
    return res.json({ success: true, data: {
      departureId: departure.rows[0].id, capaciteTotale: seats.length,
      siegesReserves: taken.size, siegesDisponibles: seats.length - taken.size, detail: seats
    } });
  } catch (error) { return next(error); }
});

router.post("/réserver", [
  body("billetId").isUUID(),
  body("siègeNuméro").isInt({ min: 1 })
], validate, async (req: Request, res: Response, next: NextFunction) => {
  if (!req.tenantId) return res.status(401).json({ success: false, message: "Tenant non identifié" });
  const client: PoolClient = await pool.connect();
  try {
    await client.query("BEGIN");
    const booking = await client.query(
      `SELECT b.id, b.departure_id, d.capacity
       FROM bookings b JOIN departures d ON d.id = b.departure_id AND d.tenant_id = b.tenant_id
       WHERE b.id = $1 AND b.tenant_id = $2 AND b.status <> 'CANCELLED'
       FOR UPDATE OF b`,
      [req.body.billetId, req.tenantId]
    );
    if (!booking.rowCount) { await client.query("ROLLBACK"); return res.status(404).json({ success: false, message: "Réservation introuvable dans cette compagnie" }); }
    const seat = Number(req.body.siègeNuméro);
    if (seat > Number(booking.rows[0].capacity)) {
      await client.query("ROLLBACK"); return res.status(400).json({ success: false, message: "Ce numéro de siège dépasse la capacité du véhicule" });
    }
    const departureLock = await client.query(
      "SELECT id FROM departures WHERE id = $1 AND tenant_id = $2 FOR UPDATE",
      [booking.rows[0].departure_id, req.tenantId]
    );
    if (!departureLock.rowCount) { await client.query("ROLLBACK"); return res.status(404).json({ success: false, message: "Départ introuvable" }); }
    const updated = await client.query(
      "UPDATE bookings SET seat_number = $3 WHERE id = $1 AND tenant_id = $2 RETURNING id, seat_number AS \"seatNumber\"",
      [req.body.billetId, req.tenantId, seat]
    );
    await client.query("COMMIT");
    return res.json({ success: true, data: updated.rows[0], message: "Siège attribué" });
  } catch (error) {
    await client.query("ROLLBACK");
    if ((error as { code?: string }).code === "23505") return res.status(409).json({ success: false, message: "Ce siège est déjà réservé pour ce départ" });
    return next(error);
  } finally { client.release(); }
});

export default router;
