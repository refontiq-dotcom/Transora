-- RBAC métier et service courrier multi-tenant.
-- Les anciens identifiants de rôle restent acceptés pour ne pas bloquer les comptes existants.
ALTER TABLE users DROP CONSTRAINT IF EXISTS users_role_check;
ALTER TABLE users ADD CONSTRAINT users_role_check CHECK (role IN (
  'administrateur',
  'responsable_exploitation',
  'agent_guichet',
  'caissier',
  'responsable_financier',
  'responsable_logistique',
  'chauffeur',
  'controleur',
  'mécanicien',
  'agent_accueil',
  'responsable_courrier',
  'agent_courrier',
  'superviseur',
  'conducteur',
  'agent_acceuil'
));

DO $$
DECLARE constraint_name text;
BEGIN
  FOR constraint_name IN
    SELECT conname FROM pg_constraint
    WHERE conrelid = 'employees'::regclass
      AND contype = 'c'
      AND pg_get_constraintdef(oid) ILIKE '%role%'
  LOOP
    EXECUTE format('ALTER TABLE employees DROP CONSTRAINT %I', constraint_name);
  END LOOP;
  ALTER TABLE employees ADD CONSTRAINT employees_role_check CHECK (role IN (
    'administrateur',
    'responsable_exploitation',
    'agent_guichet',
    'caissier',
    'responsable_financier',
    'responsable_logistique',
    'chauffeur',
    'controleur',
    'mécanicien',
    'agent_accueil',
    'responsable_courrier',
    'agent_courrier',
    'superviseur',
    'conducteur',
    'agent_acceuil'
  ));
END $$;

CREATE TABLE IF NOT EXISTS courier_route_tariffs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  origin TEXT NOT NULL CHECK (length(btrim(origin)) BETWEEN 2 AND 100),
  destination TEXT NOT NULL CHECK (length(btrim(destination)) BETWEEN 2 AND 100),
  amount_fcfa BIGINT NOT NULL CHECK (amount_fcfa > 0),
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT courier_tariffs_distinct_stations CHECK (
    lower(regexp_replace(btrim(origin), '[[:space:]]+', ' ', 'g')) <>
    lower(regexp_replace(btrim(destination), '[[:space:]]+', ' ', 'g'))
  )
);
CREATE UNIQUE INDEX IF NOT EXISTS courier_route_tariffs_route_unique
  ON courier_route_tariffs (
    tenant_id,
    lower(regexp_replace(btrim(origin), '[[:space:]]+', ' ', 'g')),
    lower(regexp_replace(btrim(destination), '[[:space:]]+', ' ', 'g'))
  );
CREATE INDEX IF NOT EXISTS courier_route_tariffs_tenant_active_idx
  ON courier_route_tariffs (tenant_id, is_active);

