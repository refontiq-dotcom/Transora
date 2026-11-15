# Roadmap — TRANSORA

## Phase 0 — Audit et fondation
Audit dépôt, stack, architecture, données, auth/RBAC, CI/CD, sécurité, observabilité, API, dette et plan de migration.

## Phase 1 — SaaS core
Tenant, entreprises, utilisateurs, rôles, villes et gares par compagnie, lignes et arrêts ordonnés, véhicules, chauffeurs.

**Fondation réseau livrée dans le dépôt :** API authentifiée `/api/v1/reseau` pour villes, gares et lignes avec arrêts ordonnés ; isolation par tenant ; validation des gares actives, des extrémités, des doublons, des distances et des durées. Migration `017_company_transport_network.sql` versionnée (non appliquée en production).

## Phase 2 — Trip / Segment / Seat Engine
Départs rattachés aux lignes de compagnie ; billets avec arrêts de départ/arrivée ; plages de segments semi-ouvertes ; disponibilité et attribution de sièges par segment ; tarifs par segment ; ventes internes, publiques et guichet synchronisées. Les réservations historiques restent en mode trajet complet. Les holds temporaires de 15 minutes sont maintenant créés pour les réservations publiques ; les holds expirés libèrent le siège, y compris lors d'une nouvelle attribution. La recherche publique segmentée et la disponibilité filtrent les holds expirés.

## Phase 3 — Booking / Ticket / Payment
Réservation, billet, QR, paiement, frais 100 FCFA, annulation, remboursement, audit, canaux multiples. Le cycle interne de paiement vérifie désormais l'expiration du hold avant confirmation ; les intégrations des prestataires, webhooks signés et remboursements restent à finaliser.

## Phase 4 — Guichet / Caisse / Embarquement
Vente physique, sessions de caisse, rapprochement, scan et suivi par arrêt. La politique d’embarquement par compagnie, son instantané à la réservation, le manifeste numérique, l’enregistrement de l’arrivée réelle aux arrêts intermédiaires, la confirmation manuelle des absences après délai de grâce et le report consenti avec invalidation de l’ancien QR sont intégrés par la migration 023. Les remboursements effectifs restent à traiter dans le module financier/paiement.

## Phase 5 — API / TrouveTout
API versionnée, recherche, disponibilité, réservation, paiement, billet, validation, intégration.

## Phase 6 — Correspondances C-08
Direct, multi-segments, temps minimum, changements de gare, garanti/suggéré, monitoring, alertes, règles de réacheminement.

## Phase 7 — Flotte / Maintenance / Incidents / Notifications

## Phase 8 — Finance / Analytics

## Phase 9 — Offline / Résilience

## Phase 10 — IA assistive

Chaque phase doit être découpée en tâches petites, testables et validées avant passage à la suivante.
