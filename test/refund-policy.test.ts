import { describe, expect, test } from "vitest";
import { calculateRefundableAmount } from "../src/modules/remboursement/routes";

describe("calcul des remboursements selon la politique figée du billet", () => {
  test("rembourse transport et frais compagnie à 100 %, sans frais plateforme", () => {
    expect(calculateRefundableAmount(10000, 500, { refundPolicy: "FULL", refundPercentage: 100 })).toBe(10500);
  });
  test("applique le pourcentage partiel à la base autorisée", () => {
    expect(calculateRefundableAmount(10000, 500, { refundPolicy: "PARTIAL", refundPercentage: 40 })).toBe(4200);
  });
  test("ne rembourse rien si la politique enregistrée indique NONE", () => {
    expect(calculateRefundableAmount(10000, 500, { refundPolicy: "NONE", refundPercentage: 0 })).toBe(0);
  });
  test("refuse un pourcentage invalide", () => {
    expect(calculateRefundableAmount(10000, 500, { refundPolicy: "PARTIAL", refundPercentage: 140 })).toBe(0);
  });
});
