# KAI

**Knowledge Augmented Intelligence** is an open-source RAG workspace: upload
PDFs, retrieve page-aware evidence with hybrid search and Gemini reranking, and
stream grounded answers. Bring your own API key, switch models, multi-select
documents, and use dark or light mode.

**Live site:** [https://kai-ai-rag.vercel.app](https://kai-ai-rag.vercel.app/)

The live product is a Next.js app backed by Gemini, Postgres, and Qdrant. Local
dev can run with zero Docker (PGlite + on-disk vectors) if you only want to
explore the UI and RAG loop.

## What KAI does

- Upload PDFs, chunk them with page awareness, and chat against your library.
- Retrieves evidence before every answer (hybrid dense + keyword, RRF fusion,
  optional Gemini rerank) rather than answering from general model knowledge.
- Streams answers with citation passages and PDF page preview.
- Supports multi-document selection (one, several, or all uploads).
- Remembers guest chats and documents via a simple cookie workspace.
- Settings for BYOK Gemini key, chat/embedding models, temperature, topK, and
  rerank.

## Run locally

### Prerequisites

- Node.js 20 or newer
- A Gemini API key with access to embedding + chat models (or rely on a server
  `GOOGLE_API_KEY` fallback)

### 1. Configure the web app

```bash
git clone https://github.com/nexus69420/kai-ai-rag.git
cd kai-ai-rag/apps/web
cp ../../.env.example .env.local
```

Fill in `apps/web/.env.local` (defaults work for fully local mode):

```env
DATABASE_URL=pglite
QDRANT_URL=local
GOOGLE_API_KEY=your_gemini_key
```

These values are server-only. Never commit `.env.local` or expose them with a
`NEXT_PUBLIC_` prefix. You can also paste the key only in **Settings** in the
UI (BYOK).

### 2. Start KAI

```bash
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000). The introduction is at
`/`; the workspace is at `/chat`; keys and models are at `/settings`.

### 3. Verify the connection (optional)

```bash
curl http://localhost:3000/api/health
```

The response includes database and vector-store status, but never exposes
credentials.

### Optional: Docker Postgres + Qdrant

```bash
docker compose up -d
```

Point `.env.local` at Compose services (see `.env.example`), then:

```bash
npm run db:apply
npm run dev
```

## Architecture

```text
Next.js guest workspace (/ , /chat , /settings)
        │
        ├─ POST /api/upload  → parse PDF → chunk → embed → vectors + DB
        └─ POST /api/chat    → hybrid retrieve → rerank → stream answer
                                    Gemini embedding        Gemini / Gemma

Vectors  — Qdrant Cloud or local JSON store
Postgres — documents, chunks, chats, messages (or PGlite locally)
```

## Work in progress

1. **Curated niche library:** ship starter corpora for common study domains.
2. **Account auth:** sign-in, synced history, optional guest import.
3. **Durable PDF storage on serverless:** object storage so page preview works
   reliably after upload on hosted deploys.
4. **OCR** for scanned PDFs and a retrieval evaluation harness.

## Repository layout

```text
apps/web/          Next.js UI and API routes
docker-compose.yml Optional local Postgres + Qdrant
.env.example       Env template (local + hosted)
LEGACY.md          Older FastAPI + Vite notes
app/               Legacy FastAPI
frontend/          Legacy Vite SPA
```

## Contributing

Issues and pull requests are welcome. Keep API keys and local data out of Git,
and prefer small focused changes.

## Author

Aayush Kumar Dubey

GitHub: [https://github.com/nexus69420](https://github.com/nexus69420)
