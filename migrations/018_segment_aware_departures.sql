-- Lier les départs et billets au réseau de la compagnie sans réécrire l'historique.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'route_stops_tenant_id_unique'
      AND conrelid = 'public.route_stops'::regclass
  ) THEN
    ALTER TABLE route_stops
      ADD CONSTRAINT route_stops_tenant_id_unique UNIQUE (tenant_id, id);
  END IF;
END $$;

ALTER TABLE departures
  ADD COLUMN IF NOT EXISTS route_id UUID;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'departures_route_same_tenant_fk'
      AND conrelid = 'public.departures'::regclass
  ) THEN
    ALTER TABLE departures
      ADD CONSTRAINT departures_route_same_tenant_fk
      FOREIGN KEY (tenant_id, route_id)
      REFERENCES transport_routes (tenant_id, id)
      ON DELETE RESTRICT;
  END IF;
END $$;

ALTER TABLE bookings
  ADD COLUMN IF NOT EXISTS origin_stop_id UUID,
  ADD COLUMN IF NOT EXISTS destination_stop_id UUID;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'bookings_origin_stop_same_tenant_fk'
      AND conrelid = 'public.bookings'::regclass
  ) THEN
    ALTER TABLE bookings
      ADD CONSTRAINT bookings_origin_stop_same_tenant_fk
      FOREIGN KEY (tenant_id, origin_stop_id)
      REFERENCES route_stops (tenant_id, id)
      ON DELETE RESTRICT;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'bookings_destination_stop_same_tenant_fk'
      AND conrelid = 'public.bookings'::regclass
  ) THEN
    ALTER TABLE bookings
      ADD CONSTRAINT bookings_destination_stop_same_tenant_fk
      FOREIGN KEY (tenant_id, destination_stop_id)
      REFERENCES route_stops (tenant_id, id)
      ON DELETE RESTRICT;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'bookings_segment_stops_pair_check'
      AND conrelid = 'public.bookings'::regclass
  ) THEN
    ALTER TABLE bookings
      ADD CONSTRAINT bookings_segment_stops_pair_check
      CHECK (
        (origin_stop_id IS NULL AND destination_stop_id IS NULL)
        OR (origin_stop_id IS NOT NULL AND destination_stop_id IS NOT NULL AND origin_stop_id <> destination_stop_id)
      );
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS departures_tenant_route_date_idx
  ON departures (tenant_id, route_id, departure_at);
CREATE INDEX IF NOT EXISTS bookings_departure_segment_idx
  ON bookings (tenant_id, departure_id, segment_range)
  WHERE status <> 'CANCELLED';
