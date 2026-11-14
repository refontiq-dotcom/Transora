# CORS et métriques système

## CORS

L'API ne renvoie des en-têtes CORS qu'aux origines explicitement listées dans `CORS_ORIGINS`, séparées par des virgules et sans joker. Exemple :

```env
CORS_ORIGINS=https://app.example.com,https://admin.example.com
```

Une origine non autorisée ne reçoit pas les en-têtes CORS. Les requêtes serveur-à-serveur et les appels sans en-tête `Origin` restent possibles. Les cookies cross-origin sont désactivés (`credentials: false`). Les requêtes authentifiées doivent continuer à utiliser le bearer token TRANSORA.

En production, renseigner uniquement les origines exactes des interfaces réellement déployées. Ne pas ajouter `*` ni une origine de prévisualisation non maîtrisée. Si aucune interface web externe n'est utilisée, laisser la variable vide.

## Endpoint de métriques

`GET /metrics` exige désormais un JWT valide et le rôle `administrateur`. Les rôles opérationnels, y compris `superviseur`, reçoivent HTTP 403. L'endpoint `GET /health` reste public et ne révèle que l'état de disponibilité du service.

Les métriques exposent l'uptime et l'utilisation mémoire du processus ; elles ne sont pas destinées à être publiques. Pour un système de supervision externe, utiliser un compte administrateur dédié et protéger le transport HTTPS.
