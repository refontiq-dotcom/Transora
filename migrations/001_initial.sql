CREATE TABLE IF NOT EXISTS tenants (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  siret TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS tenants_siret_unique
  ON tenants (siret)
  WHERE siret IS NOT NULL;

CREATE TABLE IF NOT EXISTS users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants (id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'administrateur',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS departures (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants (id) ON DELETE CASCADE,
  origin TEXT NOT NULL,
  destination TEXT NOT NULL,
  departure_at TIMESTAMPTZ NOT NULL,
  vehicle_code TEXT NOT NULL,
  capacity INTEGER NOT NULL CHECK (capacity > 0),
  status TEXT NOT NULL DEFAULT 'SCHEDULED',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS departures_tenant_date_idx
  ON departures (tenant_id, departure_at);

CREATE TABLE IF NOT EXISTS bookings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants (id) ON DELETE CASCADE,
  departure_id UUID NOT NULL REFERENCES departures (id) ON DELETE CASCADE,
  passenger_name TEXT NOT NULL,
  amount_transport INTEGER NOT NULL CHECK (amount_transport >= 0),
  platform_fee INTEGER NOT NULL DEFAULT 100 CHECK (platform_fee >= 0),
  status TEXT NOT NULL DEFAULT 'RESERVED'
    CHECK (status IN ('RESERVED', 'PAID', 'CANCELLED')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS bookings_tenant_created_idx
  ON bookings (tenant_id, created_at);

CREATE INDEX IF NOT EXISTS bookings_departure_status_idx
  ON bookings (departure_id, status);

CREATE TABLE IF NOT EXISTS payments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants (id) ON DELETE CASCADE,
  booking_id UUID NOT NULL UNIQUE REFERENCES bookings (id) ON DELETE CASCADE,
  amount_transport INTEGER NOT NULL CHECK (amount_transport >= 0),
  platform_fee INTEGER NOT NULL CHECK (platform_fee >= 0),
  payment_method TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'PENDING'
    CHECK (status IN ('PENDING', 'CONFIRMED', 'CANCELLED')),
  proof TEXT,
  confirmed_by UUID REFERENCES users (id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  confirmed_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS payments_tenant_date_idx
  ON payments (tenant_id, created_at);
