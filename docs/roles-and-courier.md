# Rôles métier et service courrier TRANSORA

## Rôles de compagnie

| Rôle | Responsabilités principales | Limites |
|---|---|---|
| administrateur | Administration de la compagnie, comptes, paramètres et accès | Ne représente pas un administrateur de la plateforme TRANSORA |
| responsable_exploitation | Départs, horaires, organisation des voyages et application des tarifs transport | Pas d'administration de la caisse ni de la flotte technique |
| agent_guichet | Réservations, billets et attribution des sièges | Ne gère pas les sessions de caisse ni les tarifs |
| caissier | Sessions de caisse, encaissements, confirmations et clôtures | Ne modifie pas les tarifs transport |
| responsable_financier | Consultation et saisie financière, rapports et rapprochements | Pas de gestion du personnel ou des opérations de transport |
| responsable_logistique | Flotte, disponibilité des véhicules et suivi des incidents techniques | Pas d'accès aux données financières |
| chauffeur | Voyages et colis qui lui sont affectés, signalement d'incidents | Aucun accès aux opérations administratives ou financières |
| controleur | Contrôle et validation de l'embarquement | Pas de vente ni d'encaissement |
| mécanicien | Consultation de flotte et signalement/suivi des incidents techniques | Pas de gestion des voyages ou des finances |
| agent_accueil | Accueil et assistance aux réservations | Pas de clôture de caisse |
| responsable_courrier | Tarifs courrier, supervision et affectation des colis | Les encaissements restent réservés au caissier |
| agent_courrier | Enregistrement, suivi, réception et remise des colis | Ne modifie pas les tarifs et n'encaisse pas |

Les anciens rôles `superviseur`, `conducteur` et `agent_acceuil` restent temporairement reconnus pour préserver les comptes historiques. Ils sont normalisés respectivement vers `responsable_exploitation`, `chauffeur` et `agent_accueil`. Les permissions sont contrôlées par l'API.

## Comptes du personnel

1. L'administrateur crée une fiche employé et lui attribue un rôle.
2. Il renseigne l'adresse e-mail de l'employé.
3. Il crée son compte de connexion avec `POST /api/v1/personnel/:id/compte` et un mot de passe initial d'au moins 12 caractères.
4. L'employé se connecte avec son e-mail et ce mot de passe.
5. Une modification du rôle ou une désactivation révoque les sessions existantes. La suppression d'une fiche désactive également le compte associé.

Le mot de passe initial n'est jamais renvoyé par l'API. Il doit être communiqué à l'employé par un canal privé.

## Parcours courrier

1. Le responsable courrier configure un tarif par gare de départ et gare d'arrivée.
2. L'agent courrier enregistre l'expéditeur, le destinataire, leurs téléphones, la description et, si utile, le poids et la valeur déclarée.
3. TRANSORA génère un code de suivi aléatoire unique et conserve le prix applicable au moment de l'enregistrement.
4. Le caissier ouvre sa session de caisse et encaisse le prix du courrier. Le reçu de paiement est consultable via l'API et le paiement est inscrit au journal courrier, au journal financier et dans les opérations de caisse.
5. Le responsable courrier ou le responsable exploitation affecte le colis à un départ et à un compte chauffeur de la même compagnie.
6. Le chauffeur confirme la prise en charge, puis le départ du colis en transit. Il ne peut consulter que ses propres affectations.
7. L'agent courrier de la gare d'arrivée confirme la réception.
8. Lors de la remise, l'agent enregistre le nom du réceptionnaire et une référence facultative.
9. Le code de suivi et l'historique des événements permettent aux employés habilités de retrouver chaque étape. L'expéditeur ou le destinataire peut aussi consulter publiquement l'état du colis avec ce code, sans voir les coordonnées personnelles.

## Sécurité

- Chaque lecture et écriture est limitée au tenant authentifié.
- Les colis ne peuvent être affectés qu'à un départ du même tenant et correspondant au trajet.
- Un colis doit être payé avant affectation.
- Un chauffeur ne peut modifier que les colis qui lui sont affectés.
- La remise n'est possible qu'après confirmation de l'arrivée.
- Les paiements courrier sont enregistrés dans une session de caisse ouverte par le caissier.
- Les tables courrier sont protégées par RLS et ne sont pas accessibles directement aux rôles clients anon/authenticated.
