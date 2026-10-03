# Definition of Done — TRANSORA

Une tâche n'est DONE que si applicable :

- [ ] besoin fonctionnel clairement couvert
- [ ] architecture respectée
- [ ] isolation multi-tenant vérifiée
- [ ] permissions vérifiées
- [ ] validations métier côté serveur
- [ ] erreurs et cas limites traités
- [ ] tests unitaires ajoutés/actualisés
- [ ] tests d'intégration ajoutés si nécessaire
- [ ] tests de concurrence pour inventaire lorsque pertinent
- [ ] auditabilité assurée
- [ ] idempotence assurée pour opérations sensibles
- [ ] sécurité revue
- [ ] observabilité suffisante
- [ ] documentation mise à jour
- [ ] migration sûre si schéma modifié
- [ ] aucun secret introduit
- [ ] diff relu
- [ ] CI/tests verts
- [ ] comportement existant préservé
- [ ] validation humaine obtenue lorsque la décision est structurante.

## Cas critiques
Un changement touchant billets, paiements, sièges, multi-tenancy, permissions, correspondances ou données financières ne peut pas être déclaré terminé sur la seule base d'un test manuel.
