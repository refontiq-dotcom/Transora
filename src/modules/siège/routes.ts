/**
 * Module: Inventaire et Gestion des Sièges
 *
 * Implémentation de la règle fondamentale C-04 : disponibilité par segment.
 * Deux réservations sont incompatibles si leurs intervalles de segments se chevauchent
 * ET utilisent le même siège.
 *
 * Exemple : Abidjan → Bouaké → Katiola → Korhogo :
 * - Siège occupé A→B peut être vendu B→C (segments non chevauchants)
 * - Siège occupé A→K ne peut pas être vendu B→K (chevauchement)
 */

import { Router, Request, Response } from "express";
import { body, param, query, validationResult } from "express-validator";
import { authorizePermission } from "../../middleware/rbac";

const router = Router();
router.use((req, res, next) => {
  const permission = req.method === "GET" ? "seats.read" : "seats.manage";
  return authorizePermission(permission)(req, res, next);
});

const validate = (req: Request, res: Response, next: any) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({
      success: false,
      message: "Données invalides",
      errors: errors.array()
    });
  }
  next();
};

// Helper: Vérifier si deux intervalles de segments se chevauchent
const segmentsSechevauchent = (arrêt1: {gare: string, segmentId: string}, arrêt2: {gare: string, segmentId: string}): boolean => {
  // Deux segments se chevauchent s'ils partagent au moins un segment commun
  // Logique simplifiée : comparer les IDs de segment ou les positions dans le trajet
  return arrêt1.segmentId === arrêt2.segmentId;
};

// POST /api/v1/sièges/réserver - Réserver un siège
router.post(
  "/réserver",
  [
    body("tenantId").notEmpty().withMessage("L'ID tenant est requis"),
    body("billetId").notEmpty().withMessage("L'ID billet est requis"),
    body("siègeNuméro").isInt({ min: 1 }).withMessage("Le numéro de siège doit être >= 1"),
    body("segmentDepart").notEmpty().withMessage("Le segment de départ est requis"),
    body("segmentArrivée").notEmpty().withMessage("Le segment d'arrivée est requis"),
    body("trajetId").notEmpty().withMessage("L'ID trajet est requis")
  ],
  validate,
  async (req: Request, res: Response) => {
    try {
      const { tenantId, billetId, siègeNuméro, segmentDepart, segmentArrivée, trajetId } = req.body;

      // TODO: Vérifier la disponibilité du siège selon la règle C-04
      // 1. Récupérer le plan de sièges actuel pour ce trajet
      // 2. Vérifier que le siège n'est pas déjà réservé
      // 3. Vérifier qu'aucun autre segment chevauchant ne réserve ce même siège
      //    - Pour chaque réservation existante, vérifier segmentsSechevauchent
      // 4. Si disponible, marquer le siège comme réservé (statut: RESERVED)
      // 5. Si non disponible, retourner une erreur de conflit

      const siègeDéjàPris = false; // TODO: Vérification réelle

      if (siègeDéjàPris) {
        return res.status(409).json({
          success: false,
          message: "Ce siège est déjà réservé pour ce segment ou un segment chevauchant",
          errors: [{ msg: "Siège en conflit" }]
        });
      }

      // TODO: Créer la réservation
      const réservation = {
        id: "réservation-123",
        billetId,
        siègeNuméro,
        segmentDepart,
        segmentArrivée,
        statut: "RESERVED",
        réservéLe: new Date().toISOString(),
        expireÀ: new Date(Date.now() + 15 * 60 * 1000).toISOString() // 15 min expiry
      };

      res.status(201).json({
        success: true,
        data: réservation,
        message: "Siège réservé avec succès"
      });
    } catch (error) {
      console.error("Erreur lors de la réservation du siège:", error);
      res.status(500).json({
        success: false,
        message: "Erreur interne du serveur"
      });
    }
  }
);

// GET /api/v1/sièges/availability - Obtenir la disponibilité des sièges
router.get(
  "/availability",
  [
    query("trajetId").notEmpty().withMessage("L'ID trajet est requis"),
    query("segmentDepart").notEmpty().withMessage("Le segment de départ est requis"),
    query("segmentArrivée").notEmpty().withMessage("Le segment d'arrivée est requis")
  ],
  validate,
  async (req: Request, res: Response) => {
    try {
      const { trajetId, segmentDepart, segmentArrivée } = req.query;

      // TODO: Calculer la disponibilité des sièges
      // 1. Récupérer le plan de sièges du trajet
      // 2. Soustraire les sièges déjà réservés selon la règle C-04
      // 3. Retourner { siègesDisponibles: number, détail: [...] }

      const mockAvailability = {
        trajetId,
        segmentDepart,
        segmentArrivée,
        capacitéTotale: 50,
        siègesRéservés: 12,
        siègesDisponibles: 38,
        détail: [
          { siège: 1, statut: "DISPONIBLE" },
          { siège: 2, statut: "DISPONIBLE" },
          // ... etc
        ]
      };

      res.json({
        success: true,
        data: mockAvailability
      });
    } catch (error) {
      console.error("Erreur lors du calcul de la disponibilité:", error);
      res.status(500).json({
        success: false,
        message: "Erreur interne du serveur"
      });
    }
  }
);

export default router;