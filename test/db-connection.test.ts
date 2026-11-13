import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, test } from "vitest";
import { getDatabaseConnectionString } from "../src/db/connection";

const variableNames = [
  "DATABASE_URL",
  "DIRECT_URL",
  "SUPABASE_DB_HOST",
  "SUPABASE_DB_USER",
  "SUPABASE_DB_PASSWORD",
  "SUPABASE_DB_NAME",
  "SUPABASE_DB_CA_CERT_PATH",
  "SUPABASE_POOLER_TRANSACTION_PORT",
  "SUPABASE_POOLER_SESSION_PORT"
] as const;

const originalValues = new Map(variableNames.map((name) => [name, process.env[name]]));

afterEach(() => {
  for (const name of variableNames) {
    const value = originalValues.get(name);
    if (value === undefined) {
      delete process.env[name];
    } else {
      process.env[name] = value;
    }
  }
});

test("builds an encoded transaction-pooler URL for the application", () => {
  const certDir = mkdtempSync(join(tmpdir(), "transora-ca-"));
  const certPath = join(certDir, "supabase-ca.crt");
  writeFileSync(certPath, "test certificate");
  delete process.env.DATABASE_URL;
  delete process.env.DIRECT_URL;
  process.env.SUPABASE_DB_HOST = "aws-0-eu-west-3.pooler.supabase.com";
  process.env.SUPABASE_DB_USER = "postgres.project";
  process.env.SUPABASE_DB_PASSWORD = "pa:ss@word";
  process.env.SUPABASE_DB_CA_CERT_PATH = certPath;

  const url = new URL(getDatabaseConnectionString("application"));

  expect(url.hostname).toBe( "aws-0-eu-west-3.pooler.supabase.com");
  expect(url.username).toBe( "postgres.project");
  expect(decodeURIComponent(url.password)).toBe( "pa:ss@word");
  expect(url.port).toBe( "6543");
  expect(url.searchParams.get("pgbouncer")).toBe( "true");
  expect(url.searchParams.get("sslmode")).toBe( "verify-full");
  expect(url.searchParams.get("sslrootcert")).toBe( certPath);
  rmSync(certDir, { recursive: true, force: true });
});

test("builds a session-pooler URL for migrations", () => {
  const certDir = mkdtempSync(join(tmpdir(), "transora-ca-"));
  const certPath = join(certDir, "supabase-ca.crt");
  writeFileSync(certPath, "test certificate");
  delete process.env.DATABASE_URL;
  delete process.env.DIRECT_URL;
  process.env.SUPABASE_DB_HOST = "aws-0-eu-west-3.pooler.supabase.com";
  process.env.SUPABASE_DB_USER = "postgres.project";
  process.env.SUPABASE_DB_PASSWORD = "secret";
  process.env.SUPABASE_DB_CA_CERT_PATH = certPath;

  const url = new URL(getDatabaseConnectionString("migration"));

  expect(url.port).toBe( "5432");
  expect(url.searchParams.get("pgbouncer")).toBe( null);
  expect(url.searchParams.get("sslmode")).toBe( "verify-full");
  expect(url.searchParams.get("sslrootcert")).toBe( certPath);
  rmSync(certDir, { recursive: true, force: true });
});
