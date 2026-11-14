import jwt, { JwtPayload, SignOptions } from "jsonwebtoken";

const getJwtIssuer = (): string => process.env.JWT_ISSUER || "transora-api";
const getJwtAudience = (): string => process.env.JWT_AUDIENCE || "transora-clients";
export const JWT_ACCESS_TOKEN_TTL = "15m";

const getJwtSecret = (): string => {
  const secret = process.env.JWT_SECRET;
  if (!secret || secret.length < 32) throw new Error("JWT_SECRET doit contenir au moins 32 caractères");
  return secret;
};

export interface AccessTokenClaims {
  id: string;
  email: string;
  role: string;
  tenantId: string;
  sessionId?: string;
}

export const createAccessToken = (user: AccessTokenClaims): string => {
  const options: SignOptions = {
    algorithm: "HS256", subject: user.id, issuer: getJwtIssuer(),
    audience: getJwtAudience(), expiresIn: JWT_ACCESS_TOKEN_TTL
  };
  return jwt.sign({
    email: user.email, role: user.role, tenantId: user.tenantId,
    ...(user.sessionId ? { sessionId: user.sessionId } : {})
  }, getJwtSecret(), options);
};

export const verifyAccessToken = (token: string): JwtPayload => {
  const payload = jwt.verify(token, getJwtSecret(), {
    algorithms: ["HS256"], issuer: getJwtIssuer(), audience: getJwtAudience(),
    maxAge: JWT_ACCESS_TOKEN_TTL, clockTolerance: 5
  });
  if (typeof payload === "string" || typeof payload.iat !== "number" ||
      typeof payload.exp !== "number" || payload.exp <= payload.iat) {
    throw new jwt.JsonWebTokenError("Token JWT incomplet ou invalide");
  }
  return payload;
};
