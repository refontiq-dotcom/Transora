-- Migration 008: enforce allowed departure lifecycle states.
-- Keep this list aligned with the API validation in src/modules/voyage/routes.ts.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'departures_status_check'
      AND conrelid = 'departures'::regclass
  ) THEN
    ALTER TABLE departures
      ADD CONSTRAINT departures_status_check
      CHECK (status IN ('SCHEDULED', 'BOARDING', 'DEPARTED', 'CANCELLED'));
  END IF;
END $$;
