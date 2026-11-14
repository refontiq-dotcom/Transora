-- Ensure every ticket occupies an explicit route range.
-- This makes the GiST exclusion constraint effective and allows a seat to be reused
-- only for non-overlapping route segments in a later segment-aware booking flow.
UPDATE bookings
SET segment_range = '[0,)'::int4range
WHERE segment_range IS NULL;

ALTER TABLE bookings
  ALTER COLUMN segment_range SET DEFAULT '[0,)'::int4range,
  ALTER COLUMN segment_range SET NOT NULL;

-- The old whole-departure unique index prevented safe reuse of a seat on disjoint segments.
-- The existing EXCLUDE constraint (departure_id, seat_number, segment_range) is now authoritative.
DROP INDEX IF EXISTS bookings_departure_seat_active_unique;
