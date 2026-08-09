# KAI

**Knowledge Augmented Intelligence** is a retrieval-augmented generation system
for internal documentation. It ingests PDF, Markdown, HTML, and plaintext,
retrieves evidence with hybrid dense + BM25 search, verifies that every citation
in the answer is actually supported by the passage it points at, and reports a
confidence score instead of guessing when retrieval comes back weak.

**Live site:** [https://kai-ai-rag.vercel.app](https://kai-ai-rag.vercel.app/)

The distinguishing feature is not the chat box — it is the measurement layer.
KAI ships a golden question set, an evaluation harness, and bake-off scripts, so
every retrieval or chunking decision can be defended with a number instead of an
opinion. See [`docs/CASE_STUDY.md`](docs/CASE_STUDY.md) for how to produce those
numbers and what they mean.

---

## What it does

**Ingestion**

- Loads `.pdf`, `.md`/`.mdx`, `.html`, `.txt`/`.rst`, normalizing each into
  plaintext sections that keep their page number and heading breadcrumb.
- Three switchable chunking strategies, recorded per chunk so experiments are
  reproducible:
  - `fixed` — fixed-size window with overlap; a structure-agnostic baseline.
  - `structural` — recursive split that respects headings and prepends the
    heading breadcrumb to each chunk (default).
  - `semantic` — splits where the embedding similarity between adjacent
    sentence windows drops past a percentile threshold.
- Near-duplicate detection at ingest: exact content hash first, then cosine
  similarity above 0.95 against both existing and incoming chunks.
- Re-chunk any document with a different strategy without re-uploading it, via
  `POST /api/documents/:id/reindex`.

**Retrieval**

- Dense vector search (Gemini embeddings in Qdrant, or an on-disk store locally).
- A real Okapi BM25 index with identifier-aware tokenization, so
  `KAI_PDF_STORAGE`, `db.apply`, and `E1042` match exactly rather than fuzzily.
- Weighted Reciprocal Rank Fusion with tunable dense/sparse weights, plus
  `hybrid | dense | sparse` modes for A/B comparison from the UI or the API.
- Optional LLM reranking of the fused candidate pool, with a lexical fallback
  when no key is available.
- Neighbour expansion, because a heading often wins retrieval while the answer
  sits in the chunk after it.

**Answering**

- The prompt requires inline `[n]` citations tied to numbered passages; the UI
  turns each into a chip that scrolls to the passage it cites.
- An LLM-as-judge pass checks every claim against the source it cites and labels
  it supported, partial, or unsupported — including citations to passages that
  do not exist.
- A composite confidence score combines retrieval quality, citation coverage,
  and answer completeness, with the reasoning shown in the UI.
- Below the confidence threshold KAI abstains with a structured report of what
  it did and did not find, instead of answering anyway.

**Measurement**

- 70 golden questions over an 8-document synthetic internal-docs corpus,
  covering lookup, multi-hop, unanswerable, and ambiguous cases.
- Metrics: answer correctness (LLM-as-judge), faithfulness, citation accuracy,
  retrieval recall and MRR, exact-token recall, abstain accuracy, latency.
- One command to bake off all three chunking strategies, or all three retrieval
  modes, into a comparison table.

---

## Run locally

### Prerequisites

- Node.js 20 or newer
- A Gemini API key with access to embedding + chat models. You can supply it in
  the UI under **Settings** (stored only in your browser) or as a server-side
  `GOOGLE_API_KEY` fallback. The evaluation scripts require the env var.
- Optionally several keys. Set `GOOGLE_API_KEY_2` through `_10` and requests
  fail over to the next key when one reports exhausted quota — worth doing
  before an eval run, which costs roughly 280 model calls.

### Zero-dependency mode (PGlite + on-disk vectors)

```bash
git clone https://github.com/nexus69420/kai-ai-rag.git
cd kai-ai-rag/apps/web
cp ../../.env.example .env.local   # defaults are already the local-only ones
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000). The workspace is at
`/chat`, keys and retrieval knobs at `/settings`, the API reference at
`/api-docs`.

### Docker Compose (Postgres + Qdrant + web)

```bash
export GOOGLE_API_KEY=...          # needed to embed the seed corpus
docker compose up -d --build
docker compose run --rm seed       # indexes the eval corpus into a demo workspace
```

Then open [http://localhost:3000/api/demo](http://localhost:3000/api/demo) to
attach your browser session to the seeded workspace and start asking questions
immediately.

To run Postgres and Qdrant in Docker but the app on your host, start only the
data plane and point `.env.local` at it:

```bash
docker compose up -d postgres qdrant
# DATABASE_URL=postgresql://kai:kai@localhost:5432/kai
# QDRANT_URL=http://localhost:6333
npm run db:apply && npm run dev
```

### Verify

```bash
curl http://localhost:3000/api/health
```

Reports database and vector-store status, the capability matrix (available
chunking strategies, retrieval modes, source types), and how many API keys are
configured versus currently available. Never exposes credentials.

---

## Evaluation

All commands run from `apps/web` and need `GOOGLE_API_KEY` in the environment.
Each run indexes the corpus into a workspace keyed by chunking strategy and
reuses it when it already matches, so repeat runs skip re-embedding.

```bash
npm run eval                                  # default: structural + hybrid
npm run eval -- --mode dense --no-rerank      # ablate the rerank pass
npm run eval -- --limit 10 --concurrency 4    # quick smoke run
npm run eval:chunking                         # fixed vs structural vs semantic
npm run eval:retrieval                        # hybrid vs dense vs sparse
```

Reports land in `apps/web/eval/reports/` as both JSON and Markdown, with
headline metrics, a per-question-type breakdown, a per-case table, and a list of
the cases that need attention. Aggregates are also written to the `eval_runs`
table for history.

Useful flags: `--strategy`, `--mode`, `--top-k`, `--dense-weight`,
`--sparse-weight`, `--rerank`, `--verify`, `--abstain-threshold`,
`--chat-model`, `--judge-model`, `--embedding-model`, `--concurrency`,
`--limit`, `--force` (reindex even if the corpus already matches), `--label`.

### Interpreting the metrics

- **Retrieval recall** and **MRR** isolate the retriever: they ignore the answer
  text and ask only whether the expected document reached the model.
- **Faithfulness** counts claims supported by *some* retrieved passage.
  **Citation accuracy** is stricter — the specific source the answer cited must
  support the claim.
- **Abstain accuracy** rewards declining unanswerable questions *and* answering
  answerable ones, so no configuration can win by refusing everything.

---

## Architecture

```text
Browser (/, /chat, /settings, /api-docs)
   │  BYOK key + retrieval settings live in localStorage
   ▼
Ingest ─ POST /api/upload | /api/v1/ingest
   loaders.ts       pdf/md/html/txt → normalized sections (page, heading)
   chunking/*       fixed | structural | semantic
   dedup.ts         content hash, then cosine > 0.95
   ingest.ts        embed → Postgres rows + Qdrant vectors → BM25 invalidate

Ask ─ POST /api/chat (NDJSON stream) | /api/v1/ask (JSON)
   pipeline.ts      retrieve → gate → generate → verify → score
     retrieve.ts    dense + BM25 → weighted RRF → rerank → neighbours
     confidence.ts  abstain when retrieval confidence < threshold
     prompt.ts      grounded system prompt, enforced [n] citations
     verify.ts      LLM-as-judge: does the cited source support the claim?
     confidence.ts  composite score: retrieval + citations + completeness

Storage
   Postgres / PGlite   documents, chunks, chats, messages, eval_runs
   Qdrant / on-disk    chunk vectors
   BM25                in-process index, invalidated on ingest and delete
```

### Key modules

| Path | Responsibility |
| --- | --- |
| `src/lib/loaders.ts` | Format detection and normalization to sections |
| `src/lib/chunking/` | The three chunking strategies and shared text utilities |
| `src/lib/bm25.ts` | Okapi BM25 index, tokenizer, stemmer, cache invalidation |
| `src/lib/retrieve.ts` | Dense + sparse candidates, weighted RRF, neighbours |
| `src/lib/rerank.ts` | LLM rerank with lexical fallback |
| `src/lib/verify.ts` | Claim-level citation verification and completeness |
| `src/lib/confidence.ts` | Retrieval and composite answer scoring, abstain gate |
| `src/lib/pipeline.ts` | The orchestrator shared by streaming and JSON APIs |
| `src/lib/api-keys.ts` | Key pool with quota-aware failover and cooldowns |
| `eval/` | Corpus, golden questions, harness, reports |

### API

Full OpenAPI 3.1 spec at `/api/openapi`, rendered at `/api-docs`.

| Endpoint | Purpose |
| --- | --- |
| `POST /api/v1/ingest` | Ingest a document (multipart or JSON) |
| `POST /api/v1/ask` | Ask a question, non-streaming JSON |
| `GET /api/v1/documents` | List indexed documents with metadata |
| `POST /api/chat` | Streaming NDJSON answer for the UI |
| `POST /api/upload` | Browser upload with strategy selection |
| `POST /api/documents/:id/reindex` | Re-chunk with a different strategy |
| `POST /api/retrieval/compare` | Retrieval-only comparison across modes |
| `GET /api/health` | Backend status and capability matrix |

Scripted callers can target a specific workspace with the `x-guest-id` header
when `KAI_ALLOW_GUEST_HEADER=1`. Keep that off in production, where the guest
cookie is the only workspace key.

---

## Development

```bash
npm run dev         # Next dev server
npm run typecheck   # tsc --noEmit
npm run lint        # eslint
npm run test        # vitest (104 tests: pure logic + schema against PGlite)
npm run build       # production build
npm run db:apply    # apply schema additively to Postgres or PGlite
npm run seed        # index the eval corpus into the demo workspace
```

Tests cover the parts worth pinning down without a network: BM25 tokenization
and scoring, RRF weighting, chunking strategies, citation parsing, confidence
scoring, the loaders, and the boot-time schema SQL applied to a throwaway PGlite
instance.

### Repository layout

```text
apps/web/                Next.js app (UI, API routes, RAG library)
apps/web/eval/           Corpus, golden questions, harness, reports
apps/web/tests/          Vitest unit tests
docs/                    Case study, gap analysis, RAG pipeline guide
docker-compose.yml       Postgres + Qdrant + web + one-shot seed job
.env.example             Env template (local, Docker, hosted)
LEGACY.md, app/, frontend/  Older FastAPI + Vite implementation
```

---

## Configuration

Everything is server-side; nothing is exposed with a `NEXT_PUBLIC_` prefix. See
[`.env.example`](.env.example) for the full list with comments.

| Variable | Default | Notes |
| --- | --- | --- |
| `DATABASE_URL` | `pglite` | `pglite` for a local file DB, or a Postgres URL |
| `QDRANT_URL` | `local` | `local` for on-disk vectors, or a Qdrant URL |
| `QDRANT_API_KEY` | — | Required by Qdrant Cloud |
| `QDRANT_COLLECTION` | `kai_pdf_chunks_v1` | Bump when embedding dimensions change |
| `GOOGLE_API_KEY` | — | Server fallback; users can bring their own key |
| `GOOGLE_API_KEY_2` … `_10` | — | Extra keys; requests fail over on quota errors |
| `KAI_PDF_STORAGE` | `disk` | `disk`, `tmp`, or `db`; serverless forces `db` |
| `RATE_LIMIT_PER_MINUTE` | `30` | Per-workspace request budget |
| `KAI_ENABLE_DEMO` | off | Serves `/api/demo` to join the seeded workspace |
| `KAI_ALLOW_GUEST_HEADER` | off | Lets API callers select a workspace by header |

`pglite` and `local` are rejected in production builds, since neither survives a
serverless restart.

---

## Roadmap

1. **Cross-encoder reranking** alongside the LLM judge, to trade latency for
   cost with measured numbers on both sides.
2. **Additional model providers** (OpenAI, Anthropic) behind the existing
   embedding and chat interfaces.
3. **OCR** for scanned PDFs.
4. **Account auth** with synced history and optional guest import.
5. **Object storage** for originals, so page preview survives serverless
   restarts without base64 blobs in Postgres.

## Contributing

Issues and pull requests welcome. Keep API keys and local data out of Git, run
`npm run typecheck && npm run lint && npm run test` before opening a PR, and
prefer small focused changes. Changes to retrieval or chunking should come with
an eval run showing the effect.

## Author

Aayush Kumar Dubey

GitHub: [https://github.com/nexus69420](https://github.com/nexus69420)
