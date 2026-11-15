-- Holds temporaires de réservation en ligne et protection du cycle de paiement.
-- La durée est volontairement centralisée ici pour rester cohérente entre les canaux.
ALTER TABLE bookings
  ADD COLUMN IF NOT EXISTS hold_expires_at TIMESTAMPTZ;

ALTER TABLE bookings
  DROP CONSTRAINT IF EXISTS bookings_status_check;

ALTER TABLE bookings
  ADD CONSTRAINT bookings_status_check
  CHECK (status IN ('RESERVED', 'HELD', 'PAID', 'ISSUED', 'BOARDED', 'USED', 'CANCELLED', 'REFUNDED', 'NO_SHOW', 'EXPIRED'));

ALTER TABLE bookings
  ADD CONSTRAINT bookings_hold_expiry_check
  CHECK (status <> 'HELD' OR hold_expires_at IS NOT NULL);

-- Les réservations expirées libèrent le siège ; les holds actifs continuent
-- de participer à l'exclusion de chevauchement par segment.
ALTER TABLE bookings
  DROP CONSTRAINT IF EXISTS bookings_seat_segment_no_overlap,
  DROP CONSTRAINT IF EXISTS exclude_overlapping_seats;

ALTER TABLE bookings
  ADD CONSTRAINT bookings_seat_segment_no_overlap
  EXCLUDE USING gist (departure_id WITH =, seat_number WITH =, segment_range WITH &&)
  WHERE (status NOT IN ('CANCELLED', 'EXPIRED'));

CREATE INDEX IF NOT EXISTS bookings_active_holds_expiry_idx
  ON bookings (departure_id, hold_expires_at)
  WHERE status = 'HELD';

-- Toute nouvelle réservation (publique, guichet ou agent) libère d'abord
-- les holds expirés du même départ, dans la transaction qui attribue le siège.
CREATE OR REPLACE FUNCTION transora_expire_holds_before_booking()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  UPDATE bookings
  SET status = 'EXPIRED', hold_expires_at = NULL
  WHERE departure_id = NEW.departure_id
    AND tenant_id = NEW.tenant_id
    AND status = 'HELD'
    AND hold_expires_at <= NOW();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS bookings_expire_holds_before_insert ON bookings;
CREATE TRIGGER bookings_expire_holds_before_insert
BEFORE INSERT ON bookings
FOR EACH ROW
EXECUTE FUNCTION transora_expire_holds_before_booking();
