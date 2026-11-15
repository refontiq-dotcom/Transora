-- Circuit de remboursement contrôlé, tenant-scoped et traçable.
CREATE UNIQUE INDEX IF NOT EXISTS payments_id_tenant_unique ON payments (id, tenant_id);
CREATE TABLE IF NOT EXISTS refund_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  booking_id UUID NOT NULL,
  payment_id UUID NOT NULL,
  requested_by UUID NOT NULL,
  approved_by UUID,
  settled_by UUID,
  reason TEXT NOT NULL CHECK (reason IN (
    'CUSTOMER_CANCELLED', 'NO_SHOW', 'COMPANY_CANCELLED',
    'SERVICE_FAILURE', 'DUPLICATE_PAYMENT', 'OTHER'
  )),
  customer_explanation TEXT NOT NULL DEFAULT '',
  payment_channel TEXT NOT NULL CHECK (payment_channel IN ('CASH', 'ONLINE')),
  refundable_basis BIGINT NOT NULL CHECK (refundable_basis >= 0),
  refundable_amount BIGINT NOT NULL CHECK (refundable_amount > 0),
  policy_version INTEGER NOT NULL CHECK (policy_version > 0),
  policy_snapshot JSONB NOT NULL,
  status TEXT NOT NULL DEFAULT 'REQUESTED' CHECK (status IN (
    'REQUESTED', 'REJECTED', 'APPROVED_PENDING_PROVIDER', 'PAID', 'FAILED'
  )),
  decision_note TEXT,
  cash_session_id UUID,
  provider_refund_reference TEXT,
  provider_confirmed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  decided_at TIMESTAMPTZ,
  settled_at TIMESTAMPTZ,
  CONSTRAINT refund_requests_booking_tenant_fk
    FOREIGN KEY (booking_id, tenant_id) REFERENCES bookings(id, tenant_id) ON DELETE RESTRICT,
  CONSTRAINT refund_requests_payment_tenant_fk
    FOREIGN KEY (payment_id, tenant_id) REFERENCES payments(id, tenant_id) ON DELETE RESTRICT,
  CONSTRAINT refund_requests_requested_by_tenant_fk
    FOREIGN KEY (requested_by, tenant_id) REFERENCES users(id, tenant_id),
  CONSTRAINT refund_requests_approved_by_tenant_fk
    FOREIGN KEY (approved_by, tenant_id) REFERENCES users(id, tenant_id),
  CONSTRAINT refund_requests_settled_by_tenant_fk
    FOREIGN KEY (settled_by, tenant_id) REFERENCES users(id, tenant_id),
  CONSTRAINT refund_requests_cash_session_tenant_fk
    FOREIGN KEY (cash_session_id, tenant_id) REFERENCES guichet_sessions(id, tenant_id) ON DELETE RESTRICT,
  CONSTRAINT refund_requests_decision_state_check CHECK (
    (status = 'REQUESTED' AND approved_by IS NULL AND decided_at IS NULL) OR
    (status <> 'REQUESTED' AND approved_by IS NOT NULL AND decided_at IS NOT NULL)
  ),
  CONSTRAINT refund_requests_paid_state_check CHECK (
    (status = 'PAID' AND settled_at IS NOT NULL AND settled_by IS NOT NULL) OR
    (status <> 'PAID' AND settled_at IS NULL)
  ),
  CONSTRAINT refund_requests_cash_state_check CHECK (
    (status <> 'PAID' OR payment_channel <> 'CASH' OR cash_session_id IS NOT NULL)
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS refund_requests_one_pending_per_booking
  ON refund_requests (tenant_id, booking_id)
  WHERE status IN ('REQUESTED', 'APPROVED_PENDING_PROVIDER');

CREATE INDEX IF NOT EXISTS refund_requests_tenant_created_idx
  ON refund_requests (tenant_id, created_at DESC);

ALTER TABLE bookings DROP CONSTRAINT IF EXISTS bookings_seat_segment_no_overlap;
ALTER TABLE bookings ADD CONSTRAINT bookings_seat_segment_no_overlap
  EXCLUDE USING gist (departure_id WITH =, seat_number WITH =, segment_range WITH &&)
  WHERE (status <> ALL (ARRAY['CANCELLED'::text, 'EXPIRED'::text, 'NO_SHOW'::text, 'REFUNDED'::text]));

ALTER TABLE refund_requests ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE refund_requests FROM PUBLIC;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    REVOKE ALL ON TABLE refund_requests FROM anon;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    REVOKE ALL ON TABLE refund_requests FROM authenticated;
  END IF;
END $$;
