-- Add the range column for fresh installs whose baseline predates segment-aware bookings.
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS segment_range int4range;

-- Ensure GiST can compare departure and seat keys alongside range overlap.
CREATE EXTENSION IF NOT EXISTS btree_gist;

-- Ensure every ticket occupies an explicit route range.
-- This makes the GiST exclusion constraint effective and allows a seat to be reused
-- only for non-overlapping route segments in a later segment-aware booking flow.
UPDATE bookings
SET segment_range = '[0,)'::int4range
WHERE segment_range IS NULL;

ALTER TABLE bookings
  ALTER COLUMN segment_range SET DEFAULT '[0,)'::int4range,
  ALTER COLUMN segment_range SET NOT NULL;

-- Ensure the range-aware exclusion constraint exists on every supported database.
DO $transora$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid = 'public.bookings'::regclass
      AND contype = 'x'
      AND pg_get_constraintdef(oid) ILIKE '%segment_range%'
  ) THEN
    ALTER TABLE public.bookings
      ADD CONSTRAINT bookings_seat_segment_no_overlap
      EXCLUDE USING gist (departure_id WITH =, seat_number WITH =, segment_range WITH &&)
      WHERE (status <> 'CANCELLED');
  END IF;
END $transora$;

-- The old whole-departure unique index prevented safe reuse of a seat on disjoint segments.
-- The range-aware exclusion constraint is now authoritative.
DROP INDEX IF EXISTS bookings_departure_seat_active_unique;
