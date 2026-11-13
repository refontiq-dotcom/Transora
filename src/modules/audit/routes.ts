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

// POST /api/v1/audit - Enregistrer un événement d'audit
router.post(
  "/evenement",
  [
    body("tenantId").notEmpty().withMessage("L'ID tenant est requis"),
    body("type").isIn(["création", "modification", "suppression", "connexion", "déconnexion", "transfert", "paiement"]).withMessage("Type d'événement invalide"),
    body("sujet").notEmpty().withMessage("Le sujet est requis"),
    body("action").notEmpty().withMessage("L'action est requise"),
    body("details").optional().isObject().withMessage("Les détails doivent être un objet")
  ],
  validate,
  async (req: Request, res: Response) => {
    const { tenantId, type, sujet, action, details } = req.body;

    const evenementAudit = {
      id: "audit-" + Date.now(),
      tenantId,
      type,
      sujet,
      action,
      details: details || {},
      horodatage: new Date().toISOString(),
      utilisateur: "system"
    };

    res.status(201).json({
      success: true,
      data: evenementAudit,
      message: "Événement d'audit enregistré avec succès"
    });
  }
);

// GET /api/v1/audit - Lister les événements d'audit
router.get(
  "/",
  [
    body("tenantId").optional().isString().withMessage("ID tenant invalide"),
    body("type").optional().isString().withMessage("Type invalide"),
    body("dateDébut").optional().isISO8601().withMessage("Date de début invalide"),
    body("dateFin").optional().isISO8601().withMessage("Date de fin invalide")
  ],
  validate,
  async (req: Request, res: Response) => {
    const { tenantId, type, dateDébut, dateFin } = req.query;

    const événements = [
      {
        id: "aud-1",
        tenantId: tenantId || "tenant-123",
        type: "création",
        sujet: "nouveau départ",
        action: "CREATE",
        détails: { départId: "dep-1" },
        horodatage: new Date(Date.now() - 1 * 24 * 60 * 60 * 1000).toISOString()
      },
      {
        id: "aud-2",
        tenantId: tenantId || "tenant-123",
        type: "modification",
        sujet: "mise à jour billet",
        action: "UPDATE",
        détails: { billetId: "bil-1", changement: "siège" },
        horodatage: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString()
      }
    ];

    res.json({
      success: true,
      data: { événements, filtres: { tenantId, type, dateDébut, dateFin } }
    });
  }
);

// GET /api/v1/audit/rapport - Rapport d'audit
router.get(
  "/rapport",
  [
    body("tenantId").optional().isString().withMessage("ID tenant invalide"),
    body("dateDébut").optional().isISO8601().withMessage("Date de début invalide"),
    body("dateFin").optional().isISO8601().withMessage("Date de fin invalide")
  ],
  validate,
  async (req: Request, res: Response) => {
    const { tenantId, dateDébut, dateFin } = req.query;

    const rapportAudit = {
      tenantId,
      période: {
        début: dateDébut || new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString(),
        fin: dateFin || new Date().toISOString()
      },
      résumé: {
        totalÉvénements: 156,
        parType: {
          création: 45,
          modification: 67,
          suppression: 12,
          connexion: 21,
          déconnexion: 11
        },
        événementsCritiques: 8,
        violationsSécurité: 0
      },
      topUtilisateurs: [
        { utilisateur: "admin-1", événements: 23 },
        { utilisateur: "agent-1", événements: 15 }
      ]
    };

    res.json({
      success: true,
      data: rapportAudit
    });
  }
);

// POST /api/v1/audit/anti-fraude - Détecter activité frauduleuse
router.post(
  "/anti-fraude",
  [
    body("tenantId").notEmpty().withMessage("L'ID tenant est requis"),
    body("analyse").isObject().withMessage("L'analyse doit être un objet"),
    body("analyse.suspiciousActivities").optional().isArray().withMessage("Activités suspectes doit être un tableau"),
    body("analyse.seatsConflict").optional().isBoolean().withMessage("Conflit de siège doit être un booléen")
  ],
  validate,
  async (req: Request, res: Response) => {
    const { tenantId, analyse } = req.body;

    const fraudeDétectée = {
      tenantId,
      analyseEffectuée: new Date().toISOString(),
      activitésSuspectes: analyse.suspiciousActivities || [],
      conflitsSiège: analyse.seatsConflict || false,
      scoreDeFraude: Math.random() > 0.5 ? "élevé" : "faible",
      recommandations: [
        "Vérifier les réservations multiples du même siège",
        "Contrôler les paiements en double",
        "Auditer les modifications récentes de billet"
      ]
    };

    res.json({
      success: true,
      data: fraudeDétectée
    });
  }
);

export default router;