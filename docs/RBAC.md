# Matrice RBAC TRANSORA

Les permissions sont vérifiées côté API à partir du rôle contenu dans le JWT vérifié et du tenant authentifié. Un rôle inconnu ne reçoit aucun droit. L'interface ne constitue jamais une frontière de sécurité.

| Rôle provisionné | Accès autorisés |
|---|---|
| administrateur | Toutes les permissions, y compris gestion de l'entreprise et des utilisateurs |
| superviseur | Tableau de bord, voyages, réservations, sièges, paiements, finance en lecture, flotte, personnel, incidents, notifications, audit en lecture et recherche |
| agent_acceuil | Consultation des voyages, création de réservations, opérations de sièges et recherche |
| caissier | Consultation et gestion des paiements |
| conducteur | Consultation des voyages, sièges, incidents et notifications ; signalement d'incidents |
| mécanicien | Consultation et mise à jour de la flotte ; consultation des incidents |

## Limites de sécurité

- Les rôles RH, contrôleur, responsable de gare et finance ne sont pas encore des rôles de compte applicatif provisionnés. Ne pas les attribuer par simple libellé métier.
- Les modules flotte, incidents, notifications, finance, audit, sièges et voyages appliquent des permissions distinctes selon la méthode HTTP ; les suppressions et opérations critiques restent limitées.
- Les mutations financières et d'audit restent réservées à l'administrateur et au superviseur ; le caissier gère les paiements mais ne consulte pas les rapports financiers.
- Toute nouvelle permission doit être ajoutée à cette matrice, au type `Permission` et aux tests Vitest.
- Le tenant est toujours pris depuis le contexte authentifié, jamais depuis une valeur fournie par le navigateur.
