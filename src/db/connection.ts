import { existsSync } from "fs";
import { resolve } from "path";
import { readFileSync } from "fs";
import { tmpdir } from "os";
import { writeFileSync } from "fs";
import { join } from "path";

export type DatabaseConnectionMode = "application" | "migration";

/**
 * Resolve Supabase CA certificate for database connections.
 * Supports two modes:
 *   - SUPABASE_DB_CA_CERT (raw PEM content) — used in serverless/Vercel where filesystem writes are ephemeral.
 *   - SUPABASE_DB_CA_CERT_PATH (file path) — used in local development and migrations.
 * Returns the absolute file path to be used with pg driver's sslrootcert parameter.
 */
function resolveCertificatePath(mode: DatabaseConnectionMode): string | undefined {
  // Priority 1: raw certificate content (Vercel/serverless friendly)
  const rawCert = process.env.SUPABASE_DB_CA_CERT;
  if (rawCert && rawCert.trim().length > 0) {
    const tmpCertPath = join(tmpdir(), `transora-ca-${Date.now()}.crt`);
    writeFileSync(tmpCertPath, rawCert.trim(), { mode: 0o600 });
    return tmpCertPath;
  }

  // Priority 2: certificate file path (local dev / migrations)
  const certPath = process.env.SUPABASE_DB_CA_CERT_PATH;
  if (certPath) {
    const absolute = resolve(certPath);
    if (!existsSync(absolute)) {
      if (mode === "migration") {
        throw new Error(`Certificat racine Supabase introuvable : ${absolute}`);
      }
      return undefined;
    }
    return absolute;
  }

  // For migrations without any certificate configured, throw a clear error
  if (mode === "migration") {
    throw new Error(
      "Télécharge le certificat racine dans Supabase > Settings > Database > SSL Configuration, " +
      "puis définis SUPABASE_DB_CA_CERT (contenu brut) ou SUPABASE_DB_CA_CERT_PATH (chemin) avant la migration."
    );
  }

  return undefined;
}

export function getDatabaseConnectionString(mode: DatabaseConnectionMode): string {
  const explicitUrl = mode === "application" ? process.env.DATABASE_URL : process.env.DIRECT_URL;
  let url: URL;
  if (explicitUrl) {
    url = new URL(explicitUrl);
  } else {
    const host = process.env.SUPABASE_DB_HOST;
    const user = process.env.SUPABASE_DB_USER;
    const password = process.env.SUPABASE_DB_PASSWORD;
    const database = process.env.SUPABASE_DB_NAME || "postgres";

    if (!host || !user || !password) {
      const requiredVariable = mode === "application" ? "DATABASE_URL" : "DIRECT_URL";
      throw new Error(
        `${requiredVariable} ou SUPABASE_DB_HOST, SUPABASE_DB_USER et SUPABASE_DB_PASSWORD doivent être configurés.`
      );
    }

    url = new URL("postgresql://");
    url.hostname = host;
    url.username = user;
    url.password = password;
    url.port = mode === "application"
      ? process.env.SUPABASE_POOLER_TRANSACTION_PORT || "6543"
      : process.env.SUPABASE_POOLER_SESSION_PORT || "5432";
    url.pathname = `/${database}`;
  }

  if (mode === "application") {
    url.searchParams.set("pgbouncer", "true");
  }

  const isLocalTestDatabase = process.env.NODE_ENV === "test" &&
    ["localhost", "127.0.0.1", "::1"].includes(url.hostname);

  // CI uses an isolated local PostgreSQL service, not Supabase TLS.
  if (isLocalTestDatabase && !process.env.SUPABASE_DB_CA_CERT && !process.env.SUPABASE_DB_CA_CERT_PATH) {
    url.searchParams.set("sslmode", "disable");
    url.searchParams.delete("sslrootcert");
    return url.toString();
  }

  const certPath = resolveCertificatePath(mode);
  if (certPath) {
    url.searchParams.set("sslmode", "verify-full");
    url.searchParams.set("sslrootcert", certPath);
  } else {
    url.searchParams.set("sslmode", "require");
  }

  return url.toString();
}
