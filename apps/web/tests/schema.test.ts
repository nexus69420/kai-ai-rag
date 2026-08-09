import { PGlite } from "@electric-sql/pglite";
import { beforeAll, describe, expect, it } from "vitest";

import {
  applySchemaWith,
  indexesOnly,
  MIGRATION_SQL,
  SCHEMA_SQL,
  stripIndexes,
} from "../src/lib/db/sql";

/**
 * The schema is applied on every boot rather than by a migration runner, so a
 * typo or an ordering mistake would surface as a runtime failure on the first
 * request. These run the real statements against a throwaway PGlite instance.
 */
describe("schema SQL", () => {
  let db: PGlite;

  beforeAll(async () => {
    db = new PGlite();
    await applySchemaWith((statement) => db.exec(statement));
  }, 60_000);

  async function columnsOf(table: string) {
    const result = await db.query<{ column_name: string }>(
      `select column_name from information_schema.columns where table_name = $1`,
      [table],
    );
    return result.rows.map((row) => row.column_name);
  }

  it("creates every table the app queries", async () => {
    const result = await db.query<{ table_name: string }>(
      `select table_name from information_schema.tables where table_schema = 'public'`,
    );
    const tables = result.rows.map((row) => row.table_name);
    expect(tables).toEqual(
      expect.arrayContaining([
        "documents",
        "chunks",
        "chats",
        "messages",
        "eval_runs",
      ]),
    );
  });

  it("adds the provenance columns ingest depends on", async () => {
    expect(await columnsOf("documents")).toEqual(
      expect.arrayContaining([
        "source_type",
        "chunk_strategy",
        "embedding_model",
        "page_count",
        "duplicate_chunks",
        "processed_sections",
      ]),
    );
    expect(await columnsOf("chunks")).toEqual(
      expect.arrayContaining([
        "heading",
        "chunk_strategy",
        "char_count",
        "content_hash",
      ]),
    );
  });

  it("adds the answer-quality columns the chat route writes", async () => {
    expect(await columnsOf("messages")).toEqual(
      expect.arrayContaining([
        "retrieval_mode",
        "retrieval_stats",
        "citations",
        "confidence",
        "abstained",
      ]),
    );
  });

  it("creates the dedup index, which covers a migrated column", async () => {
    const result = await db.query<{ indexname: string }>(
      `select indexname from pg_indexes where tablename = 'chunks'`,
    );
    expect(result.rows.map((row) => row.indexname)).toContain(
      "chunks_hash_idx",
    );
  });

  it("is idempotent, since it reruns on every boot", async () => {
    await expect(
      applySchemaWith((statement) => db.exec(statement)),
    ).resolves.toBeUndefined();

    // Also assert the raw statements, not just the wrapper's error handling.
    await db.exec(stripIndexes(SCHEMA_SQL));
    for (const statement of MIGRATION_SQL) {
      await db.exec(statement);
    }
    await db.exec(indexesOnly(SCHEMA_SQL));
  }, 60_000);

  it("cascades chunk deletes from their document", async () => {
    await db.exec(`
      insert into documents (id, guest_id, filename)
      values ('11111111-1111-1111-1111-111111111111', 'g1', 'runbook.md');
      insert into chunks (id, document_id, guest_id, chunk_index, text)
      values ('22222222-2222-2222-2222-222222222222',
              '11111111-1111-1111-1111-111111111111', 'g1', 0, 'body');
      delete from documents where id = '11111111-1111-1111-1111-111111111111';
    `);

    const remaining = await db.query<{ count: string }>(
      `select count(*)::text as count from chunks`,
    );
    expect(remaining.rows[0].count).toBe("0");
  });
});
