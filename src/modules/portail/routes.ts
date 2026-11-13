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

// POST /api/v1/portail/entreprise - Créer un portail entreprise
router.post(
  "/",
  [
    body("tenantId").notEmpty().withMessage("L'ID tenant est requis"),
    body("nomEntreprise").notEmpty().withMessage("Le nom de l'entreprise est requis"),
    body("siret").optional().isString().withMessage("Siret invalide"),
    body("logoUrl").optional().isString().withMessage("URL du logo invalide"),
    body("debutAbidential").optional().isISO8601().withMessage("Date de début invalide"),
    body("finAbidential").optional().isISO8601().withMessage("Date de fin invalide")
  ],
  validate,
  async (req: Request, res: Response) => {
    const { tenantId, nomEntreprise, siret, logoUrl, debutAbidential, finAbidential } = req.body;

    const portail = {
      id: "portail-123",
      tenantId,
      nomEntreprise,
      siret: siret || "à définir",
      logoUrl: logoUrl || "/images/default-logo.png",
      debutAbidential: debutAbidential ? new Date(debutAbidential) : new Date("2020-01-01"),
      finAbidential: finAbidential ? new Date(finAbidential) : new Date("2099-12-31"),
      crééLe: new Date().toISOString()
    };

    res.status(201).json({
      success: true,
      data: portail,
      message: "Portail entreprise créé avec succès"
    });
  }
);

// GET /api/v1/portail - Obtenir le portail entreprise
router.get(
  "/",
  [
    body("tenantId").optional().isString().withMessage("ID tenant invalide")
  ],
  validate,
  async (req: Request, res: Response) => {
    const { tenantId } = req.query;

    const portail = {
      id: "portail-123",
      tenantId: tenantId || "tenant-123",
      nomEntreprise: "Entreprise de transport exemple",
      siret: "12345678901234",
      logoUrl: "/images/logo-example.png",
      debutAbidential: new Date("2020-01-01"),
      finAbidential: new Date("2099-12-31"),
      fonctionnalités: ["lignes", "horaires", "tarifs", "réservations", "profil"],
      statut: "ACTIF"
    };

    res.json({
      success: true,
      data: portail
    });
  }
);

// GET /api/v1/portail/lignes - Lister les lignes du portail
router.get(
  "/lignes",
  [
    body("tenantId").optional().isString().withMessage("ID tenant invalide")
  ],
  validate,
  async (req: Request, res: Response) => {
    const { tenantId } = req.query;

    const lignes = [
      {
        id: "ligne-1",
        nom: "Ligne Abidjan-Bouaké",
        origine: "Abidjan",
        destination: "Bouaké",
        frequence: "Tous les 30 min",
        véhicule: "Bus Mercedes",
        capacite: 50
      },
      {
        id: "ligne-2",
        nom: "Ligne Abidjan-Korhogo",
        origine: "Abidjan",
        destination: "Korhogo",
        frequence: "Tous les heures",
        véhicule: "Bus Volvo",
        capacite: 50
      }
    ];

    res.json({
      success: true,
      data: { lignes, tenantId }
    });
  }
);

// GET /api/v1/portail/tarifs - Obtenir les tarifs du portail
router.get(
  "/tarifs",
  [
    body("tenantId").optional().isString().withMessage("ID tenant invalide")
  ],
  validate,
  async (req: Request, res: Response) => {
    const { tenantId } = req.query;

    const tarifs = {
      trajetAbidjanBouake: 7500,
      trajetAbidjanKorhogo: 12000,
      tarifEnfant: 4000,
      tarifGroupe: { minimum: 10, tarifUnitaire: 6500, réduction: 0.15 },
      fraisTransora: 100
    };

    res.json({
      success: true,
      data: { tarifs, tenantId }
    });
  }
);

export default router;