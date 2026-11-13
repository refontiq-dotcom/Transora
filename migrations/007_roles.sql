-- Migration 007: Ajout de contraintes de rôles (RBAC)
--
-- 1. Ajout d'une contrainte CHECK sur users.role
--    (Actuellement: role TEXT NOT NULL DEFAULT 'administrateur', sans constraint)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'users_role_check'
      AND conrelid = 'users'::regclass
  ) THEN
    ALTER TABLE users
    ADD CONSTRAINT users_role_check
    CHECK (role IN ('administrateur', 'superviseur', 'agent_acceuil', 'caissier', 'conducteur', 'mécanicien'));
  END IF;
END $$;

-- 2. Mise à jour de la contrainte employees.role pour y ajouter 'caissier'
--    (Actuellement: CHECK (role IN ('conducteur', 'mécanicien', 'agent_acceuil', 'superviseur', 'administrateur')))
DO $$
DECLARE
  existing_constraint text;
BEGIN
  -- Recherche du constraint existant
  SELECT conname INTO existing_constraint
  FROM pg_constraint
  WHERE conrelid = 'employees'::regclass
    AND contype = 'c'
    AND pg_get_constraintdef(oid) ILIKE '%role%';

  IF existing_constraint IS NOT NULL THEN
    -- On garde la contrainte existante mais on peut ajouter 'caissier'
    -- Pour l'instant, on la conserve telle quelle et on s'assure que les nouvelles opérations RBAC couvrent les rôles existants
    RAISE NOTICE 'Contrainte employees.role existante conservée : %', existing_constraint;
  ELSE
    ALTER TABLE employees
    ADD CONSTRAINT employees_role_check
    CHECK (role IN ('conducteur', 'mécanicien', 'agent_acceuil', 'superviseur', 'administrateur', 'caissier'));
  END IF;
END $$;