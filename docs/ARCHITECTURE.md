# Architecture cible — TRANSORA

## Principes
1. Multi-tenant strict.
2. API-first.
3. Domaines métier séparés.
4. Une source de vérité.
5. Transactions critiques cohérentes.
6. Intégrations derrière des adapters.
7. Audit et observabilité natifs.
8. Offline limité et explicitement réconcilié.

## Domaines
Tenant/Identity, Network, Stations, Fleet, Staff, Trips, Segment Inventory, Booking, Ticketing, Payments, Cash, Boarding, Incidents, Notifications, Itinerary/Connections, Analytics, Integrations.

## Modèle de voyage
Trip + ordered stops + segments + vehicle + driver + seat plan.

L'inventaire se raisonne au niveau segment. Deux réservations sont incompatibles si leurs intervalles de segments se chevauchent et utilisent le même siège.

## État opérationnel
Les transitions de départ et de billet doivent être contrôlées par des règles métier explicites, non par de simples changements arbitraires côté client.

## Sécurité
- autorisation côté serveur
- isolation par tenant
- RBAC least privilege
- secrets hors dépôt
- validation des entrées
- journal d'audit
- idempotency keys sur opérations sensibles
- protection contre double réservation/double paiement
- logs sans données sensibles inutiles.

## API
API versionnée, contrats explicites, erreurs structurées, idempotence adaptée, authentification/autorisation, documentation OpenAPI si compatible avec la stack existante.

## Intégrations
TrouveTout, paiement, SMS/WhatsApp/email, éventuels partenaires. Les fournisseurs sont isolés derrière des interfaces/adapters.

## Observabilité
Logs structurés, métriques techniques et métier, traçage lorsque pertinent, suivi des erreurs, événements métier critiques, monitoring des intégrations.

## Offline
Le mode offline ne doit jamais créer une seconde vérité. Les données locales sont temporaires, bornées, horodatées et réconciliées avec le serveur selon des règles déterministes.

## Architecture existante
L'agent doit d'abord auditer la stack réelle du dépôt. Cette architecture cible ne justifie pas une réécriture automatique.
