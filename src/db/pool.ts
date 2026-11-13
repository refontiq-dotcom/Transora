import { Pool } from "pg";
import dotenv from "dotenv";
import { getDatabaseConnectionString } from "./connection";

dotenv.config();

const hasConnectionConfiguration = Boolean(
  process.env.DATABASE_URL ||
  process.env.SUPABASE_DB_HOST &&
  process.env.SUPABASE_DB_USER &&
  process.env.SUPABASE_DB_PASSWORD
);

export const pool = new Pool({
  connectionString: hasConnectionConfiguration
    ? getDatabaseConnectionString("application")
    : undefined,
  max: 10,
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 5_000
});

pool.on("error", (error) => {
  console.error("Erreur inattendue sur une connexion PostgreSQL inactive:", error);
});
