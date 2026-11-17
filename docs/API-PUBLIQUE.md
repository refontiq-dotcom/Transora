# API publique TRANSORA — Intégration TrouveTout et partenaires

## Objectif

TRANSORA expose un seul moteur de réservation aux différents canaux de vente. Le portail de réservation de chaque compagnie et les plateformes partenaires utilisent les mêmes départs, le même inventaire de sièges et les mêmes règles métier.

Le tableau de bord professionnel reste une interface distincte. Il n'est jamais nécessaire d'ouvrir une session agent pour consulter le portail voyageur.

## Base URL et version

- API recommandée : `/api/v1/public`
- Ancien chemin conservé pour compatibilité : `/api/public`
- Le nouveau développement partenaire doit utiliser la version `v1`.

Toutes les routes publiques sont limitées en débit. Le code public de compagnie est un identifiant de 32 caractères. Il permet d'accéder uniquement aux informations publiques et aux opérations de réservation exposées ci-dessous ; il ne remplace jamais une authentification professionnelle.

## Parcours recommandé pour TrouveTout — première version

1. TrouveTout présente les compagnies et les départs à partir de ses propres écrans.
2. Lorsqu'un voyageur choisit un départ, TrouveTout ouvre le portail de réservation de la compagnie en transmettant les identifiants déjà sélectionnés.
3. TRANSORA recharge et vérifie le départ et le segment auprès du serveur, puis préremplit le parcours.
4. Le voyageur termine la réservation sur le portail TRANSORA.
5. La réservation est visible dans le tableau de bord de la compagnie, car elle a été créée dans le moteur central.

URL du portail :

```text
/reservation.html?entreprise={publicCode}
```

Lien partenaire avec départ et segment préremplis :

```text
/reservation.html?entreprise={publicCode}&departureId={departureUuid}&originStopId={originStopUuid}&destinationStopId={destinationStopUuid}
```

`originStopId` et `destinationStopId` sont nécessaires pour les départs construits sur une ligne avec plusieurs arrêts. Pour un départ simple sans arrêts intermédiaires, seul `departureId` suffit.

Les paramètres reçus dans l'URL ne sont jamais considérés comme une preuve de disponibilité : le portail les compare aux données renvoyées par l'API et le serveur revérifie tout à la création de la réservation.

## Endpoints publics v1

### Lister les départs

`GET /api/v1/public/{publicCode}/departs`

Retourne le nom de la compagnie, sa politique d'embarquement et jusqu'à 100 départs programmés ouverts à la réservation.

### Consulter les sièges d'un départ

`GET /api/v1/public/{publicCode}/departs/{departureId}/places`

Pour un trajet segmenté, fournir :

- `originStopId`
- `destinationStopId`

Exemple :

```text
GET /api/v1/public/{publicCode}/departs/{departureId}/places?originStopId={originStopUuid}&destinationStopId={destinationStopUuid}
```

La réponse contient la capacité, les places disponibles, le tarif et les frais applicables.

### Créer une réservation temporaire

`POST /api/v1/public/{publicCode}/reservations`

Corps JSON :

```json
{
  "departureId": "UUID",
  "passengerName": "Nom du voyageur",
  "passengerPhone": "+2250700000000",
  "originStopId": "UUID facultatif",
  "destinationStopId": "UUID facultatif",
  "seatNumber": 12,
  "policyAccepted": true
}
```

`seatNumber` est facultatif : si absent, TRANSORA attribue automatiquement une place libre. Le serveur contrôle à nouveau le départ, le segment et le siège dans une transaction. Une place temporaire est bloquée pendant 15 minutes.

La réponse de création contient notamment `bookingId`, `ticketToken`, les montants détaillés, `bookingStatus: HELD`, `paymentStatus: NOT_INITIATED` et `holdExpiresAt`. Une réservation temporaire n'est pas un billet payé et ne donne pas droit à l'embarquement.

### Consulter une réservation / un billet

`GET /api/v1/public/{publicCode}/ticket/{ticketToken}`

Retourne le statut courant. Le QR code n'est fourni que lorsque la réservation est payée selon les contrôles actuels du serveur.

## Intégration embarquée ultérieure

Une deuxième étape pourra afficher le parcours de réservation directement dans TrouveTout. TrouveTout appellera alors les mêmes endpoints de départs, de disponibilité et de création de réservation.

Cette intégration doit rester un canal de présentation : TrouveTout ne doit pas maintenir une copie de l'inventaire des sièges ni créer ses propres réservations en base.

Pour les appels navigateur entre domaines, l'origine de TrouveTout doit être explicitement ajoutée à `CORS_ORIGINS` dans l'environnement du serveur TRANSORA. Ne jamais élargir CORS à toutes les origines avec des cookies ou des identifiants sensibles.

## Sécurité et limites actuelles

- Les routes publiques ne donnent accès ni au tableau de bord, ni aux données privées des autres compagnies.
- Les opérations professionnelles restent protégées par JWT, tenant et permissions.
- Le serveur contrôle la disponibilité réelle ; l'état affiché dans le navigateur peut devenir obsolète.
- Les conflits de sièges sont rejetés par le serveur (réponse HTTP 409).
- Les routes publiques sont soumises au rate limiting.
- Ne pas placer de secret serveur ou de JWT professionnel dans le navigateur de TrouveTout.
- Ne pas relancer automatiquement un POST de réservation après un timeout réseau : le client doit d'abord réconcilier l'état avec le voyageur ou l'assistance. Une clé d'idempotence partenaire dédiée n'est pas encore implémentée.
- Aucun fournisseur Mobile Money ou bancaire n'est actuellement connecté en production. Le flux public crée un blocage temporaire ; la confirmation de paiement demeure une opération séparée et contrôlée.
- Les notifications, le suivi analytique du canal d'origine et les credentials dédiés aux partenaires ne sont pas encore implémentés.

## Évolution prévue

1. Redirection vers le portail TRANSORA avec trajet prérempli (disponible avec cette livraison).
2. Intégration embarquée dans TrouveTout avec le même contrat API.
3. Authentification et gestion des applications partenaires si un accès non public ou des quotas individualisés deviennent nécessaires.
4. Idempotence des créations, attribution fiable du canal d'origine, webhooks et rapprochement des paiements.
