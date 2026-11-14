-- Tarifs commerciaux propres à chaque compagnie.
-- Les montants des départs et réservations restent des instantanés historiques.
CREATE TABLE IF NOT EXISTS company_route_tariffs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants (id) ON DELETE CASCADE,
  origin TEXT NOT NULL CHECK (length(btrim(origin)) BETWEEN 2 AND 100),
  destination TEXT NOT NULL CHECK (length(btrim(destination)) BETWEEN 2 AND 100),
  fare_amount INTEGER NOT NULL CHECK (fare_amount > 0),
  company_booking_fee INTEGER NOT NULL DEFAULT 0 CHECK (company_booking_fee >= 0),
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT company_route_tariffs_distinct_cities
    CHECK (lower(regexp_replace(btrim(origin), '\\s+', ' ', 'g')) <>
           lower(regexp_replace(btrim(destination), '\\s+', ' ', 'g')))
);

CREATE UNIQUE INDEX IF NOT EXISTS company_route_tariffs_route_unique
  ON company_route_tariffs (
    tenant_id,
    lower(regexp_replace(btrim(origin), '\\s+', ' ', 'g')),
    lower(regexp_replace(btrim(destination), '\\s+', ' ', 'g'))
  );

CREATE INDEX IF NOT EXISTS company_route_tariffs_tenant_active_idx
  ON company_route_tariffs (tenant_id, is_active, origin, destination);

ALTER TABLE departures
  ADD COLUMN IF NOT EXISTS company_booking_fee INTEGER NOT NULL DEFAULT 0
    CHECK (company_booking_fee >= 0),
  ADD COLUMN IF NOT EXISTS route_tariff_id UUID
    REFERENCES company_route_tariffs (id) ON DELETE SET NULL;

ALTER TABLE bookings
  ADD COLUMN IF NOT EXISTS company_booking_fee INTEGER NOT NULL DEFAULT 0
    CHECK (company_booking_fee >= 0);

ALTER TABLE payments
  ADD COLUMN IF NOT EXISTS company_booking_fee INTEGER NOT NULL DEFAULT 0
    CHECK (company_booking_fee >= 0);

CREATE INDEX IF NOT EXISTS departures_route_tariff_idx
  ON departures (tenant_id, route_tariff_id);
