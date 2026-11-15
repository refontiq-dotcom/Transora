-- Politique d'embarquement propre à chaque compagnie, figée au moment de la réservation.
CREATE TABLE IF NOT EXISTS company_boarding_policies (
  tenant_id UUID PRIMARY KEY REFERENCES tenants(id) ON DELETE CASCADE,
  version INTEGER NOT NULL DEFAULT 1 CHECK (version > 0),
  boarding_open_minutes_before INTEGER NOT NULL DEFAULT 60 CHECK (boarding_open_minutes_before BETWEEN 0 AND 360),
  boarding_deadline_minutes_before INTEGER NOT NULL DEFAULT 5 CHECK (boarding_deadline_minutes_before BETWEEN 0 AND 60),
  grace_period_minutes INTEGER NOT NULL DEFAULT 15 CHECK (grace_period_minutes BETWEEN 0 AND 180),
  allow_rebooking_after_no_show BOOLEAN NOT NULL DEFAULT FALSE,
  max_rebookings INTEGER NOT NULL DEFAULT 0 CHECK (max_rebookings BETWEEN 0 AND 5),
  rebooking_fee_amount INTEGER NOT NULL DEFAULT 0 CHECK (rebooking_fee_amount >= 0),
  refund_policy TEXT NOT NULL DEFAULT 'NONE' CHECK (refund_policy IN ('NONE', 'FULL', 'PARTIAL')),
  refund_percentage INTEGER NOT NULL DEFAULT 0 CHECK (refund_percentage BETWEEN 0 AND 100),
  auto_find_next_departure BOOLEAN NOT NULL DEFAULT TRUE,
  updated_by UUID,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT company_boarding_policy_refund_consistency CHECK (
    (refund_policy = 'NONE' AND refund_percentage = 0) OR
    (refund_policy = 'FULL' AND refund_percentage = 100) OR
    (refund_policy = 'PARTIAL' AND refund_percentage BETWEEN 1 AND 99)
  ),
  CONSTRAINT company_boarding_policy_max_rebookings_consistency CHECK (
    (allow_rebooking_after_no_show AND max_rebookings > 0) OR
    (NOT allow_rebooking_after_no_show AND max_rebookings = 0)
  )
);

ALTER TABLE company_boarding_policies
  ADD CONSTRAINT company_boarding_policies_updated_by_tenant_fk
  FOREIGN KEY (updated_by, tenant_id) REFERENCES users(id, tenant_id);

INSERT INTO company_boarding_policies (tenant_id)
SELECT id FROM tenants
ON CONFLICT (tenant_id) DO NOTHING;

CREATE OR REPLACE FUNCTION create_default_company_boarding_policy()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO company_boarding_policies (tenant_id)
  VALUES (NEW.id)
  ON CONFLICT (tenant_id) DO NOTHING;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS tenants_default_boarding_policy ON tenants;
CREATE TRIGGER tenants_default_boarding_policy
AFTER INSERT ON tenants
FOR EACH ROW EXECUTE FUNCTION create_default_company_boarding_policy();

ALTER TABLE departures
  ADD COLUMN IF NOT EXISTS actual_departed_at TIMESTAMPTZ;

CREATE OR REPLACE FUNCTION stamp_departure_actual_departure()
RETURNS TRIGGER LANGUAGE plpgsql AS $fn$
BEGIN
  IF NEW.status = 'DEPARTED' AND NEW.actual_departed_at IS NULL THEN
    NEW.actual_departed_at := NOW();
  END IF;
  RETURN NEW;
END;
$fn$;

DROP TRIGGER IF EXISTS departures_stamp_actual_departure_insert ON departures;
CREATE TRIGGER departures_stamp_actual_departure_insert
BEFORE INSERT ON departures
FOR EACH ROW EXECUTE FUNCTION stamp_departure_actual_departure();

DROP TRIGGER IF EXISTS departures_stamp_actual_departure_update ON departures;
CREATE TRIGGER departures_stamp_actual_departure_update
BEFORE UPDATE OF status ON departures
FOR EACH ROW EXECUTE FUNCTION stamp_departure_actual_departure();

ALTER TABLE bookings
  ADD COLUMN IF NOT EXISTS boarding_policy_version INTEGER,
  ADD COLUMN IF NOT EXISTS boarding_policy_snapshot JSONB,
  ADD COLUMN IF NOT EXISTS boarding_policy_accepted_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS boarding_policy_accepted_by UUID;

ALTER TABLE bookings
  ADD CONSTRAINT bookings_boarding_policy_accepted_by_tenant_fk
  FOREIGN KEY (boarding_policy_accepted_by, tenant_id) REFERENCES users(id, tenant_id);

