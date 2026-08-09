-- Chunk provenance (multi-format loaders + switchable chunking strategies)
ALTER TABLE documents ADD COLUMN IF NOT EXISTS file_bytes text;
ALTER TABLE documents ADD COLUMN IF NOT EXISTS source_type varchar(16) NOT NULL DEFAULT 'pdf';
ALTER TABLE documents ADD COLUMN IF NOT EXISTS chunk_strategy varchar(24) NOT NULL DEFAULT 'structural';
ALTER TABLE documents ADD COLUMN IF NOT EXISTS embedding_model varchar(64);
ALTER TABLE documents ADD COLUMN IF NOT EXISTS page_count integer NOT NULL DEFAULT 0;
ALTER TABLE documents ADD COLUMN IF NOT EXISTS duplicate_chunks integer NOT NULL DEFAULT 0;
ALTER TABLE documents ADD COLUMN IF NOT EXISTS processed_sections jsonb;

ALTER TABLE chunks ADD COLUMN IF NOT EXISTS heading text;
ALTER TABLE chunks ADD COLUMN IF NOT EXISTS chunk_strategy varchar(24) NOT NULL DEFAULT 'structural';
ALTER TABLE chunks ADD COLUMN IF NOT EXISTS char_count integer NOT NULL DEFAULT 0;
ALTER TABLE chunks ADD COLUMN IF NOT EXISTS content_hash varchar(64);

-- Answer quality layer (citations, verification, confidence, abstain)
ALTER TABLE messages ADD COLUMN IF NOT EXISTS retrieval_mode varchar(16);
ALTER TABLE messages ADD COLUMN IF NOT EXISTS retrieval_stats jsonb;
ALTER TABLE messages ADD COLUMN IF NOT EXISTS citations jsonb;
ALTER TABLE messages ADD COLUMN IF NOT EXISTS confidence jsonb;
ALTER TABLE messages ADD COLUMN IF NOT EXISTS abstained varchar(8);

CREATE TABLE IF NOT EXISTS eval_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
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

CREATE INDEX IF NOT EXISTS chunks_hash_idx ON chunks (guest_id, content_hash);
CREATE INDEX IF NOT EXISTS chunks_document_order_idx ON chunks (document_id, chunk_index);
