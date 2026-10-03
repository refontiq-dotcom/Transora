# AGENTS.md — TRANSORA

## Autorité
Le propriétaire du produit décide. ChatGPT agit comme architecte/maître d'œuvre. L'agent GitHub exécute les tâches validées.

## Ordre de lecture obligatoire
1. README.md
2. docs/CAHIER-DES-CHARGES.md
3. docs/PRODUCT.md
4. docs/ARCHITECTURE.md
5. docs/ROADMAP.md
6. docs/DIRECTIVES-AGENT-IA.md
7. docs/DECISIONS.md
8. docs/CONTINUITE.md
9. docs/DEFINITION-DONE.md

## Règles
- Ne jamais reconstruire sauvagement un existant.
- Ne jamais changer de stack sans justification et validation.
- Préserver les fonctionnalités existantes.
- Auditer avant toute modification structurante.
- Une seule source de vérité pour l'inventaire des sièges et l'état des billets.
- Isolation tenant côté serveur, jamais uniquement dans l'UI.
- Toute opération financière ou billet critique doit être idempotente lorsque nécessaire et auditée.
- Aucun secret dans le dépôt.
- Ne pas laisser l'IA décider seule d'une règle critique financière, de sécurité ou opérationnelle.
- Chaque changement important doit être testable, documenté et réversible.
- Commits petits et cohérents.
- Vérifier le diff avant livraison.

## Première mission
AUDIT ONLY : analyser le dépôt, produire le rapport d'audit et attendre validation. Ne pas coder une fonctionnalité pendant cette phase.
