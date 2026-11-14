-- Tarifs de transport définis par entreprise et appliqués côté serveur.
CREATE TABLE IF NOT EXISTS route_fares (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants (id) ON DELETE CASCADE,
  origin TEXT NOT NULL CHECK (length(btrim(origin)) BETWEEN 2 AND 100),
  destination TEXT NOT NULL CHECK (length(btrim(destination)) BETWEEN 2 AND 100),
  origin_key TEXT GENERATED ALWAYS AS (lower(btrim(origin))) STORED,
  destination_key TEXT GENERATED ALWAYS AS (lower(btrim(destination))) STORED,
  amount_fcfa BIGINT NOT NULL CHECK (amount_fcfa > 0 AND amount_fcfa <= 100000000),
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (origin_key <> destination_key),
  UNIQUE (tenant_id, origin_key, destination_key)
);

CREATE INDEX IF NOT EXISTS route_fares_tenant_active_idx
  ON route_fares (tenant_id, active);
