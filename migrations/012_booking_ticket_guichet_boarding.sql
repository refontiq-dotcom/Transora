-- Réservations, billets, guichet et embarquement multi-entreprises.
-- Les opérations restent toujours rattachées au tenant authentifié côté API.
ALTER TABLE departures
  ADD COLUMN IF NOT EXISTS fare_amount INTEGER NOT NULL DEFAULT 0
  CHECK (fare_amount >= 0);

ALTER TABLE bookings
  ADD COLUMN IF NOT EXISTS seat_number INTEGER
  CHECK (seat_number IS NULL OR seat_number > 0),
  ADD COLUMN IF NOT EXISTS ticket_token UUID NOT NULL DEFAULT gen_random_uuid();

CREATE UNIQUE INDEX IF NOT EXISTS bookings_ticket_token_unique
  ON bookings (ticket_token);

CREATE UNIQUE INDEX IF NOT EXISTS departures_id_tenant_unique
  ON departures (id, tenant_id);

CREATE UNIQUE INDEX IF NOT EXISTS bookings_id_tenant_unique
  ON bookings (id, tenant_id);

CREATE UNIQUE INDEX IF NOT EXISTS bookings_departure_seat_active_unique
  ON bookings (departure_id, seat_number)
  WHERE seat_number IS NOT NULL AND status <> 'CANCELLED';

CREATE TABLE IF NOT EXISTS guichet_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  opened_by UUID NOT NULL,
  closed_by UUID,
  opening_amount BIGINT NOT NULL CHECK (opening_amount >= 0),
  closing_amount BIGINT CHECK (closing_amount IS NULL OR closing_amount >= 0),
  currency TEXT NOT NULL DEFAULT 'FCFA' CHECK (currency = 'FCFA'),
  status TEXT NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN', 'CLOSED')),
  opened_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  closed_at TIMESTAMPTZ,
  CONSTRAINT guichet_sessions_opened_by_tenant_fk
    FOREIGN KEY (opened_by, tenant_id) REFERENCES users(id, tenant_id),
  CONSTRAINT guichet_sessions_closed_by_tenant_fk
    FOREIGN KEY (closed_by, tenant_id) REFERENCES users(id, tenant_id),
  CONSTRAINT guichet_sessions_close_state_check CHECK (
    (status = 'OPEN' AND closed_at IS NULL AND closing_amount IS NULL) OR
    (status = 'CLOSED' AND closed_at IS NOT NULL AND closing_amount IS NOT NULL)
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS guichet_sessions_id_tenant_unique
  ON guichet_sessions (id, tenant_id);

CREATE UNIQUE INDEX IF NOT EXISTS guichet_one_open_session_per_agent
  ON guichet_sessions (tenant_id, opened_by) WHERE status = 'OPEN';

CREATE INDEX IF NOT EXISTS guichet_sessions_tenant_opened_idx
  ON guichet_sessions (tenant_id, opened_at DESC);

CREATE TABLE IF NOT EXISTS guichet_operations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  session_id UUID NOT NULL,
  booking_id UUID,
  type TEXT NOT NULL CHECK (type IN ('OPENING', 'SALE', 'REFUND', 'CLOSING', 'ADJUSTMENT')),
  amount BIGINT NOT NULL CHECK (amount >= 0),
  payment_method TEXT NOT NULL DEFAULT 'cash' CHECK (payment_method = 'cash'),
  description TEXT NOT NULL DEFAULT '',
  recorded_by UUID NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT guichet_operations_session_tenant_fk
    FOREIGN KEY (session_id, tenant_id) REFERENCES guichet_sessions(id, tenant_id) ON DELETE RESTRICT,
  CONSTRAINT guichet_operations_booking_tenant_fk
    FOREIGN KEY (booking_id, tenant_id) REFERENCES bookings(id, tenant_id),
  CONSTRAINT guichet_operations_recorded_by_tenant_fk
    FOREIGN KEY (recorded_by, tenant_id) REFERENCES users(id, tenant_id)
);

CREATE INDEX IF NOT EXISTS guichet_operations_session_created_idx
  ON guichet_operations (session_id, created_at);

CREATE INDEX IF NOT EXISTS guichet_operations_tenant_created_idx
  ON guichet_operations (tenant_id, created_at DESC);

CREATE TABLE IF NOT EXISTS boarding_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  booking_id UUID NOT NULL,
  departure_id UUID NOT NULL,
  boarded_by UUID NOT NULL,
  scanner_id TEXT,
  comments TEXT,
  boarded_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT boarding_events_booking_tenant_fk
    FOREIGN KEY (booking_id, tenant_id) REFERENCES bookings(id, tenant_id) ON DELETE CASCADE,
  CONSTRAINT boarding_events_boarded_by_tenant_fk
    FOREIGN KEY (boarded_by, tenant_id) REFERENCES users(id, tenant_id),
  CONSTRAINT boarding_events_departure_tenant_fk
    FOREIGN KEY (departure_id, tenant_id) REFERENCES departures(id, tenant_id) ON DELETE CASCADE,
  CONSTRAINT boarding_events_booking_once UNIQUE (booking_id)
);

CREATE INDEX IF NOT EXISTS boarding_events_tenant_date_idx
  ON boarding_events (tenant_id, boarded_at DESC);

CREATE INDEX IF NOT EXISTS boarding_events_departure_idx
  ON boarding_events (tenant_id, departure_id, boarded_at);
