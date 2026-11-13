CREATE TABLE IF NOT EXISTS financial_operations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants (id) ON DELETE CASCADE,
  type TEXT NOT NULL
    CHECK (type IN ('revenu', 'dépense', 'remboursement', 'commission', 'frais_transora')),
  amount_fcfa BIGINT NOT NULL CHECK (amount_fcfa >= 0),
  category TEXT NOT NULL DEFAULT 'générale',
  description TEXT NOT NULL DEFAULT '',
  reference TEXT,
  recorded_by UUID REFERENCES users (id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS financial_operations_tenant_created_idx
  ON financial_operations (tenant_id, created_at DESC);

CREATE TABLE IF NOT EXISTS audit_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants (id) ON DELETE CASCADE,
  actor_user_id UUID REFERENCES users (id) ON DELETE SET NULL,
  type TEXT NOT NULL
    CHECK (type IN ('création', 'modification', 'suppression', 'connexion', 'déconnexion', 'transfert', 'paiement')),
  subject TEXT NOT NULL,
  action TEXT NOT NULL,
  details JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS audit_events_tenant_created_idx
  ON audit_events (tenant_id, created_at DESC);
