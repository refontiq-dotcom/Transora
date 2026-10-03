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
