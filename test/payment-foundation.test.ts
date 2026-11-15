import { describe, expect, test } from "vitest";
import { canTransitionPaymentStatus, transitionPaymentStatus } from "../src/modules/paiement/providers/status";
import { paymentProviders } from "../src/modules/paiement/providers/types";

describe("socle paiement multi-compagnies", () => {
  test("déclare les moyens de paiement prévus sans activer de prestataire", () => {
    expect(paymentProviders).toEqual([
      "orange_money", "mtn_momo", "moov_money", "wave", "card", "bank_transfer"
    ]);
  });

  test("autorise une confirmation unique et idempotente", () => {
    expect(transitionPaymentStatus("PENDING", "SUCCEEDED")).toBe("SUCCEEDED");
    expect(transitionPaymentStatus("SUCCEEDED", "SUCCEEDED")).toBe("SUCCEEDED");
  });

  test("permet plusieurs états intermédiaires et une annulation", () => {
    expect(canTransitionPaymentStatus("PENDING", "PROCESSING")).toBe(true);
    expect(canTransitionPaymentStatus("PROCESSING", "CANCELLED")).toBe(true);
    expect(canTransitionPaymentStatus("FAILED", "PROCESSING")).toBe(false);
  });

  test("interdit de transformer un paiement échoué ou remboursé en paiement réussi", () => {
    expect(canTransitionPaymentStatus("FAILED", "SUCCEEDED")).toBe(false);
    expect(canTransitionPaymentStatus("REFUNDED", "SUCCEEDED")).toBe(false);
    expect(() => transitionPaymentStatus("REFUNDED", "SUCCEEDED")).toThrow();
  });

  test("n'autorise le remboursement qu'après un paiement réussi", () => {
    expect(canTransitionPaymentStatus("SUCCEEDED", "REFUNDED")).toBe(true);
    expect(canTransitionPaymentStatus("PENDING", "REFUNDED")).toBe(false);
  });
});
