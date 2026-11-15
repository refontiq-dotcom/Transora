-- Socle de paiement multi-compagnies.
-- Aucun prestataire n'est activé par défaut et aucun secret n'est stocké en clair.
CREATE TABLE IF NOT EXISTS tenant_payment_settings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  provider TEXT NOT NULL CHECK (provider IN ('orange_money', 'mtn_momo', 'moov_money', 'wave', 'card', 'bank_transfer')),
  environment TEXT NOT NULL DEFAULT 'sandbox' CHECK (environment IN ('sandbox', 'live')),
  merchant_account_ref TEXT,
  enabled BOOLEAN NOT NULL DEFAULT FALSE,
  allowed_methods TEXT[] NOT NULL DEFAULT '{}',
  credentials_ciphertext BYTEA,
  credentials_key_version SMALLINT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT tenant_payment_settings_credentials_pair_check CHECK (
    (credentials_ciphertext IS NULL AND credentials_key_version IS NULL) OR
    (credentials_ciphertext IS NOT NULL AND credentials_key_version IS NOT NULL)
  ),
  CONSTRAINT tenant_payment_settings_live_requires_credentials_check CHECK (
    enabled = FALSE OR (credentials_ciphertext IS NOT NULL AND merchant_account_ref IS NOT NULL)
  ),
  CONSTRAINT tenant_payment_settings_provider_unique UNIQUE (tenant_id, provider),
  CONSTRAINT tenant_payment_settings_id_tenant_unique UNIQUE (id, tenant_id)
);

CREATE INDEX IF NOT EXISTS tenant_payment_settings_tenant_enabled_idx
  ON tenant_payment_settings (tenant_id, enabled);

CREATE TABLE IF NOT EXISTS payment_attempts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  booking_id UUID NOT NULL,
  payment_setting_id UUID,
  provider TEXT NOT NULL CHECK (provider IN ('orange_money', 'mtn_momo', 'moov_money', 'wave', 'card', 'bank_transfer')),
  payment_method TEXT NOT NULL CHECK (payment_method IN ('orange_money', 'mtn_momo', 'moov_money', 'wave', 'card', 'bank_transfer')),
  amount_transport BIGINT NOT NULL CHECK (amount_transport >= 0),
  company_booking_fee BIGINT NOT NULL DEFAULT 0 CHECK (company_booking_fee >= 0),
  platform_fee BIGINT NOT NULL DEFAULT 0 CHECK (platform_fee >= 0),
  currency TEXT NOT NULL DEFAULT 'XOF' CHECK (currency = 'XOF'),
  status TEXT NOT NULL DEFAULT 'PENDING'
    CHECK (status IN ('PENDING', 'PROCESSING', 'SUCCEEDED', 'FAILED', 'CANCELLED', 'EXPIRED', 'REFUNDED')),
  idempotency_key TEXT NOT NULL CHECK (length(idempotency_key) BETWEEN 16 AND 200),
  provider_reference TEXT,
  checkout_url TEXT,
  failure_code TEXT,
  failure_message TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  confirmed_at TIMESTAMPTZ,
  refunded_at TIMESTAMPTZ,
  CONSTRAINT payment_attempts_booking_tenant_fk
    FOREIGN KEY (booking_id, tenant_id) REFERENCES bookings(id, tenant_id) ON DELETE CASCADE,
  CONSTRAINT payment_attempts_setting_tenant_fk
    FOREIGN KEY (payment_setting_id, tenant_id) REFERENCES tenant_payment_settings(id, tenant_id) ON DELETE RESTRICT,
  CONSTRAINT payment_attempts_idempotency_unique UNIQUE (tenant_id, idempotency_key),
  CONSTRAINT payment_attempts_id_tenant_unique UNIQUE (id, tenant_id)
);

CREATE UNIQUE INDEX IF NOT EXISTS payment_attempts_provider_reference_unique
  ON payment_attempts (provider, provider_reference)
  WHERE provider_reference IS NOT NULL;

CREATE INDEX IF NOT EXISTS payment_attempts_tenant_booking_created_idx
  ON payment_attempts (tenant_id, booking_id, created_at DESC);

CREATE INDEX IF NOT EXISTS payment_attempts_tenant_status_created_idx
  ON payment_attempts (tenant_id, status, created_at DESC);

-- Journal minimal des notifications prestataires : on conserve une empreinte,
-- jamais le corps brut qui pourrait contenir des données personnelles ou sensibles.
CREATE TABLE IF NOT EXISTS payment_webhook_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  provider TEXT NOT NULL CHECK (provider IN ('orange_money', 'mtn_momo', 'moov_money', 'wave', 'card', 'bank_transfer')),
  provider_event_id TEXT NOT NULL CHECK (length(provider_event_id) BETWEEN 1 AND 200),
  payload_sha256 CHAR(64) NOT NULL CHECK (payload_sha256 ~ '^[0-9a-f]{64}$'),
  signature_verified BOOLEAN NOT NULL DEFAULT FALSE,
  processing_status TEXT NOT NULL DEFAULT 'RECEIVED'
    CHECK (processing_status IN ('RECEIVED', 'PROCESSED', 'REJECTED', 'FAILED')),
  received_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  processed_at TIMESTAMPTZ,
  CONSTRAINT payment_webhook_events_provider_event_unique UNIQUE (tenant_id, provider, provider_event_id)
);

CREATE INDEX IF NOT EXISTS payment_webhook_events_tenant_received_idx
  ON payment_webhook_events (tenant_id, received_at DESC);