UPDATE bookings b
SET boarding_policy_version = COALESCE(b.boarding_policy_version, 1),
    boarding_policy_snapshot = COALESCE(
      b.boarding_policy_snapshot,
      jsonb_build_object(
        'version', 1,
        'boardingOpenMinutesBefore', 60,
        'boardingDeadlineMinutesBefore', 5,
        'gracePeriodMinutes', 15,
        'allowRebookingAfterNoShow', false,
        'maxRebookings', 0,
        'rebookingFeeAmount', 0,
        'refundPolicy', 'NONE',
        'refundPercentage', 0,
        'autoFindNextDeparture', true
      )
    );

CREATE OR REPLACE FUNCTION snapshot_booking_boarding_policy()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE policy_row company_boarding_policies%ROWTYPE;
BEGIN
  IF NEW.boarding_policy_snapshot IS NULL THEN
    SELECT * INTO policy_row
    FROM company_boarding_policies
    WHERE tenant_id = NEW.tenant_id
    FOR SHARE;

    IF FOUND THEN
      NEW.boarding_policy_version := policy_row.version;
      NEW.boarding_policy_snapshot := jsonb_build_object(
        'version', policy_row.version,
        'boardingOpenMinutesBefore', policy_row.boarding_open_minutes_before,
        'boardingDeadlineMinutesBefore', policy_row.boarding_deadline_minutes_before,
        'gracePeriodMinutes', policy_row.grace_period_minutes,
        'allowRebookingAfterNoShow', policy_row.allow_rebooking_after_no_show,
        'maxRebookings', policy_row.max_rebookings,
        'rebookingFeeAmount', policy_row.rebooking_fee_amount,
        'refundPolicy', policy_row.refund_policy,
        'refundPercentage', policy_row.refund_percentage,
        'autoFindNextDeparture', policy_row.auto_find_next_departure
      );
    ELSE
      NEW.boarding_policy_version := 1;
      NEW.boarding_policy_snapshot := jsonb_build_object(
        'version', 1, 'boardingOpenMinutesBefore', 60,
        'boardingDeadlineMinutesBefore', 5, 'gracePeriodMinutes', 15,
        'allowRebookingAfterNoShow', false, 'maxRebookings', 0,
        'rebookingFeeAmount', 0, 'refundPolicy', 'NONE',
        'refundPercentage', 0, 'autoFindNextDeparture', true
      );
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS bookings_snapshot_boarding_policy ON bookings;
CREATE TRIGGER bookings_snapshot_boarding_policy
BEFORE INSERT ON bookings
FOR EACH ROW EXECUTE FUNCTION snapshot_booking_boarding_policy();

CREATE TABLE IF NOT EXISTS boarding_absence_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  booking_id UUID NOT NULL,
  departure_id UUID NOT NULL,
  stop_id UUID,
  grace_reference_at TIMESTAMPTZ NOT NULL,
  grace_period_minutes INTEGER NOT NULL CHECK (grace_period_minutes BETWEEN 0 AND 180),
  policy_version INTEGER NOT NULL,
  confirmed_by UUID NOT NULL,
  comments TEXT,
  confirmed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT boarding_absence_booking_once UNIQUE (booking_id, departure_id),
  CONSTRAINT boarding_absence_booking_tenant_fk
    FOREIGN KEY (booking_id, tenant_id) REFERENCES bookings(id, tenant_id) ON DELETE CASCADE,
  CONSTRAINT boarding_absence_departure_tenant_fk
    FOREIGN KEY (departure_id, tenant_id) REFERENCES departures(id, tenant_id) ON DELETE CASCADE,
  CONSTRAINT boarding_absence_stop_tenant_fk
    FOREIGN KEY (tenant_id, stop_id) REFERENCES route_stops(tenant_id, id) ON DELETE RESTRICT,
  CONSTRAINT boarding_absence_actor_tenant_fk
    FOREIGN KEY (confirmed_by, tenant_id) REFERENCES users(id, tenant_id)
);

