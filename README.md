# TRANSORA

TRANSORA est une infrastructure SaaS de gestion et d'exploitation pour les entreprises de transport interurbain et les gares.

## Vision
Couvrir le cycle complet : **planifier → vendre → encaisser → affecter → embarquer → transporter → contrôler → analyser → améliorer**.

TRANSORA n'est pas seulement une billetterie. Il doit devenir le système opérationnel numérique de l'entreprise de transport.

## Principes
- Multi-tenant : une entreprise = un tenant isolé.
- API-first : les canaux de vente utilisent le même moteur métier.
- Une seule source de vérité pour trajets, sièges, billets et états opérationnels.
- Le moteur gère la complexité ; l'interface reste simple.
- Toutes les opérations critiques sont traçables.
- Les règles déterministes priment sur l'IA pour les opérations critiques.
- TrouveTout est un canal/client de TRANSORA, pas une dépendance structurelle obligatoire.

## Modèle commercial de lancement
- 0 FCFA d'abonnement mensuel obligatoire.
- 100 FCFA de frais de service TRANSORA par voyageur/billet traité.
- Les 100 FCFA sont payés par le voyageur et ne réduisent pas le prix du transport fixé par l'entreprise.
- Le frais s'applique quel que soit le canal : TrouveTout, guichet, agence, site/app de l'entreprise ou API partenaire.

## Documentation de référence
- [Cahier des charges](docs/CAHIER-DES-CHARGES.md)
- [Produit](docs/PRODUCT.md)
- [Architecture](docs/ARCHITECTURE.md)
- [Roadmap](docs/ROADMAP.md)
- [Directives Agent IA](docs/DIRECTIVES-AGENT-IA.md)
- [Bootstrap Agent](docs/AGENT-BOOTSTRAP.md)
- [Décisions](docs/DECISIONS.md)
- [Continuité](docs/CONTINUITE.md)
- [Definition of Done](docs/DEFINITION-DONE.md)

## Règle de démarrage
La première mission de l'agent de codage est un **AUDIT UNIQUEMENT**. Aucun développement fonctionnel ne doit commencer avant validation humaine de l'audit et de la stratégie d'implémentation.

## Application

L'application TRANSORA se trouve dans `src/` (API), `public/` (interface), `migrations/` (schéma PostgreSQL) et `test/` (tests).

### Démarrage local

1. Installer Node.js 20 ou plus récent.
2. Copier `.env.example` vers `.env`, puis renseigner les identifiants de base de données Supabase et le secret JWT. Ne jamais publier `.env` ni le certificat de base de données.
3. Installer les dépendances : `npm ci`.
4. Lancer l'API et le tableau de bord : `npm run dev`.
5. Ouvrir `http://localhost:3000`.

Les migrations de base de données s'appliquent avec `npm run db:migrate`. Exécuter `npm test` pour compiler le projet et lancer les tests.

### Recherche et contrôle des billets

- La recherche globale authentifiée (`GET /api/v1/recherche?q=...`) couvre les passagers/réservations et leurs paiements, les départs, les véhicules et les opérations financières du tenant connecté.
- Un billet payé et associé à un paiement confirmé peut être affiché et imprimé avec un QR code et un code-barres Code 128. Le code représente l'identifiant du billet; les données du passager ne sont pas encodées dans le code.
- Le contrôle (`GET /api/v1/recherche/billet/:id`) vérifie le tenant, le paiement, les annulations et l'heure du départ. Le scan est en lecture seule et ne confirme pas l'embarquement.
- La caméra utilise les formats QR et Code 128/39/UPC/EAN pris en charge par le navigateur. Elle nécessite HTTPS (ou `localhost`) et une permission caméra. Les lecteurs USB/Bluetooth qui saisissent le code comme un clavier et la saisie manuelle restent disponibles comme solutions de repli.
- Les données client actuellement enregistrées se limitent au nom du passager et à sa réservation; les numéros de téléphone et adresses e-mail des passagers ne sont pas encore stockés. Aucun fournisseur de paiement mobile ou bancaire n'est connecté : les règlements par carte et Mobile Money restent confirmés manuellement dans l'application.
