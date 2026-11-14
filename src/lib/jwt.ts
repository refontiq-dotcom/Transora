import jwt, { JwtPayload, SignOptions } from "jsonwebtoken";

export const JWT_ISSUER = process.env.JWT_ISSUER || "transora-api";
export const JWT_AUDIENCE = process.env.JWT_AUDIENCE || "transora-clients";
export const JWT_ACCESS_TOKEN_TTL = "8h";

const getJwtSecret = (): string => {
  const secret = process.env.JWT_SECRET;
  if (!secret || secret.length < 32) {
    throw new Error("JWT_SECRET doit contenir au moins 32 caractères");
  }
  return secret;
};

export interface AccessTokenClaims {
  id: string;
  email: string;
  role: string;
  tenantId: string;
}

export const createAccessToken = (user: AccessTokenClaims): string => {
  const options: SignOptions = {
    algorithm: "HS256",
    subject: user.id,
    issuer: JWT_ISSUER,
    audience: JWT_AUDIENCE,
    expiresIn: JWT_ACCESS_TOKEN_TTL
  };

  return jwt.sign(
    { email: user.email, role: user.role, tenantId: user.tenantId },
    getJwtSecret(),
    options
  );
};

export const verifyAccessToken = (token: string): JwtPayload => {
  const payload = jwt.verify(token, getJwtSecret(), {
    algorithms: ["HS256"],
    issuer: JWT_ISSUER,
    audience: JWT_AUDIENCE,
    maxAge: JWT_ACCESS_TOKEN_TTL,
    clockTolerance: 5
  });

  if (
    typeof payload === "string" ||
    typeof payload.iat !== "number" ||
    typeof payload.exp !== "number" ||
    payload.exp <= payload.iat
  ) {
    throw new jwt.JsonWebTokenError("Token JWT incomplet ou invalide");
  }

  return payload;
};
