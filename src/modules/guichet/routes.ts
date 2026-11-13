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

// POST /api/v1/guichet/session - Démarrer une session de caisse
router.post(
  "/session",
  [
    body("tenantId").notEmpty().withMessage("L'ID tenant est requis"),
    body("openingAmount").isFloat({ min: 0 }).withMessage("Le montant d'ouverture doit être >= 0"),
    body("openingCurrency").optional().default("FCFA").isString().withMessage("Devise invalide")
  ],
  validate,
  async (req: Request, res: Response) => {
    const { tenantId, openingAmount, openingCurrency = "FCFA" } = req.body;
    const session = {
      id: "session-123",
      tenantId,
      openingAmount,
      openingCurrency,
      currentAmount: openingAmount,
      status: "OPEN",
      openedAt: new Date().toISOString(),
      closedAt: null
    };
    res.status(201).json({
      success: true,
      data: session,
      message: "Session de caisse démarrée"
    });
  }
);

// POST /api/v1/guichet/operation - Enregistrer une opération de caisse
router.post(
  "/operation",
  [
    body("sessionId").notEmpty().withMessage("L'ID session est requis"),
    body("type").isIn(["vente", "remboursement", "ouverture", "fermeture", "rapprochement"]).withMessage("Type d'opération invalide"),
    body("amount").isFloat({ min: 0 }).withMessage("Le montant doit être >= 0"),
    body("paymentMethod").optional().isIn(["cash", "card", "mobile_money", "virement"]).withMessage("Moyen de paiement invalide"),
    body("description").optional().isString().withMessage("Description trop longue")
  ],
  validate,
  async (req: Request, res: Response) => {
    const { sessionId, type, amount, paymentMethod, description } = req.body;
    const operation = {
      id: "operation-123",
      sessionId,
      type,
      amount,
      paymentMethod: paymentMethod || "cash",
      description: description || "",
      executedAt: new Date().toISOString()
    };
    res.status(201).json({
      success: true,
      data: operation,
      message: "Opération de caisse enregistrée"
    });
  }
);

// GET /api/v1/guichet/session/:id - Obtenir le détail d'une session
router.get(
  "/session/:id",
  [
    param("id").notEmpty().withMessage("L'ID session est requis")
  ],
  validate,
  async (req: Request, res: Response) => {
    const { id } = req.params;
    const mockSession = {
      id,
      tenantId: "tenant-123",
      openingAmount: 50000,
      openingCurrency: "FCFA",
      currentAmount: 52500,
      status: "OPEN",
      openedAt: new Date().toISOString(),
      closedAt: null,
      operations: [
        { id: "op-1", type: "ouverture", amount: 50000, paymentMethod: "cash", executedAt: new Date().toISOString() },
        { id: "op-2", type: "vente", amount: 1500, paymentMethod: "mobile_money", executedAt: new Date().toISOString() }
      ]
    };
    const totalVentes = mockSession.operations.filter((op: any) => op.type === "vente").reduce((sum: any, op: any) => sum + op.amount, 0);
    res.json({
      success: true,
      data: {
        ...mockSession,
        totals: {
          totalVentes,
          currentBalance: mockSession.currentAmount - mockSession.openingAmount
        }
      }
    });
  }
);

export default router;