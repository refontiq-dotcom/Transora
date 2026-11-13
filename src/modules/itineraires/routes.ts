import { Router, Request, Response } from "express";
import { body, param, query, validationResult } from "express-validator";

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

// POST /api/v1/itineraires/rechercher - Rechercher des itinéraires
router.post(
  "/rechercher",
  [
    body("tenantId").notEmpty().withMessage("L'ID tenant est requis"),
    body("origine").notEmpty().withMessage("L'origine est requise"),
    body("destination").notEmpty().withMessage("La destination est requise"),
    body("date").optional().isISO8601().withMessage("La date doit être au format ISO"),
    body("passagers").optional().isInt({ min: 1 }).withMessage("Le nombre de passagers doit être >= 1")
  ],
  validate,
  async (req: Request, res: Response) => {
    const { tenantId, origine, destination, date, passagers } = req.body;

    const itinerairePossible = {
      id: "itineraire-123",
      origine,
      destination,
      trajets: [
        {
          id: "trajet-1",
          segments: ["Abidjan-Bouaké", "Bouaké-Katiola"],
          dureeTotale: "4h 30min",
          correspondances: [],
          prixTotal: 8500
        }
      ],
      correspondancesPossibles: [],
      remark: "Itinéraire direct disponible"
    };

    res.json({
      success: true,
      data: itinerairePossible,
      message: "Itinéraires recherchés avec succès"
    });
  }
);

export default router;