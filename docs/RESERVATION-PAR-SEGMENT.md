# Réservation par segment — TRANSORA

## Principe

Un départ lié à une ligne transporte des passagers entre les arrêts ordonnés de cette ligne. Chaque billet enregistre les deux arrêts choisis et une plage PostgreSQL semi-ouverte `[départ, arrivée)`.

Exemple pour une ligne A → B → C :
- A → B occupe `[0,1)`.
- B → C occupe `[1,2)`.
- A → C occupe `[0,2)`.

Un siège peut donc être vendu à deux passagers sur A → B et B → C, mais pas à deux passagers sur des portions qui se chevauchent. La contrainte d'exclusion GiST de la table `bookings` reste l'arbitre final en cas de concurrence.

## Programmer un départ sur une ligne

`POST /api/v1/voyages/departures` accepte désormais `routeId` (UUID facultatif pour conserver la compatibilité des anciens départs). Quand il est fourni :
- la ligne doit être active et appartenir au tenant authentifié ;
- les villes `origin` et `destination` doivent correspondre aux extrémités de la ligne ;
- la compagnie doit avoir un tarif actif sur ce trajet.

Les départs historiques sans `routeId` continuent à fonctionner en mode trajet complet.

## Réserver un segment

`POST /api/v1/voyages/departures/:id/bookings`

Corps pour une ligne :
```json
{
  "passengerName": "Nom du passager",
  "originStopId": "UUID de l'arrêt de départ",
  "destinationStopId": "UUID de l'arrêt d'arrivée"
}
```

Le backend vérifie l'appartenance des arrêts à la ligne, leur ordre, le tarif actif de la compagnie et les sièges occupés sur la plage demandée. Le montant et les frais compagnie sont enregistrés comme instantanés sur le billet.

La réservation publique `POST /api/public/:publicCode/reservations` et la vente guichet `POST /api/v1/guichet/vente` acceptent les mêmes champs d'arrêts. Le guichet et le formulaire de réservation interne proposent les arrêts de la ligne.

## Disponibilité

`GET /api/v1/sièges/availability?trajetId=...&originStopId=...&destinationStopId=...`

Pour un départ lié à une ligne, les deux arrêts sont requis. Les sièges affichés sont ceux qui ne sont pas occupés sur le segment demandé.

## Migration et compatibilité

La migration `018_segment_aware_departures.sql` ajoute le lien départ-ligne et les arrêts du billet, sans réécrire les réservations historiques. Elle est exécutée dans la CI sur une base PostgreSQL éphémère ; elle ne doit être appliquée en production qu'au moment de la procédure de mise en production autorisée.
