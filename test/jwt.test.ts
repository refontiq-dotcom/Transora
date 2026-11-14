import jwt from "jsonwebtoken";
import { afterEach, describe, expect, it } from "vitest";
import { createAccessToken, verifyAccessToken } from "../src/lib/jwt";

const secret = "transora-jwt-test-secret-at-least-32-characters";
const user = {
  id: "550e8400-e29b-41d4-a716-446655440002",
  email: "jwt@example.test",
  role: "administrateur",
  tenantId: "550e8400-e29b-41d4-a716-446655440001"
};

const previous = {
  secret: process.env.JWT_SECRET,
  issuer: process.env.JWT_ISSUER,
  audience: process.env.JWT_AUDIENCE
};

afterEach(() => {
  if (previous.secret === undefined) delete process.env.JWT_SECRET;
  else process.env.JWT_SECRET = previous.secret;
  if (previous.issuer === undefined) delete process.env.JWT_ISSUER;
  else process.env.JWT_ISSUER = previous.issuer;
  if (previous.audience === undefined) delete process.env.JWT_AUDIENCE;
  else process.env.JWT_AUDIENCE = previous.audience;
});

describe("JWT access token security", () => {
  it("creates and verifies an HS256 token with issuer, audience and an eight-hour expiry", () => {
    process.env.JWT_SECRET = secret;
    process.env.JWT_ISSUER = "transora-api";
    process.env.JWT_AUDIENCE = "transora-clients";

    const token = createAccessToken(user);
    const payload = verifyAccessToken(token);

    expect(payload.sub).toBe(user.id);
    expect(payload.iss).toBe("transora-api");
    expect(payload.aud).toBe("transora-clients");
    expect(payload.exp).toBeTypeOf("number");
    expect(payload.iat).toBeTypeOf("number");
    expect((payload.exp as number) - (payload.iat as number)).toBe(8 * 60 * 60);
  });

  it("rejects tokens signed with a different algorithm", () => {
    process.env.JWT_SECRET = secret;
    const token = jwt.sign(
      { email: user.email, role: user.role, tenantId: user.tenantId },
      secret,
      { algorithm: "HS384", subject: user.id, issuer: "transora-api", audience: "transora-clients", expiresIn: "8h" }
    );
    expect(() => verifyAccessToken(token)).toThrow();
  });

  it("rejects a token with the wrong issuer", () => {
    process.env.JWT_SECRET = secret;
    const token = jwt.sign(
      { email: user.email, role: user.role, tenantId: user.tenantId },
      secret,
      { algorithm: "HS256", subject: user.id, issuer: "untrusted-issuer", audience: "transora-clients", expiresIn: "8h" }
    );
    expect(() => verifyAccessToken(token)).toThrow();
  });

  it("rejects a token with the wrong audience", () => {
    process.env.JWT_SECRET = secret;
    const token = jwt.sign(
      { email: user.email, role: user.role, tenantId: user.tenantId },
      secret,
      { algorithm: "HS256", subject: user.id, issuer: "transora-api", audience: "untrusted-client", expiresIn: "8h" }
    );
    expect(() => verifyAccessToken(token)).toThrow();
  });

  it("rejects tokens without expiration and issued-at claims", () => {
    process.env.JWT_SECRET = secret;
    const token = jwt.sign(
      { email: user.email, role: user.role, tenantId: user.tenantId },
      secret,
      { algorithm: "HS256", subject: user.id, issuer: "transora-api", audience: "transora-clients", noTimestamp: true }
    );
    expect(() => verifyAccessToken(token)).toThrow();
  });

  it("rejects a weak signing secret", () => {
    process.env.JWT_SECRET = "short-secret";
    expect(() => createAccessToken(user)).toThrow(/32 caractères/);
  });
});
