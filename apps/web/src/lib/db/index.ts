import { mkdirSync } from "fs";
import path from "path";

import { PGlite } from "@electric-sql/pglite";
import { drizzle as drizzlePglite } from "drizzle-orm/pglite";
import { drizzle as drizzlePostgres } from "drizzle-orm/postgres-js";
import postgres from "postgres";

import * as schema from "./schema";
import { applySchemaWith } from "./sql";

type AppDb =
  | ReturnType<typeof drizzlePostgres<typeof schema>>
  | ReturnType<typeof drizzlePglite<typeof schema>>;

const globalForDb = globalThis as unknown as {
  kaiSql?: ReturnType<typeof postgres>;
  kaiPglite?: PGlite;
  kaiDb?: AppDb;
  kaiDbMode?: "postgres" | "pglite";
};

function dataDir() {
  const dir = path.join(process.cwd(), ".data");
  mkdirSync(dir, { recursive: true });
  return dir;
}

export function getDbMode(): "postgres" | "pglite" {
  const url = process.env.DATABASE_URL ?? "";
  // Vercel/serverless cannot use embedded PGlite as a durable DB.
  if (process.env.VERCEL || process.env.NODE_ENV === "production") {
    if (!url || url === "pglite" || url.startsWith("pglite:")) {
      return "postgres";
    }
  }
  if (!url || url.startsWith("pglite:") || url === "pglite") return "pglite";
  return "postgres";
}

export function getDb() {
  const mode = getDbMode();
  if (globalForDb.kaiDb && globalForDb.kaiDbMode === mode) {
    return globalForDb.kaiDb;
  }

  if (mode === "pglite") {
    const file = path.join(dataDir(), "kai-pglite");
    if (!globalForDb.kaiPglite) {
      globalForDb.kaiPglite = new PGlite(file);
    }
    globalForDb.kaiDb = drizzlePglite(globalForDb.kaiPglite, { schema });
    globalForDb.kaiDbMode = "pglite";
    return globalForDb.kaiDb;
  }

  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not configured.");
  if (!globalForDb.kaiSql) {
    globalForDb.kaiSql = postgres(url, { max: 10 });
  }
  globalForDb.kaiDb = drizzlePostgres(globalForDb.kaiSql, { schema });
  globalForDb.kaiDbMode = "postgres";
  return globalForDb.kaiDb;
}

let schemaReady: Promise<void> | null = null;

async function applySchema() {
  if (getDbMode() === "pglite") {
    getDb();
    const client = globalForDb.kaiPglite!;
    await applySchemaWith((statement) => client.exec(statement));
    return;
  }

  getDb();
  const sql = globalForDb.kaiSql!;
  await sql`CREATE EXTENSION IF NOT EXISTS pgcrypto`;
  await applySchemaWith((statement) => sql.unsafe(statement));
}

export async function ensureSchema() {
  if (!schemaReady) {
    schemaReady = applySchema().catch((error) => {
      schemaReady = null;
      throw error;
    });
  }
  return schemaReady;
}

export async function checkDbHealth() {
  try {
    const url = process.env.DATABASE_URL ?? "";
    if (
      (process.env.VERCEL || process.env.NODE_ENV === "production") &&
      (!url || url === "pglite" || url.startsWith("pglite:"))
    ) {
      return {
        ok: false as const,
        mode: "postgres" as const,
        error: "DATABASE_URL is not set for production (use Neon/Postgres).",
      };
    }

    if (getDbMode() === "pglite") {
      await ensureSchema();
      const client =
        globalForDb.kaiPglite ?? new PGlite(path.join(dataDir(), "kai-pglite"));
      await client.query("select 1");
      return { ok: true as const, mode: "pglite" as const };
    }
    const sql =
      globalForDb.kaiSql ?? postgres(process.env.DATABASE_URL!, { max: 1 });
    await sql`select 1`;
    if (!globalForDb.kaiSql) await sql.end({ timeout: 1 });
    return { ok: true as const, mode: "postgres" as const };
  } catch (error) {
    return {
      ok: false as const,
      mode: getDbMode(),
      error: error instanceof Error ? error.message : "Database unreachable",
    };
  }
}
