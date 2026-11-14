# Protection de l’authentification

Les routes `POST /api/v1/auth/login` et `POST /api/v1/auth/register` utilisent un compteur de tentatives PostgreSQL partagé entre les instances de l’API.

| Route | Clé IP | Clé compte | Fenêtre |
|---|---:|---:|---:|
| Connexion | 10 tentatives | 5 tentatives par e-mail | 15 minutes |
| Inscription | 3 tentatives | 2 tentatives par e-mail | 1 heure |

Les identifiants sont hachés par HMAC-SHA-256 avec `JWT_SECRET` avant stockage ; les adresses IP et e-mails ne sont pas conservés en clair dans la table. Les réponses bloquées utilisent HTTP 429 et l’en-tête `Retry-After`.

La table `auth_rate_limits` est protégée par RLS et n’accorde aucun accès aux rôles API publics (`anon` et `authenticated`, lorsqu’ils existent). Le serveur y accède via sa connexion PostgreSQL. La migration de la table est versionnée dans `migrations/010_auth_rate_limits.sql`. Les lignes expirées sont purgées périodiquement. La migration est idempotente et peut être rejouée sans supprimer les compteurs actifs.

La création du premier compte administrateur d’un nouveau tenant reste inchangée : ce compte initialise l’espace de l’entreprise. Cette correction ne modifie ni le modèle d’inscription ni les comptes existants.
