# Rate limiting partagé — TRANSORA

## Fonctionnement

Les routes d'inscription et de connexion utilisent un compteur par adresse IP et par opération :
- inscription : 5 tentatives par heure ;
- connexion : 10 tentatives par 15 minutes.

Quand Redis REST est configuré, chaque compteur est stocké dans Redis. Une opération Lua atomique incrémente le compteur et pose son expiration à la première requête. Toutes les instances de l'API consultent donc le même compteur.

La clé Redis contient un hash SHA-256 de l'adresse IP plutôt que l'adresse IP en clair. Les espaces de noms séparent les limites d'inscription et de connexion.

## Configuration

Utiliser un service Redis compatible avec l'API REST Upstash, puis renseigner dans l'environnement d'exécution :

- REDIS_REST_URL : URL HTTPS REST du Redis ;
- REDIS_REST_TOKEN : jeton d'accès REST.

Les deux variables doivent être définies ensemble. Ne jamais committer le jeton.

## Comportement en cas d'indisponibilité

- Les deux variables absentes : stockage mémoire local, adapté au développement et à une instance unique.
- Les deux variables présentes : Redis partagé.
- Configuration partielle, erreur réseau, réponse Redis invalide : réponse HTTP 503. Aucun retour silencieux vers la mémoire locale, car cela contournerait la limite globale entre instances.

Le déploiement multi-instance doit donc être accompagné d'un Redis REST opérationnel et des deux variables configurées. Cette modification ne crée pas de base Redis et ne change aucune configuration d'hébergement.

## Tests

Les tests Vitest couvrent le seuil mémoire, l'incrément Redis, l'expiration atomique, le hachage des clés et le comportement fail-closed lorsque Redis est indisponible.
