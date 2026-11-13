import dotenv from "dotenv";
import { readdir, readFile } from "fs/promises";
import { resolve } from "path";
import { Pool } from "pg";
import { getDatabaseConnectionString } from "./connection";

dotenv.config();

async function migrate(): Promise<void> {
  const connectionString = getDatabaseConnectionString("migration");
  const migrationPool = new Pool({ connectionString, connectionTimeoutMillis: 5_000 });
  try {
    const migrationsDirectory = resolve(__dirname, "../../migrations");
    const migrations = (await readdir(migrationsDirectory))
      .filter((file) => /^\d+_.+\.sql$/.test(file))
      .sort();
    await migrationPool.query(
      `CREATE TABLE IF NOT EXISTS schema_migrations (
         version TEXT PRIMARY KEY,
         applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
       )`
    );

    for (const migrationName of migrations) {
      const client = await migrationPool.connect();
      try {
        await client.query("BEGIN");
        await client.query("SELECT pg_advisory_xact_lock(hashtext('transora:migrations'))");
        const alreadyApplied = await client.query(
          "SELECT 1 FROM schema_migrations WHERE version = $1",
          [migrationName]
        );
        if (alreadyApplied.rowCount) {
          await client.query("COMMIT");
          continue;
        }

        const migration = await readFile(resolve(migrationsDirectory, migrationName), "utf8");
        await client.query(migration);
        await client.query("INSERT INTO schema_migrations (version) VALUES ($1)", [migrationName]);
        await client.query("COMMIT");
        console.log(`Migration PostgreSQL appliquée : ${migrationName}`);
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      } finally {
        client.release();
      }
    }
  } finally {
    await migrationPool.end();
  }
}

migrate()
  .catch((error: unknown) => {
    console.error("Échec de la migration PostgreSQL:", error);
    process.exitCode = 1;
  });
