/**
 * The schema as executable SQL, kept separate from the connection singletons so
 * it can be applied to a throwaway database in tests. Every statement is
 * idempotent: the same list runs on every boot for both PGlite and Postgres.
 */
export const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS documents (
  id uuid PRIMARY KEY,
  guest_id varchar(64) NOT NULL,
  filename text NOT NULL,
  chunk_count integer NOT NULL DEFAULT 0,
  status varchar(32) NOT NULL DEFAULT 'processing',
  storage_path text,
  file_bytes text,
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
CREATE TABLE IF NOT EXISTS eval_runs (
  id uuid PRIMARY KEY,
  label text NOT NULL,
  chunk_strategy varchar(24) NOT NULL,
  retrieval_mode varchar(16) NOT NULL,
  case_count integer NOT NULL DEFAULT 0,
  correctness real NOT NULL DEFAULT 0,
  faithfulness real NOT NULL DEFAULT 0,
  retrieval_recall real NOT NULL DEFAULT 0,
  citation_accuracy real NOT NULL DEFAULT 0,
  report jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS chunks_guest_idx ON chunks (guest_id);
CREATE INDEX IF NOT EXISTS chunks_document_idx ON chunks (document_id, chunk_index);
CREATE INDEX IF NOT EXISTS chunks_hash_idx ON chunks (guest_id, content_hash);
CREATE INDEX IF NOT EXISTS documents_guest_idx ON documents (guest_id, created_at DESC);
CREATE INDEX IF NOT EXISTS messages_chat_idx ON messages (chat_id, created_at);
`;

/**
 * Additive column migrations. Plain `ADD COLUMN IF NOT EXISTS` statements so the
 * same list works for PGlite and Postgres without a migration runner in the
 * request path, and so an older database catches up on boot.
 */
export const MIGRATION_SQL = [
  `ALTER TABLE chats ADD COLUMN IF NOT EXISTS document_ids jsonb DEFAULT '[]'::jsonb`,
  `ALTER TABLE documents ADD COLUMN IF NOT EXISTS file_bytes text`,
  `ALTER TABLE documents ADD COLUMN IF NOT EXISTS source_type varchar(16) NOT NULL DEFAULT 'pdf'`,
  `ALTER TABLE documents ADD COLUMN IF NOT EXISTS chunk_strategy varchar(24) NOT NULL DEFAULT 'structural'`,
  `ALTER TABLE documents ADD COLUMN IF NOT EXISTS embedding_model varchar(64)`,
  `ALTER TABLE documents ADD COLUMN IF NOT EXISTS page_count integer NOT NULL DEFAULT 0`,
  `ALTER TABLE documents ADD COLUMN IF NOT EXISTS duplicate_chunks integer NOT NULL DEFAULT 0`,
  `ALTER TABLE documents ADD COLUMN IF NOT EXISTS processed_sections jsonb`,
  `ALTER TABLE chunks ADD COLUMN IF NOT EXISTS heading text`,
  `ALTER TABLE chunks ADD COLUMN IF NOT EXISTS chunk_strategy varchar(24) NOT NULL DEFAULT 'structural'`,
  `ALTER TABLE chunks ADD COLUMN IF NOT EXISTS char_count integer NOT NULL DEFAULT 0`,
  `ALTER TABLE chunks ADD COLUMN IF NOT EXISTS content_hash varchar(64)`,
  `ALTER TABLE messages ADD COLUMN IF NOT EXISTS retrieval_mode varchar(16)`,
  `ALTER TABLE messages ADD COLUMN IF NOT EXISTS retrieval_stats jsonb`,
  `ALTER TABLE messages ADD COLUMN IF NOT EXISTS citations jsonb`,
  `ALTER TABLE messages ADD COLUMN IF NOT EXISTS confidence jsonb`,
  `ALTER TABLE messages ADD COLUMN IF NOT EXISTS abstained varchar(8)`,
];

export function stripIndexes(sql: string) {
  return sql
    .split(";")
    .filter((statement) => !/CREATE\s+INDEX/i.test(statement))
    .join(";");
}

export function indexesOnly(sql: string) {
  return sql
    .split(";")
    .filter((statement) => /CREATE\s+INDEX/i.test(statement))
    .map((statement) => `${statement.trim()};`)
    .join("\n");
}

/**
 * Tables first, then the additive columns, then the indexes — some indexes
 * cover columns that only exist after the migration pass.
 */
export async function applySchemaWith(
  exec: (sql: string) => Promise<unknown>,
): Promise<void> {
  await exec(stripIndexes(SCHEMA_SQL));
  for (const statement of MIGRATION_SQL) {
    try {
      await exec(statement);
    } catch {
      // Column exists in an older, incompatible shape; leave it alone rather
      // than failing the boot for every request.
    }
  }
  await exec(indexesOnly(SCHEMA_SQL));
}
