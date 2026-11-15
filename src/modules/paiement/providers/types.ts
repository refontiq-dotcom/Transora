export const paymentProviders = [
  "orange_money",
  "mtn_momo",
  "moov_money",
  "wave",
  "card",
  "bank_transfer"
] as const;

export type PaymentProvider = typeof paymentProviders[number];
export type PaymentEnvironment = "sandbox" | "live";
export type PaymentAttemptStatus =
  | "PENDING"
  | "PROCESSING"
  | "SUCCEEDED"
  | "FAILED"
  | "CANCELLED"
  | "EXPIRED"
  | "REFUNDED";

export interface PaymentAmount {
  currency: "XOF";
  transport: number;
  companyBookingFee: number;
  platformFee: number;
  total: number;
}

export interface CreateProviderCheckoutInput {
  tenantId: string;
  bookingId: string;
  attemptId: string;
  idempotencyKey: string;
  amount: PaymentAmount;
  customerPhone?: string;
  returnUrl: string;
}

export interface ProviderCheckoutResult {
  providerReference: string;
  checkoutUrl?: string;
  status: "PENDING" | "PROCESSING";
}

export interface VerifiedProviderEvent {
  providerEventId: string;
  providerReference: string;
  status: "SUCCEEDED" | "FAILED" | "CANCELLED" | "REFUNDED";
  occurredAt: Date;
}

export interface PaymentProviderAdapter {
  readonly provider: PaymentProvider;
  createCheckout(input: CreateProviderCheckoutInput): Promise<ProviderCheckoutResult>;
  verifyWebhook(rawBody: Buffer, headers: Record<string, string | string[] | undefined>):
    Promise<VerifiedProviderEvent>;
  getPaymentStatus(providerReference: string): Promise<VerifiedProviderEvent["status"] | "PENDING" | "PROCESSING">;
  refund(providerReference: string, amount: number, idempotencyKey: string): Promise<{ providerReference: string }>;
}
