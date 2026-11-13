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

// POST /api/v1/api/trouveout - Rechercher via TrouveTout
router.post(
  "/trouveout",
  [
    body("tenantId").notEmpty().withMessage("L'ID tenant est requis"),
    body("recherche").isObject().withMessage("La recherche doit être un objet"),
    body("recherche.origine").optional().isString().withMessage("Origine invalide"),
    body("recherche.destination").optional().isString().withMessage("Destination invalide"),
    body("recherche.date").optional().isISO8601().withMessage("Date invalide")
  ],
  validate,
  async (req: Request, res: Response) => {
    const { tenantId, recherche } = req.body;

    // TODO: Intégration TrouveTout C-15
    // - Appeler l'API TrouveTout pour rechercher des trajets
    // - Mapper les résultats vers le format interne de TRANSORA
    // - Valider la disponibilité des sièges
    // - Calculer les prix (incluant les frais 100 FCFA)
    // - Retourner les options de réservation

    const resultatsTrouveout = {
      requête: { origine: recherche?.origine, destination: recherche?.destination },
      trajets: [
        {
          id: "tt-1",
          origine: recherche?.origine || "Abidjan",
          destination: recherche?.destination || "Bouaké",
          départ: "2024-12-20T08:00:00Z",
          véhicule: { immatriculation: "ABC-123", capacite: 50 },
          prixTransport: 7500,
          fraisTransora: 100,
          prixTotal: 7600,
          placesDisponibles: 32
        }
      ],
      message: "Recherche TrouveTout effectuée"
    };

    res.json({
      success: true,
      data: resultatsTrouveout
    });
  }
);

// GET /api/v1/api/stats-integrations - Statistiques d'intégration
router.get(
  "/stats-integrations",
  [
    body("tenantId").optional().isString().withMessage("ID tenant invalide")
  ],
  validate,
  async (req: Request, res: Response) => {
    const { tenantId } = req.query;

    const stats = {
      tenantId,
      intégrationsActives: 1,
      nombreAppelsAPI: 2450,
      tauxSuccès: 98.5,
      erreurs: 3,
      dernierAppel: new Date(Date.now() - 30 * 60 * 1000).toISOString()
    };

    res.json({
      success: true,
      data: stats
    });
  }
);

// POST /api/v1/api/maj-métadonnées - Mettre à jour les métadonnées d'intégration
router.post(
  "/maj-métadonnées",
  [
    body("tenantId").notEmpty().withMessage("L'ID tenant est requis"),
    body("métadonnées").isObject().withMessage("Les métadonnées doivent être un objet"),
    body("métadonnées.nomAgent").optional().isString().withMessage("Nom agent invalide"),
    body("métadonnées.contact").optional().isString().withMessage("Contact invalide")
  ],
  validate,
  async (req: Request, res: Response) => {
    const { tenantId, métadonnées } = req.body;

    const result = {
      tenantId,
      métadonnéesMisesÀJour: {
        nomAgent: métadonnées?.nomAgent,
        contact: métadonnées?.contact,
        dateMaj: new Date().toISOString()
      },
      message: "Métadonnées mises à jour avec succès"
    };

    res.json({
      success: true,
      data: result
    });
  }
);

export default router;