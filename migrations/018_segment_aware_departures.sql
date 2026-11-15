-- Lier les départs et billets au réseau de la compagnie sans réécrire l'historique.
ALTER TABLE route_stops
  ADD CONSTRAINT route_stops_tenant_id_unique UNIQUE (tenant_id, id);

ALTER TABLE departures
  ADD COLUMN IF NOT EXISTS route_id UUID;

ALTER TABLE departures
  ADD CONSTRAINT departures_route_same_tenant_fk
  FOREIGN KEY (tenant_id, route_id)
  REFERENCES transport_routes (tenant_id, id)
  ON DELETE RESTRICT;

ALTER TABLE bookings
  ADD COLUMN IF NOT EXISTS origin_stop_id UUID,
  ADD COLUMN IF NOT EXISTS destination_stop_id UUID;

ALTER TABLE bookings
  ADD CONSTRAINT bookings_origin_stop_same_tenant_fk
  FOREIGN KEY (tenant_id, origin_stop_id)
  REFERENCES route_stops (tenant_id, id)
  ON DELETE RESTRICT,
  ADD CONSTRAINT bookings_destination_stop_same_tenant_fk
  FOREIGN KEY (tenant_id, destination_stop_id)
  REFERENCES route_stops (tenant_id, id)
  ON DELETE RESTRICT,
  ADD CONSTRAINT bookings_segment_stops_pair_check
  CHECK (
    (origin_stop_id IS NULL AND destination_stop_id IS NULL)
    OR (origin_stop_id IS NOT NULL AND destination_stop_id IS NOT NULL AND origin_stop_id <> destination_stop_id)
  );

CREATE INDEX IF NOT EXISTS departures_tenant_route_date_idx
  ON departures (tenant_id, route_id, departure_at);
CREATE INDEX IF NOT EXISTS bookings_departure_segment_idx
  ON bookings (tenant_id, departure_id, segment_range)
  WHERE status <> 'CANCELLED';
