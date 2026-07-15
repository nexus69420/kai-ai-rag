import { mkdirSync } from "fs";
import path from "path";

import { PGlite } from "@electric-sql/pglite";
import { drizzle as drizzlePglite } from "drizzle-orm/pglite";
import { drizzle as drizzlePostgres } from "drizzle-orm/postgres-js";
import postgres from "postgres";

import * as schema from "./schema";

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

export async function ensureSchema() {
  const mode = getDbMode();
  if (mode === "pglite") {
    const db = getDb() as ReturnType<typeof drizzlePglite>;
    // PGlite executes via client
    const client = globalForDb.kaiPglite!;
    await client.exec(`
      CREATE TABLE IF NOT EXISTS documents (
        id uuid PRIMARY KEY,
        guest_id varchar(64) NOT NULL,
        filename text NOT NULL,
        chunk_count integer NOT NULL DEFAULT 0,
        status varchar(32) NOT NULL DEFAULT 'processing',
        storage_path text,
        created_at timestamptz NOT NULL DEFAULT now()
      );
      CREATE TABLE IF NOT EXISTS chunks (
        id uuid PRIMARY KEY,
        document_id uuid NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
        guest_id varchar(64) NOT NULL,
        chunk_index integer NOT NULL,
        page integer NOT NULL DEFAULT 1,
        text text NOT NULL,
        created_at timestamptz NOT NULL DEFAULT now()
      );
      CREATE TABLE IF NOT EXISTS chats (
        id uuid PRIMARY KEY,
        guest_id varchar(64) NOT NULL,
        title text NOT NULL DEFAULT 'New chat',
        document_id uuid REFERENCES documents(id) ON DELETE SET NULL,
        document_ids jsonb DEFAULT '[]'::jsonb,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now()
      );
      CREATE TABLE IF NOT EXISTS messages (
        id uuid PRIMARY KEY,
        chat_id uuid NOT NULL REFERENCES chats(id) ON DELETE CASCADE,
        role varchar(16) NOT NULL,
        content text NOT NULL,
        sources jsonb DEFAULT '[]'::jsonb,
        created_at timestamptz NOT NULL DEFAULT now()
      );
    `);
    // Migrate older local DBs that predate document_ids.
    try {
      await client.exec(
        `ALTER TABLE chats ADD COLUMN IF NOT EXISTS document_ids jsonb DEFAULT '[]'::jsonb`,
      );
    } catch {
      // ignore if already present / unsupported
    }
    void db;
    return;
  }
}

export async function checkDbHealth() {
  try {
    if (getDbMode() === "pglite") {
      await ensureSchema();
      const client = globalForDb.kaiPglite ?? new PGlite(path.join(dataDir(), "kai-pglite"));
      await client.query("select 1");
      return { ok: true as const, mode: "pglite" as const };
    }
    const sql = globalForDb.kaiSql ?? postgres(process.env.DATABASE_URL!, { max: 1 });
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
