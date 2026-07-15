CREATE TABLE IF NOT EXISTS documents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  guest_id varchar(64) NOT NULL,
  filename text NOT NULL,
  chunk_count integer NOT NULL DEFAULT 0,
  status varchar(32) NOT NULL DEFAULT 'processing',
  storage_path text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS chunks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id uuid NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  guest_id varchar(64) NOT NULL,
  chunk_index integer NOT NULL,
  page integer NOT NULL DEFAULT 1,
  text text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS chats (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  guest_id varchar(64) NOT NULL,
  title text NOT NULL DEFAULT 'New chat',
  document_id uuid REFERENCES documents(id) ON DELETE SET NULL,
  document_ids jsonb DEFAULT '[]'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  chat_id uuid NOT NULL REFERENCES chats(id) ON DELETE CASCADE,
  role varchar(16) NOT NULL,
  content text NOT NULL,
  sources jsonb DEFAULT '[]'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS documents_guest_id_idx ON documents(guest_id);
CREATE INDEX IF NOT EXISTS chunks_document_id_idx ON chunks(document_id);
CREATE INDEX IF NOT EXISTS chunks_guest_id_idx ON chunks(guest_id);
CREATE INDEX IF NOT EXISTS chats_guest_id_idx ON chats(guest_id);
CREATE INDEX IF NOT EXISTS messages_chat_id_idx ON messages(chat_id);
