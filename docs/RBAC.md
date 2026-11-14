# Matrice RBAC TRANSORA

Les permissions sont vérifiées côté API à partir du rôle contenu dans le JWT vérifié et du tenant authentifié. Un rôle inconnu ne reçoit aucun droit. L'interface ne constitue jamais une frontière de sécurité.

| Rôle provisionné | Accès autorisés |
|---|---|
| administrateur | Toutes les permissions, y compris gestion de l'entreprise et des utilisateurs |
| superviseur | Tableau de bord, voyages, réservations, sièges, flotte, personnel, incidents, notifications et recherche |
| agent_acceuil | Consultation des voyages, création de réservations, opérations de sièges et recherche |
| caissier | Consultation et gestion des paiements |
| conducteur | Consultation des voyages, sièges, incidents et notifications |
| mécanicien | Consultation de la flotte et des incidents |

## Limites de sécurité

- Les rôles RH, contrôleur, responsable de gare et finance ne sont pas encore des rôles de compte applicatif provisionnés. Ne pas les attribuer par simple libellé métier.
- Les routes qui regroupent lecture et écriture restent réservées aux permissions les plus prudentes tant que les autorisations par action ne sont pas séparées.
- Les permissions financières, audit et paramètres d'entreprise restent réservées à l'administrateur jusqu'à séparation des opérations de lecture et de mutation.
- Toute nouvelle permission doit être ajoutée à cette matrice, au type `Permission` et aux tests Vitest.
- Le tenant est toujours pris depuis le contexte authentifié, jamais depuis une valeur fournie par le navigateur.
