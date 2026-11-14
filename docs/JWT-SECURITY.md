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

La durée de vie maximale d'un jeton d'accès est de 8 heures. La vérification impose explicitement l'algorithme HS256, l'émetteur, l'audience et l'âge maximal. Une tolérance d'horloge de cinq secondes est admise.

## Impact sur les sessions existantes

Après déploiement de cette modification, les anciens jetons dépourvus des claims `iss` et `aud` seront refusés. Les utilisateurs devront se reconnecter pour obtenir un nouveau jeton. Aucun mot de passe, compte, ni enregistrement métier n'est modifié.

Ne pas changer les valeurs `JWT_ISSUER` et `JWT_AUDIENCE` entre les instances d'un même environnement. Garder le même `JWT_SECRET` sur toutes les instances qui doivent accepter les mêmes jetons.