CREATE TABLE IF NOT EXISTS courier_parcels (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  tracking_code TEXT NOT NULL,
  origin TEXT NOT NULL,
  destination TEXT NOT NULL,
  sender_name TEXT NOT NULL,
  sender_phone TEXT NOT NULL,
  recipient_name TEXT NOT NULL,
  recipient_phone TEXT NOT NULL,
  description TEXT NOT NULL,
  weight_kg NUMERIC(8,2) CHECK (weight_kg IS NULL OR weight_kg > 0),
  declared_value BIGINT NOT NULL DEFAULT 0 CHECK (declared_value >= 0),
  amount_fcfa BIGINT NOT NULL CHECK (amount_fcfa > 0),
  payment_status TEXT NOT NULL DEFAULT 'PENDING' CHECK (payment_status IN ('PENDING', 'PAID')),
  payment_method TEXT CHECK (payment_method IS NULL OR payment_method IN ('cash', 'mobile_money', 'card', 'bank_transfer')),
  paid_by UUID,
  paid_at TIMESTAMPTZ,
  status TEXT NOT NULL DEFAULT 'EN_ATTENTE_PAIEMENT'
    CHECK (status IN ('EN_ATTENTE_PAIEMENT', 'EN_ATTENTE_AFFECTATION', 'AFFECTE', 'CONFIE_CHAUFFEUR', 'EN_TRANSIT', 'ARRIVE', 'REMIS', 'ANNULE')),
  departure_id UUID,
  assigned_driver_user_id UUID,
  assigned_by UUID,
  arrival_confirmed_by UUID,
  delivered_by UUID,
  receiver_name TEXT,
  receiver_reference TEXT,
  created_by UUID NOT NULL,
  assigned_at TIMESTAMPTZ,
  arrival_at TIMESTAMPTZ,
  delivered_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT courier_parcels_tracking_unique UNIQUE (tenant_id, tracking_code),
  CONSTRAINT courier_parcels_departure_tenant_fk
    FOREIGN KEY (departure_id, tenant_id) REFERENCES departures(id, tenant_id) ON DELETE RESTRICT,
  CONSTRAINT courier_parcels_driver_tenant_fk
    FOREIGN KEY (assigned_driver_user_id, tenant_id) REFERENCES users(id, tenant_id) ON DELETE RESTRICT,
  CONSTRAINT courier_parcels_created_by_tenant_fk
    FOREIGN KEY (created_by, tenant_id) REFERENCES users(id, tenant_id),
  CONSTRAINT courier_parcels_paid_by_tenant_fk
    FOREIGN KEY (paid_by, tenant_id) REFERENCES users(id, tenant_id),
  CONSTRAINT courier_parcels_assigned_by_tenant_fk
    FOREIGN KEY (assigned_by, tenant_id) REFERENCES users(id, tenant_id),
  CONSTRAINT courier_parcels_arrival_by_tenant_fk
    FOREIGN KEY (arrival_confirmed_by, tenant_id) REFERENCES users(id, tenant_id),
  CONSTRAINT courier_parcels_delivered_by_tenant_fk
    FOREIGN KEY (delivered_by, tenant_id) REFERENCES users(id, tenant_id),
  CONSTRAINT courier_parcels_paid_state_check CHECK (
    (payment_status = 'PENDING' AND paid_at IS NULL AND paid_by IS NULL) OR
    (payment_status = 'PAID' AND paid_at IS NOT NULL AND paid_by IS NOT NULL)
  )
);
CREATE INDEX IF NOT EXISTS courier_parcels_tenant_status_idx
  ON courier_parcels (tenant_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS courier_parcels_driver_status_idx
  ON courier_parcels (tenant_id, assigned_driver_user_id, status);
CREATE INDEX IF NOT EXISTS courier_parcels_departure_idx
  ON courier_parcels (tenant_id, departure_id);

CREATE TABLE IF NOT EXISTS courier_payments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  parcel_id UUID NOT NULL,
  amount_fcfa BIGINT NOT NULL CHECK (amount_fcfa > 0),
  payment_method TEXT NOT NULL CHECK (payment_method IN ('cash', 'mobile_money', 'card', 'bank_transfer')),
  received_by UUID NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT courier_payments_parcel_tenant_fk
    FOREIGN KEY (parcel_id, tenant_id) REFERENCES courier_parcels(id, tenant_id) ON DELETE RESTRICT,
  CONSTRAINT courier_payments_receiver_tenant_fk
    FOREIGN KEY (received_by, tenant_id) REFERENCES users(id, tenant_id),
  CONSTRAINT courier_payments_one_per_parcel UNIQUE (parcel_id)
);

CREATE TABLE IF NOT EXISTS courier_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  parcel_id UUID NOT NULL,
  event_type TEXT NOT NULL CHECK (event_type IN (
    'ENREGISTRE', 'PAYE', 'AFFECTE', 'CONFIE_CHAUFFEUR',
    'EN_TRANSIT', 'ARRIVE', 'REMIS', 'ANNULE'
  )),
  actor_user_id UUID,
  departure_id UUID,
  notes TEXT NOT NULL DEFAULT '',
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT courier_events_parcel_tenant_fk
    FOREIGN KEY (parcel_id, tenant_id) REFERENCES courier_parcels(id, tenant_id) ON DELETE CASCADE,
  CONSTRAINT courier_events_actor_tenant_fk
    FOREIGN KEY (actor_user_id, tenant_id) REFERENCES users(id, tenant_id),
  CONSTRAINT courier_events_departure_tenant_fk
    FOREIGN KEY (departure_id, tenant_id) REFERENCES departures(id, tenant_id)
);
CREATE INDEX IF NOT EXISTS courier_events_parcel_created_idx
  ON courier_events (tenant_id, parcel_id, created_at);

ALTER TABLE courier_route_tariffs ENABLE ROW LEVEL SECURITY;
ALTER TABLE courier_parcels ENABLE ROW LEVEL SECURITY;
ALTER TABLE courier_payments ENABLE ROW LEVEL SECURITY;
ALTER TABLE courier_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE courier_route_tariffs, courier_parcels, courier_payments, courier_events FROM PUBLIC;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    REVOKE ALL ON TABLE courier_route_tariffs, courier_parcels, courier_payments, courier_events FROM anon;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    REVOKE ALL ON TABLE courier_route_tariffs, courier_parcels, courier_payments, courier_events FROM authenticated;
  END IF;
END $$;
