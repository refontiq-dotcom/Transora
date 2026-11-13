CREATE TABLE IF NOT EXISTS vehicles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants (id) ON DELETE CASCADE,
  registration TEXT NOT NULL,
  model TEXT NOT NULL,
  capacity INTEGER NOT NULL CHECK (capacity > 0),
  manufacture_year INTEGER CHECK (manufacture_year BETWEEN 1900 AND 2100),
  status TEXT NOT NULL DEFAULT 'disponible'
    CHECK (status IN ('disponible', 'en_service', 'en_maintenance', 'hors_service')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at TIMESTAMPTZ,
  UNIQUE (tenant_id, registration)
);

CREATE TABLE IF NOT EXISTS employees (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants (id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  position TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'conducteur'
    CHECK (role IN ('conducteur', 'mécanicien', 'agent_acceuil', 'superviseur', 'administrateur')),
  phone TEXT,
  email TEXT,
  hire_date DATE,
  status TEXT NOT NULL DEFAULT 'actif' CHECK (status IN ('actif', 'inactif')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at TIMESTAMPTZ,
  UNIQUE (tenant_id, email)
);

CREATE INDEX IF NOT EXISTS employees_tenant_role_idx ON employees (tenant_id, role)
  WHERE deleted_at IS NULL;

CREATE TABLE IF NOT EXISTS incidents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants (id) ON DELETE CASCADE,
  type TEXT NOT NULL CHECK (
    type IN ('panne', 'accident', 'retard', 'absence_chauffeur', 'probleme_passager',
             'bagage', 'billet', 'paiement', 'caisse')
  ),
  description TEXT NOT NULL,
  severity TEXT NOT NULL DEFAULT 'moyenne'
    CHECK (severity IN ('faible', 'moyenne', 'eleve', 'critique')),
  status TEXT NOT NULL DEFAULT 'OUVERT'
    CHECK (status IN ('OUVERT', 'EN_COURS', 'RESOLU', 'CLOTURÉ')),
  vehicle_id UUID REFERENCES vehicles (id) ON DELETE SET NULL,
  departure_id UUID REFERENCES departures (id) ON DELETE SET NULL,
  reported_by UUID REFERENCES users (id) ON DELETE SET NULL,
  resolution_comments TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  resolved_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS incidents_tenant_status_created_idx
  ON incidents (tenant_id, status, created_at DESC);

CREATE TABLE IF NOT EXISTS notifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants (id) ON DELETE CASCADE,
  type TEXT NOT NULL
    CHECK (type IN ('confirmation', 'rappel', 'retard', 'annulation', 'correspondance', 'incident', 'paiement')),
  recipient TEXT NOT NULL
    CHECK (recipient IN ('passager', 'employé', 'direction', 'guichetier', 'controleur')),
  content TEXT NOT NULL,
  channel TEXT NOT NULL CHECK (channel IN ('sms', 'whatsapp', 'email', 'push')),
  reference_id TEXT,
  status TEXT NOT NULL DEFAULT 'EN_ATTENTE'
    CHECK (status IN ('EN_ATTENTE', 'ENVOYÉ', 'ECHEC')),
  is_read BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  sent_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS notifications_tenant_created_idx
  ON notifications (tenant_id, created_at DESC);
