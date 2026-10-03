# Cahier des charges maître — TRANSORA

## 1. Vision
TRANSORA est le système d'exploitation numérique des entreprises de transport interurbain et des gares. Il centralise le commerce, les opérations, les véhicules, le personnel, la finance opérationnelle, le contrôle des billets, les incidents, les notifications, les données et les intégrations.

## 2. Utilisateurs
- direction / administrateur entreprise
- responsable de gare
- guichetier / agent de réservation
- caissier
- responsable départ / embarquement
- contrôleur
- chauffeur
- gestionnaire de flotte
- maintenance / mécanicien
- RH
- finance / comptabilité
- agence / partenaire
- administrateur plateforme TRANSORA

Chaque rôle reçoit uniquement les données et actions nécessaires.

## 3. Modules
### C-01 Entreprise et multi-tenancy
Entreprises, stations, agences, utilisateurs, rôles, permissions, paramètres.

### C-02 Réseau
Villes, stations, lignes, arrêts ordonnés, distances/durées, règles de correspondance.

### C-03 Départs
Horaires, véhicule, conducteur, capacité, statut, retard, annulation, incidents.

Statuts départ : SCHEDULED, BOARDING, DEPARTED, IN_TRANSIT, ARRIVED, DELAYED, CANCELLED.

### C-04 Inventaire sièges
Plan de sièges, disponibilité temps réel, réservation temporaire pendant paiement, confirmation/libération, concurrence et synchronisation multi-canaux.

**Règle fondamentale : disponibilité par segment.**

Exemple Abidjan → Bouaké → Katiola → Korhogo :
- A→B
- B→K
- K→C

Un siège occupé A→B peut être vendu B→C car les segments ne se chevauchent pas.

### C-05 Réservation et billetterie
Recherche → départ → siège → passager → paiement → billet → QR.

Statuts billet : RESERVED, PAID, ISSUED, BOARDED, USED, CANCELLED, REFUNDED, NO_SHOW.

Chaque billet conserve son canal d'origine : TrouveTout, guichet, agence, site/app, API, etc.

### C-06 Guichet et caisse
Vente physique, sessions de caisse, moyens de paiement, journal des opérations, clôture et rapprochement de caisse.

### C-07 Embarquement et contrôle
QR sécurisé référencé par identifiant de billet. Validation : billet authentique, payé/émis, bon départ/date/segment, non déjà utilisé.

### C-08 Moteur d'itinéraires et de correspondances
- recherche origine → destination
- trajet direct
- itinéraires multi-segments
- disponibilité de chaque segment
- durée et prix totaux
- temps d'attente
- changement de gare
- correspondance garantie ou suggérée
- suivi de la correspondance
- détection de correspondance compromise
- notifications
- réacheminement selon règles.

**Règle absolue : ne jamais proposer une correspondance uniquement parce que deux horaires sont proches.** Vérifier horaires, station, temps minimal de transfert, disponibilité et règles des entreprises.

Temps minimal configurable : petite gare 20 min, normale 30, grande 45, complexe 60 min (valeurs initiales configurables, jamais codées en dur sans décision).

Une correspondance garantie implique une relation formelle entre opérateurs. Une correspondance suggérée est techniquement faisable mais non garantie.

### C-09 Flotte
Véhicules, immatriculation, capacité, modèle, année, kilométrage, conducteur, assurance/documents, statut, maintenance, pannes.

### C-10 Personnel
Profils, rôles, horaires, présence, permissions, affectations.

### C-11 Incidents
Panne, accident, retard, changement de véhicule, absence chauffeur, problème passager, bagage, billet, paiement ou caisse.

### C-12 Notifications
Confirmation, rappel, retard, changement de véhicule, annulation, alertes correspondance. Canaux selon intégrations : SMS, WhatsApp, email, push.

### C-13 Portail entreprise
Chaque entreprise peut disposer d'un portail public de ses lignes, horaires, tarifs, véhicules, places et réservations sans développer son propre logiciel.

### C-14 Finance et analytique
Billets, paiements, commissions, remboursements, dépenses, revenus, rapprochements ; analyse par entreprise, gare, ligne, départ, véhicule et canal.

### C-15 API et intégrations
API versionnée pour routes, départs, sièges, réservations, paiements, billets, validation, annulation et itinéraires. TrouveTout consomme cette API.

### C-16 Offline / connectivité faible
Le contrôle peut disposer d'un cache limité des billets attendus d'un départ. Synchronisation ultérieure avec gestion explicite des conflits et journalisation.

### C-17 Audit / anti-fraude
Journal des créations, paiements, émissions, validations, annulations, remboursements, changements critiques et opérations administratives.

### C-18 IA
Détection d'anomalies, demande, retards, pannes, écarts de caisse et sous-utilisation. L'IA recommande/alerte ; elle n'autorise pas seule une décision critique.

## 4. Tableau de bord direction
Voyageurs, billets, revenus, départs, occupation, véhicules actifs/immobilisés, retards, annulations, incidents.

## 5. Architecture métier
Chaîne cible :
**Planifier → vendre → collecter → affecter → embarquer → transporter → contrôler → analyser → améliorer.**

## 6. Modèle commercial
0 FCFA d'abonnement obligatoire au lancement.
100 FCFA de frais TRANSORA par voyageur/billet traité, payé par le voyageur, sans diminution du prix du transport.

## 7. Exigences non fonctionnelles
Sécurité, isolation multi-tenant, RBAC, auditabilité, idempotence, observabilité, performance, résilience, sauvegardes, migrations sûres, API documentée, tests automatisés.

## 8. Tests critiques
- isolation tenant
- permissions
- concurrence sur sièges
- conflits de segments
- calculs financiers
- transitions de billets
- audit
- faisabilité des correspondances
- idempotence des opérations critiques
- reprise après perte de connectivité.

## 9. Définition de réussite
Une entreprise doit pouvoir gérer son activité quotidienne sans dépendre de TrouveTout, tandis que TrouveTout peut utiliser TRANSORA comme moteur de recherche/réservation/ticketing.
