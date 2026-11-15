import type { PaymentAttemptStatus } from "./types";

const allowedTransitions: Record<PaymentAttemptStatus, readonly PaymentAttemptStatus[]> = {
  PENDING: ["PROCESSING", "SUCCEEDED", "FAILED", "CANCELLED", "EXPIRED"],
  PROCESSING: ["SUCCEEDED", "FAILED", "CANCELLED", "EXPIRED"],
  SUCCEEDED: ["REFUNDED"],
  FAILED: [],
  CANCELLED: [],
  EXPIRED: [],
  REFUNDED: []
};

export const canTransitionPaymentStatus = (
  current: PaymentAttemptStatus,
  next: PaymentAttemptStatus
): boolean => current === next || allowedTransitions[current].includes(next);

export const transitionPaymentStatus = (
  current: PaymentAttemptStatus,
  next: PaymentAttemptStatus
): PaymentAttemptStatus => {
  if (!canTransitionPaymentStatus(current, next)) {
    throw new Error(`Transition de paiement interdite : ${current} -> ${next}`);
  }
  return next;
};
