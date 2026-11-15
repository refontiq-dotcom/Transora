-- Suivi opérationnel des descentes réelles à chaque arrêt.
-- Une réservation prévue à un arrêt ne libère pas physiquement le siège tant
-- que le contrôleur n'a pas confirmé la descente du passager déjà embarqué.
CREATE TABLE IF NOT EXISTS alighting_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  booking_id UUID NOT NULL,
  departure_id UUID NOT NULL,
  stop_id UUID NOT NULL,
  alighted_by UUID NOT NULL,
  comments TEXT,
  alighted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT alighting_events_booking_tenant_fk
    FOREIGN KEY (booking_id, tenant_id) REFERENCES bookings(id, tenant_id) ON DELETE CASCADE,
  CONSTRAINT alighting_events_departure_tenant_fk
    FOREIGN KEY (departure_id, tenant_id) REFERENCES departures(id, tenant_id) ON DELETE CASCADE,
  CONSTRAINT alighting_events_stop_tenant_fk
    FOREIGN KEY (tenant_id, stop_id) REFERENCES route_stops(tenant_id, id) ON DELETE RESTRICT,
  CONSTRAINT alighting_events_actor_tenant_fk
    FOREIGN KEY (alighted_by, tenant_id) REFERENCES users(id, tenant_id),
  CONSTRAINT alighting_events_booking_once UNIQUE (booking_id)
);

CREATE INDEX IF NOT EXISTS alighting_events_departure_stop_idx
  ON alighting_events (tenant_id, departure_id, stop_id, alighted_at DESC);

ALTER TABLE alighting_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE alighting_events FROM PUBLIC;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    REVOKE ALL ON TABLE alighting_events FROM anon;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    REVOKE ALL ON TABLE alighting_events FROM authenticated;
  END IF;
END $$;
