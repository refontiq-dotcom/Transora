import { Router, Request, Response } from "express";
import { body, param, validationResult } from "express-validator";

const router = Router();

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

// POST /api/v1/ia/alerte - Détecter une anomalie
router.post(
  "/alerte",
  [
    body("tenantId").notEmpty().withMessage("L'ID tenant est requis"),
    body("type").isIn(["anomalie_depart", "sous_utilisation", "écart_caise", "pattent_reservation", "paiement_anomalie"]).withMessage("Type d'anomalie invalide"),
    body("description").notEmpty().withMessage("La description est requise"),
    body("gravité").optional().isIn(["faible", "moyenne", "eleve", "critique"]).withMessage("Gravité invalide"),
    body("métriques").optional().isObject().withMessage("Les métriques doivent être un objet")
  ],
  validate,
  async (req: Request, res: Response) => {
    const { tenantId, type, description, gravité, métriques } = req.body;

    const alerteIA = {
      id: "ia-alerte-" + Date.now(),
      tenantId,
      type,
      description,
      gravité: gravité || "moyenne",
      métriques: métriques || {},
      généréeLe: new Date().toISOString(),
      statut: "ACTIVE",
      résolue: false
    };

    res.status(201).json({
      success: true,
      data: alerteIA,
      message: "Alarme IA générée avec succès"
    });
  }
);

// GET /api/v1/ia/alertes - Lister les alertes IA
router.get(
  "/alertes",
  [
    body("tenantId").optional().isString().withMessage("ID tenant invalide"),
    body("statut").optional().isIn(["ACTIVE", "RÉSOLU", "IGNORÉ"]).withMessage("Statut invalide"),
    body("type").optional().isString().withMessage("Type invalide")
  ],
  validate,
  async (req: Request, res: Response) => {
    const { tenantId, statut, type } = req.query;

    const alertes = [
      {
        id: "ia-1",
        tenantId: tenantId || "tenant-123",
        type: "sous_utilisation",
        description: "Véhicule sous-utilisé sur la ligne Abidjan-Bouaké (30% de capacité)",
        gravité: "faible",
        statut: "ACTIVE",
        généréeLe: new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString(),
        résolue: false
      },
      {
        id: "ia-2",
        tenantId: tenantId || "tenant-123",
        type: "écart_caise",
        description: "Écart de caisse de 150 FCFA détecté sur le guichet de Bouaké",
        gravité: "moyenne",
        statut: "ACTIVE",
        généréeLe: new Date(Date.now() - 1 * 24 * 60 * 60 * 1000).toISOString(),
        résolue: false
      }
    ];

    res.json({
      success: true,
      data: { alertes, filtres: { tenantId, statut, type } }
    });
  }
);

// PUT /api/v1/ia/alerte/résoudre - Résoudre une alerte IA
router.put(
  "/alerte/résoudre",
  [
    body("alerteId").notEmpty().withMessage("L'ID alerte est requis"),
    body("commentairesRésolution").optional().isString().withMessage("Commentaires de résolution invalides")
  ],
  validate,
  async (req: Request, res: Response) => {
    const { alerteId, commentairesRésolution } = req.body;

    const alerteRésolue = {
      alerteId,
      résolue: true,
      résolueLe: new Date().toISOString(),
      commentaires: commentairesRésolution || "Résolue par l'opérateur"
    };

    res.json({
      success: true,
      data: alerteRésolue,
      message: "Alarme IA résolue avec succès"
    });
  }
);

// GET /api/v1/ia/stats - Statistiques IA
router.get(
  "/stats",
  [
    body("tenantId").optional().isString().withMessage("ID tenant invalide"),
    body("périodeDébut").optional().isISO8601().withMessage("Date de début invalide"),
    body("périodeFin").optional().isISO8601().withMessage("Date de fin invalide")
  ],
  validate,
  async (req: Request, res: Response) => {
    const { tenantId, périodeDébut, périodeFin } = req.query;

    const statsIA = {
      tenantId,
      période: {
 début: périodeDébut || new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString(),
 fin: périodeFin || new Date().toISOString()
      },
      résumé: {
        totalAlertes: 24,
        parType: {
          anomalie_depart: 8,
          sous_utilisation: 6,
          écart_caise: 5,
          patten_reservation: 3,
          paiement_anomalie: 2
        },
        résolues: 15,
        enAttente: 9,
        tauxRésolution: 62.5
      },
      recommandations: [
        "Mettre en place des règles déterministes pour les opérations critiques",
        "Améliorer la surveillance des sièges en conflit",
        "Renforcer la validation des paiements"
      ]
    };

    res.json({
      success: true,
      data: statsIA
    });
  }
);

export default router;