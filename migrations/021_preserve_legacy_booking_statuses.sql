-- Preserve legacy ticket/payment states while adding temporary holds and expiry.
-- Older deployed clients may still use ISSUED, BOARDED, USED, REFUNDED or NO_SHOW.
ALTER TABLE bookings
  DROP CONSTRAINT IF EXISTS bookings_status_check;

ALTER TABLE bookings
  ADD CONSTRAINT bookings_status_check
  CHECK (status IN ('RESERVED', 'HELD', 'PAID', 'ISSUED', 'BOARDED', 'USED', 'CANCELLED', 'REFUNDED', 'NO_SHOW', 'EXPIRED'));
