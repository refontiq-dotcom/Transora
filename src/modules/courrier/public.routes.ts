/**
 * Suivi public d'un courrier par son code non devinable.
 * Aucune donnée personnelle de l'expéditeur ou du destinataire n'est exposée.
 */
import { NextFunction, Request, Response, Router } from "express";
import { param, validationResult } from "express-validator";
import { pool } from "../../db/pool";

const router = Router();

router.get("/:trackingCode", [
  param("trackingCode").isString().trim().isLength({ min: 8, max: 40 }).matches(/^TRC-[A-F0-9]+$/)
], (req: Request, res: Response, next: NextFunction) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ success: false, message: "Code de suivi invalide" });
  return next();
}, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const parcel = await pool.query(
      `SELECT tracking_code AS "trackingCode", origin, destination, status,
              created_at AS "registeredAt", paid_at AS "paidAt",
              assigned_at AS "assignedAt", arrival_at AS "arrivalAt",
              delivered_at AS "deliveredAt"
       FROM courier_parcels WHERE tracking_code = $1`,
      [req.params.trackingCode]
    );
    if (!parcel.rowCount) return res.status(404).json({ success: false, message: "Courrier introuvable" });
    const events = await pool.query(
      `SELECT event_type AS "eventType", created_at AS "createdAt"
       FROM courier_events WHERE parcel_id = (
         SELECT id FROM courier_parcels WHERE tracking_code = $1
       )
       ORDER BY created_at, id`,
      [req.params.trackingCode]
    );
    return res.json({ success: true, data: { parcel: parcel.rows[0], history: events.rows } });
  } catch (error) { return next(error); }
});

export default router;
