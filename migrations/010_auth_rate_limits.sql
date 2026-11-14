-- Compteur de tentatives d’authentification partagé entre les instances API.
CREATE TABLE IF NOT EXISTS auth_rate_limits (
  scope TEXT NOT NULL,
  identifier_hash CHAR(64) NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  window_started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (scope, identifier_hash)
);

ALTER TABLE auth_rate_limits ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE auth_rate_limits FROM PUBLIC, anon, authenticated;
