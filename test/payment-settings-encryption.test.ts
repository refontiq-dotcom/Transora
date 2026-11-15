import { afterEach, describe, expect, test } from "vitest";
import { decryptPaymentCredentials, encryptPaymentCredentials } from "../src/modules/paiement/settings.routes";

const previousKey = process.env.PAYMENT_CREDENTIALS_ENCRYPTION_KEY;
const testKey = Buffer.from("transora-payment-encryption-key-32").toString("base64");

afterEach(() => {
  if (previousKey === undefined) delete process.env.PAYMENT_CREDENTIALS_ENCRYPTION_KEY;
  else process.env.PAYMENT_CREDENTIALS_ENCRYPTION_KEY = previousKey;
});

describe("chiffrement des identifiants marchands", () => {
  test("chiffre puis déchiffre les identifiants sans les stocker en clair", () => {
    process.env.PAYMENT_CREDENTIALS_ENCRYPTION_KEY = testKey;
    const credentials = { apiKey: "secret-api-key", merchantSecret: "very-secret" };
    const encrypted = encryptPaymentCredentials(credentials);
    expect(encrypted.toString("utf8")).not.toContain("secret-api-key");
    expect(decryptPaymentCredentials(encrypted)).toEqual(credentials);
  });

  test("rejette une donnée chiffrée altérée", () => {
    process.env.PAYMENT_CREDENTIALS_ENCRYPTION_KEY = testKey;
    const encrypted = encryptPaymentCredentials({ token: "sensitive" });
    encrypted[encrypted.length - 1] ^= 1;
    expect(() => decryptPaymentCredentials(encrypted)).toThrow();
  });

  test("refuse une clé de chiffrement absente ou de mauvaise taille", () => {
    delete process.env.PAYMENT_CREDENTIALS_ENCRYPTION_KEY;
    expect(() => encryptPaymentCredentials({ token: "sensitive" })).toThrow();
    process.env.PAYMENT_CREDENTIALS_ENCRYPTION_KEY = Buffer.from("too-short").toString("base64");
    expect(() => encryptPaymentCredentials({ token: "sensitive" })).toThrow();
  });
});
