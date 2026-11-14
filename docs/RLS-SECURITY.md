# Sécurité RLS du schéma public

## Modèle d'accès

TRANSORA authentifie les utilisateurs avec ses propres JWT et fait passer les opérations métier par l'API Express. Le backend se connecte à PostgreSQL avec le rôle serveur configuré via `SUPABASE_DB_USER` (valeur documentée : `postgres.<project-ref>`). Le client web n'a pas besoin d'accéder directement aux tables via la Data API Supabase.

La migration `009_public_schema_rls.sql` applique donc une stratégie de refus par défaut pour les rôles Data API `anon` et `authenticated` :

- active RLS sur toutes les tables du schéma `public`, y compris les tables de suivi des migrations ;
- retire les privilèges directs sur toutes les tables et séquences à `anon`, `authenticated` et `PUBLIC` ;
- retire les mêmes privilèges par défaut pour les futures tables et séquences créées par `postgres` et `supabase_admin` ;
- conserve les privilèges de `service_role` et ceux du rôle serveur utilisé par l'API.

Aucune policy permissive n'est créée : les rôles Data API ne peuvent donc pas lire ou modifier les lignes en direct. RLS n'est pas forcé pour le propriétaire : l'API Express, qui se connecte comme rôle serveur/propriétaire, continue d'utiliser ses requêtes SQL et ses contrôles d'autorisation existants.

## Conséquence pour les évolutions

Ne pas connecter le navigateur directement aux tables métier avec la clé publique. Si un accès direct Supabase devient nécessaire, il faudra définir explicitement les privilèges minimaux et des policies RLS tenant-scoped, basées sur une identité serveur fiable. Ne jamais utiliser une valeur de tenant fournie librement par le client comme preuve d'autorisation.

## Vérification

Après application, contrôler que toutes les tables publiques ont `relrowsecurity = true`, qu'aucune policy n'existe par défaut, et que `anon` / `authenticated` n'ont plus de privilèges directs sur les tables et séquences.
