-- Défense en profondeur pour les tables de caisse et d'embarquement.
-- L'application utilise son backend de confiance (connexion PostgreSQL serveur)
-- et applique déjà l'autorisation métier + l'isolation tenant dans l'API.
-- Aucun accès direct via Supabase Data API n'est accordé à anon/authenticated.
ALTER TABLE guichet_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE guichet_operations ENABLE ROW LEVEL SECURITY;
ALTER TABLE boarding_events ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE guichet_sessions, guichet_operations, boarding_events FROM PUBLIC;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    REVOKE ALL ON TABLE guichet_sessions, guichet_operations, boarding_events FROM anon;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    REVOKE ALL ON TABLE guichet_sessions, guichet_operations, boarding_events FROM authenticated;
  END IF;
END $$;
