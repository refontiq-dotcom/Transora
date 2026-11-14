# Durcissement des jetons JWT

TRANSORA émet et accepte uniquement des jetons d'accès signés en **HS256** avec un secret d'au moins 32 caractères.

Chaque jeton doit contenir :
- `sub` : identifiant de l'utilisateur ;
- `email`, `role` et `tenantId` : contexte d'identité et de tenant ;
- `iat` et `exp` : dates d'émission et d'expiration ;
- `iss` et `aud` : émetteur et audience attendus.

Valeurs par défaut, configurables dans l'environnement :
```env
JWT_ISSUER=transora-api
JWT_AUDIENCE=transora-clients
```

La durée de vie maximale d'un jeton d'accès est de 15 minutes. La vérification impose explicitement l'algorithme HS256, l'émetteur, l'audience et l'âge maximal. Une tolérance d'horloge de cinq secondes est admise.

## Impact sur les sessions existantes

Après déploiement de cette modification, les anciens jetons dépourvus des claims `iss` et `aud` seront refusés. Les utilisateurs devront se reconnecter pour obtenir un nouveau jeton. Aucun mot de passe, compte, ni enregistrement métier n'est modifié.

Ne pas changer les valeurs `JWT_ISSUER` et `JWT_AUDIENCE` entre les instances d'un même environnement. Garder le même `JWT_SECRET` sur toutes les instances qui doivent accepter les mêmes jetons.


## Sessions et renouvellement

Les jetons d'accès sont valides 15 minutes et sont liés à une session serveur. Le jeton de renouvellement est aléatoire, conservé sous forme de hash dans PostgreSQL et transmis au navigateur dans un cookie HttpOnly, SameSite=Strict. Chaque renouvellement effectue une rotation du jeton. La déconnexion révoque la session côté serveur; les endpoints `/auth/sessions`, `/auth/sessions/:sessionId` et `/auth/logout-all` permettent de consulter et révoquer les sessions du compte.


## Stockage du jeton d'accès dans le navigateur

Le jeton d'accès est conservé uniquement dans la mémoire JavaScript de la page : il n'est pas écrit dans `localStorage` ni dans `sessionStorage`. Les appels API de même origine reçoivent automatiquement le jeton en mémoire. En cas d'expiration, le client utilise le cookie de renouvellement HttpOnly, SameSite=Strict et limité au chemin `/api/v1/auth/refresh`, puis réessaie une seule fois la requête qui a reçu une réponse 401.

Au rechargement de la page, le client restaure la session via le cookie HttpOnly et obtient un nouvel Access Token. Le profil utilisateur non secret peut rester dans `localStorage`.

**Limite de sécurité :** le stockage en mémoire réduit le risque de récupération ultérieure d'un jeton persistant, mais ne neutralise pas une faille XSS active. Un script malveillant exécuté dans la page peut toujours agir au nom de l'utilisateur. La prévention XSS, la validation/échappement des sorties et une politique CSP stricte restent nécessaires.

## Politique de sécurité du contenu (CSP)

Le serveur définit explicitement une CSP via Helmet :
- scripts et connexions limités à la même origine ;
- scripts inline et gestionnaires d'événements HTML inline interdits ;
- objets embarqués interdits et aucune origine autorisée à encadrer l'application ;
- images autorisées depuis la même origine, les données embarquées et les blobs nécessaires aux QR codes ;
- feuilles de style inline conservées pour les styles existants, avec les feuilles Google Fonts et les polices Google nécessaires à l'interface.

La politique est couverte par un test d'intégration qui vérifie les directives de sécurité et l'absence de `unsafe-inline` pour les scripts. Cette CSP réduit les possibilités d'exploitation d'une injection, mais ne remplace pas la correction de toute source XSS.
