import { existsSync } from "fs";
import { resolve } from "path";

export type DatabaseConnectionMode = "application" | "migration";

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

  const certificatePath = process.env.SUPABASE_DB_CA_CERT_PATH;
  if (!certificatePath && mode === "migration") {
    throw new Error(
      "Télécharge le certificat racine dans Supabase > Settings > Database > SSL Configuration, " +
      "puis définis SUPABASE_DB_CA_CERT_PATH dans .env avant la migration."
    );
  }

  if (certificatePath) {
    const absoluteCertificatePath = resolve(certificatePath);
    if (!existsSync(absoluteCertificatePath)) {
      if (mode === "migration") {
        throw new Error(`Certificat racine Supabase introuvable : ${absoluteCertificatePath}`);
      }
      url.searchParams.delete("sslrootcert");
      url.searchParams.set("sslmode", "require");
      return url.toString();
    }
    url.searchParams.set("sslmode", "verify-full");
    url.searchParams.set("sslrootcert", absoluteCertificatePath);
  } else {
    url.searchParams.set("sslmode", "require");
  }

  return url.toString();
}
