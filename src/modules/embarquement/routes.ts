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

// POST /api/v1/embarquement/valider - Valider un embarquement
router.post(
  "/valider",
  [
    body("billetId").notEmpty().withMessage("L'ID billet est requis"),
    body("scannerId").optional().isString().withMessage("ID scanner invalide"),
    body("commentaires").optional().isString().withMessage("Commentaires invalides")
  ],
  validate,
  async (req: Request, res: Response) => {
    const { billetId, scannerId, commentaires } = req.body;

    // TODO: Valider un embarquement
    // - Vérifier que le billet existe et appartient au tenant actuel
    // - Vérifier le statut du billet: doit être PAID, ISSUED
    // - Vérifier que le billet n'a déjà été utilisé (used)
    // - Vérifier la date/heure du départ
    // - Vérifier le segment correspondant au trajet
    // - Mettre à jour le statut du billet: BOARDED
    // - Enregistrer l'événement d'embarquement
    // - Générer un QR code validé ou mettre à jour le statut existant

    const billetValide = {
      id: billetId,
      statut: "BOARDED",
      embarquéLe: new Date().toISOString(),
      scannerId: scannerId || "scanner-default",
      voyageId: "temp-voyage-id"
    };

    res.json({
      success: true,
      data: billetValide,
      message: "Embarquement validé avec succès"
    });
  }
);

// GET /api/v1/embarquement/scan/:billetId - Scanner un billet
router.get(
  "/scan/:billetId",
  [
    param("billetId").notEmpty().withMessage("L'ID billet est requis")
  ],
  validate,
  async (req: Request, res: Response) => {
    const { billetId } = req.params;

    // TODO: Scanner un billet
    // - Récupérer le billet par ID
    // - Vérifier son authenticité
    // - Vérifier qu'il peut être embargé (statut, date, segment)
    // - Retourner les informations du billet et validation status

    const mockBillet = {
      id: billetId,
      statut: "ISSUED",
      origine: "Abidjan",
      destination: "Bouaké",
      départ: "2024-12-20T14:30:00Z",
      siège: 15,
      valide: true,
      crééLe: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString()
    };

    res.json({
      success: true,
      data: mockBillet
    });
  }
);

// POST /api/v1/embarquement/control - Contrôle d'embarquement par le contrôleur
router.post(
  "/control",
  [
    body("departureId").notEmpty().withMessage("L'ID départ est requis"),
    body("controllerId").notEmpty().withMessage("L'ID contrôleur est requis"),
    body("scanResults").isArray().withMessage("Les résultats de scan doivent être un tableau"),
    body("scanResults[].billetId").notEmpty().withMessage("L'ID billet est requis dans chaque résultat"),
    body("scanResults[].valide").isBoolean().withMessage("Le champ valide doit être un booléen")
  ],
  validate,
  async (req: Request, res: Response) => {
    const { departureId, controllerId, scanResults } = req.body;

    // TODO: Contrôle d'embarquement par le contrôleur
    // - Traiter chaque résultat de scan
    // - Pour chaque billet: vérifier l'authenticité, le statut, la validité du segment
    // - Générer des rapports d'incidents le cas échéant
    // - Mettre à jour les statuts des billets (utilisés, en conflit, etc.)
    // - Enregistrer les contrôles de la session
    // - Calculer le taux de validation

    const resultatsValidation = scanResults.map((resultat: any) => ({
      billetId: resultat.billetId,
      valide: resultat.valide,
      motif: resultat.valide ? null : "Billet invalide ou déjà utilisé",
      controlePar: controllerId,
      controleLe: new Date().toISOString()
    }));

    const tauxValidation = scanResults.filter((r: any) => r.valide).length / scanResults.length * 100;

    res.json({
      success: true,
      data: {
        departureId,
        controllerId,
        resultats: resultatsValidation,
        tauxValidation: Math.round(tauxValidation),
        totalScannes: scanResults.length,
        valides: scanResults.filter((r: any) => r.valide).length
      },
      message: " Contrôle terminé"
    });
  }
);

// GET /api/v1/embarquement/stats - Statistiques d'embarquement
router.get(
  "/stats",
  [
    body("startDate").optional().isISO8601().withMessage("Date de début invalide"),
    body("endDate").optional().isISO8601().withMessage("Date de fin invalide"),
    body("departureId").optional().isString().withMessage("ID départ invalide")
  ],
  validate,
  async (req: Request, res: Response) => {
    const { startDate, endDate, departureId } = req.query;

    // TODO: Statistiques d'embarquement sur une période
    // - Filtrer les embaragements par période
    // - Calculer le taux de validation global
    // - Identifier les billets non validés (no-show)
    // - Rapporter par départ, par contrôleur, par gare
    // - Détecter les tentatives de fraude ou d'embarquement multiple

    const mockStats = {
      période: {
        début: startDate || new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString(),
        fin: endDate || new Date().toISOString()
      },
      résumé: {
        totalEmbarquements: 2450,
        tauxValidation: 96.5,
        billetsNonValides: 85,
        fraudeDetectée: 3,
        parDépart: [
          { departureId: "dep-1", total: 120, valides: 115, taux: 95.8 },
          { departureId: "dep-2", total: 98, valides: 94, taux: 95.9 }
        ]
      }
    };

    res.json({
      success: true,
      data: mockStats
    });
  }
);

export default router;