# KAI — Knowledge Augmented Intelligence

KAI is an open-source RAG workspace: upload PDFs, retrieve page-aware evidence with hybrid search + reranking, and stream grounded answers from Gemini. Bring your own API key, switch models, multi-select documents, and use dark or light mode.

**Stack:** Next.js (App Router) · Gemini · Postgres / PGlite · Qdrant / local vectors

**Repo:** [github.com/nexus69420/kai-ai-rag](https://github.com/nexus69420/kai-ai-rag)

---

## Features

- Research-desk UI with **dark / light** themes
- **PDF upload** with page-aware chunking and citations
- **Hybrid retrieval** (dense + keyword) fused with RRF, then **Gemini reranking**
- **Streaming** answers with source passages and PDF page preview
- Multi-document chat (select one, several, or all uploads)
- Conversational history
- **Settings**: BYOK Gemini key, model switcher, temperature, topK, rerank toggle
- Guest cookie workspace (documents, chats, messages)
- Rate limiting + `/api/health`
- Local zero-Docker mode or Docker Compose (Postgres + Qdrant)

---

## Architecture

```text
Next.js (/ , /chat , /settings)
        │
        ├─ POST /api/upload  → parse PDF → chunk → embed → vectors + DB
        ├─ POST /api/chat    → hybrid retrieve → rerank → stream answer
        └─ GET  /api/health  → DB + vector store status

Vectors  — Qdrant Cloud / local JSON store
Postgres — documents, chunks, chats, messages (or PGlite locally)
```

---

## Quick start (local)

### Option A — zero Docker (default)

```bash
git clone https://github.com/nexus69420/kai-ai-rag.git
cd kai-ai-rag
cp .env.example apps/web/.env.local
cd apps/web
npm install
npm run dev
```

Defaults in `.env.local`:

```env
DATABASE_URL=pglite
QDRANT_URL=local
GOOGLE_API_KEY=optional_server_fallback_key
```

Open [http://localhost:3000](http://localhost:3000) · Chat `/chat` · Settings `/settings`

### Option B — Docker Postgres + Qdrant

```bash
docker compose up -d
```

```env
DATABASE_URL=postgresql://kai:kai@localhost:5432/kai
QDRANT_URL=http://localhost:6333
QDRANT_COLLECTION=kai_pdf_chunks_v1
```

```bash
cd apps/web
npm run db:apply
npm run dev
```

### Health check

```bash
curl http://localhost:3000/api/health
```

---

## Deploy on Vercel

KAI’s Next.js app lives in **`apps/web`**. Serverless needs managed Postgres + Qdrant (PGlite / local vectors are for local only).

### 1. Services

1. **Postgres** — create a free DB on [Neon](https://neon.tech) (or Supabase) and copy the connection string  
2. **Qdrant** — create a free cluster on [Qdrant Cloud](https://cloud.qdrant.io/) and copy URL + API key  

### 2. Import the GitHub repo

1. Go to [vercel.com/new](https://vercel.com/new)  
2. Import `nexus69420/kai-ai-rag`  
3. Set **Root Directory** to `apps/web`  
4. Framework: Next.js (auto)  

### 3. Environment variables (Production)

| Name | Value |
|------|--------|
| `DATABASE_URL` | Neon / Postgres connection string |
| `QDRANT_URL` | Qdrant Cloud URL |
| `QDRANT_API_KEY` | Qdrant Cloud API key |
| `QDRANT_COLLECTION` | `kai_pdf_chunks_v1` |
| `GOOGLE_API_KEY` | Optional server fallback (prefer user BYOK in Settings) |
| `RATE_LIMIT_PER_MINUTE` | `30` (optional) |

### 4. Deploy

Click **Deploy**. After the first deploy, open `/api/health` to confirm DB + Qdrant are reachable.

On first chat/upload, collections/tables are created automatically where possible. For Postgres schema, you can also run locally against the remote DB:

```bash
cd apps/web
DATABASE_URL="your-neon-url" npm run db:apply
```

### Notes for Vercel

- Set the Vercel project root to **`apps/web`**
- Uploaded PDF files on disk are ephemeral on serverless; chat still works from stored chunks/vectors. Prefer BYOK in Settings for public demos
- Do not commit `.env` / `.env.local`

### CLI (optional)

```bash
cd apps/web
npx vercel
npx vercel --prod
```

---

## Settings / BYOK

| Setting | Notes |
|---------|--------|
| Gemini API key | Browser `localStorage` (`kai.settings.v1`); sent only to API routes |
| Chat models | `gemini-2.5-flash` (default), `gemini-2.5-pro`, `gemma-3-27b-it` |
| Embeddings | `gemini-embedding-001` |
| Rerank | On by default (Gemini scores hybrid hits) |
| Server fallback | `GOOGLE_API_KEY` only if client key is empty |

Keys are never written to the database.

---

## API overview

| Method | Path | Purpose |
|--------|------|---------|
| `POST` | `/api/upload` | PDF ingest |
| `POST` | `/api/chat` | Streaming RAG chat |
| `GET` | `/api/documents` | List documents |
| `DELETE` | `/api/documents/:id` | Delete doc + vectors |
| `GET` | `/api/documents/:id/file` | Serve PDF |
| `GET/POST` | `/api/chats` | List / create chats |
| `GET/PATCH/DELETE` | `/api/chats/:id` | Chat CRUD |
| `GET` | `/api/health` | Dependency status |

---

## Repository layout

```text
apps/web/          Next.js app (UI + API routes)  ← Vercel root
docker-compose.yml Local Postgres + Qdrant
.env.example       Env template
LEGACY.md          Old FastAPI + Vite notes
app/               Legacy FastAPI
frontend/          Legacy Vite SPA
```

---

## Roadmap

- Curated niche document library
- Account auth + synced history
- Persistent object storage for PDF previews on Vercel
- OCR for scanned PDFs
- Retrieval evaluation harness

---

## Author

Aayush Kumar Dubey

GitHub: [https://github.com/nexus69420](https://github.com/nexus69420)