CREATE TABLE IF NOT EXISTS booking_rebooking_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  booking_id UUID NOT NULL,
  previous_departure_id UUID NOT NULL,
  new_departure_id UUID NOT NULL,
  previous_seat_number INTEGER,
  new_seat_number INTEGER NOT NULL,
  fee_amount INTEGER NOT NULL DEFAULT 0 CHECK (fee_amount >= 0),
  fee_payment_method TEXT CHECK (fee_payment_method IS NULL OR fee_payment_method = 'cash'),
  fee_receipt TEXT,
  consent_method TEXT NOT NULL CHECK (consent_method IN ('IN_PERSON', 'PHONE', 'SMS', 'WHATSAPP', 'OTHER')),
  consent_reference TEXT,
  confirmed_by UUID NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT booking_rebooking_booking_target_once UNIQUE (booking_id, new_departure_id),
  CONSTRAINT booking_rebooking_booking_tenant_fk
    FOREIGN KEY (booking_id, tenant_id) REFERENCES bookings(id, tenant_id) ON DELETE CASCADE,
  CONSTRAINT booking_rebooking_previous_departure_tenant_fk
    FOREIGN KEY (previous_departure_id, tenant_id) REFERENCES departures(id, tenant_id) ON DELETE RESTRICT,
  CONSTRAINT booking_rebooking_new_departure_tenant_fk
    FOREIGN KEY (new_departure_id, tenant_id) REFERENCES departures(id, tenant_id) ON DELETE RESTRICT,
  CONSTRAINT booking_rebooking_actor_tenant_fk
    FOREIGN KEY (confirmed_by, tenant_id) REFERENCES users(id, tenant_id),
  CONSTRAINT booking_rebooking_fee_receipt_check CHECK (
    (fee_amount = 0 AND fee_payment_method IS NULL) OR
    (fee_amount > 0 AND fee_payment_method = 'cash' AND fee_receipt IS NOT NULL)
  )
);

CREATE INDEX IF NOT EXISTS booking_rebooking_tenant_booking_idx
  ON booking_rebooking_events (tenant_id, booking_id, created_at DESC);

CREATE TABLE IF NOT EXISTS stop_arrival_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  departure_id UUID NOT NULL,
  stop_id UUID NOT NULL,
  arrived_by UUID NOT NULL,
  comments TEXT,
  arrived_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT stop_arrival_departure_stop_once UNIQUE (departure_id, stop_id),
  CONSTRAINT stop_arrival_departure_tenant_fk
    FOREIGN KEY (departure_id, tenant_id) REFERENCES departures(id, tenant_id) ON DELETE CASCADE,
  CONSTRAINT stop_arrival_stop_tenant_fk
    FOREIGN KEY (tenant_id, stop_id) REFERENCES route_stops(tenant_id, id) ON DELETE RESTRICT,
  CONSTRAINT stop_arrival_actor_tenant_fk
    FOREIGN KEY (arrived_by, tenant_id) REFERENCES users(id, tenant_id)
);

CREATE INDEX IF NOT EXISTS stop_arrival_departure_stop_time_idx
  ON stop_arrival_events (tenant_id, departure_id, stop_id, arrived_at DESC);

CREATE INDEX IF NOT EXISTS boarding_absence_departure_time_idx
  ON boarding_absence_events (tenant_id, departure_id, confirmed_at DESC);

ALTER TABLE company_boarding_policies ENABLE ROW LEVEL SECURITY;
ALTER TABLE boarding_absence_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE stop_arrival_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE booking_rebooking_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE company_boarding_policies, boarding_absence_events, stop_arrival_events, booking_rebooking_events FROM PUBLIC;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    REVOKE ALL ON TABLE company_boarding_policies, boarding_absence_events, stop_arrival_events, booking_rebooking_events FROM anon;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    REVOKE ALL ON TABLE company_boarding_policies, boarding_absence_events, stop_arrival_events, booking_rebooking_events FROM authenticated;
  END IF;
END $$;

ALTER TABLE bookings DROP CONSTRAINT IF EXISTS bookings_seat_segment_no_overlap;
ALTER TABLE bookings ADD CONSTRAINT bookings_seat_segment_no_overlap
  EXCLUDE USING gist (departure_id WITH =, seat_number WITH =, segment_range WITH &&)
  WHERE (status <> ALL (ARRAY['CANCELLED'::text, 'EXPIRED'::text, 'NO_SHOW'::text]));

ALTER TABLE bookings
  ADD COLUMN IF NOT EXISTS boarding_status TEXT NOT NULL DEFAULT 'EXPECTED';

UPDATE bookings b
SET boarding_status = CASE
  WHEN b.status = 'NO_SHOW' THEN 'NO_SHOW'
  WHEN EXISTS (SELECT 1 FROM alighting_events ae WHERE ae.booking_id = b.id AND ae.tenant_id = b.tenant_id) THEN 'OFFBOARDED'
  WHEN EXISTS (SELECT 1 FROM boarding_events be WHERE be.booking_id = b.id AND be.tenant_id = b.tenant_id) THEN 'BOARDED'
  ELSE 'EXPECTED'
END;

ALTER TABLE bookings DROP CONSTRAINT IF EXISTS bookings_boarding_status_check;
ALTER TABLE bookings ADD CONSTRAINT bookings_boarding_status_check
  CHECK (boarding_status = ANY (ARRAY['EXPECTED'::text, 'BOARDED'::text, 'OFFBOARDED'::text, 'NO_SHOW'::text]));
