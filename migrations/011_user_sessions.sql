-- Sessions révocables et rotation des jetons de renouvellement.
CREATE UNIQUE INDEX IF NOT EXISTS users_id_tenant_unique ON users (id, tenant_id);
CREATE TABLE IF NOT EXISTS user_sessions (
  id TEXT PRIMARY KEY,
  user_id UUID NOT NULL,
  tenant_id UUID NOT NULL,
  refresh_token_hash TEXT NOT NULL UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_used_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ NOT NULL,
  revoked_at TIMESTAMPTZ,
  CONSTRAINT user_sessions_user_tenant_fk
    FOREIGN KEY (user_id, tenant_id) REFERENCES users (id, tenant_id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS user_sessions_user_active_idx
  ON user_sessions (user_id, tenant_id, expires_at)
  WHERE revoked_at IS NULL;

ALTER TABLE user_sessions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE user_sessions FROM PUBLIC;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    REVOKE ALL ON TABLE user_sessions FROM anon;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    REVOKE ALL ON TABLE user_sessions FROM authenticated;
  END IF;
END $$;
