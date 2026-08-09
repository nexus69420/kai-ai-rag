# Gap Analysis: KAI vs Project 6 RAG Pipeline Guide

> **This document is the "before" snapshot.** It records the gaps as they stood
> when KAI was a PDF-only hybrid search demo. Every capability gap below has
> since been closed — the **Now** column says where the code lives. Keep the
> analysis for the reasoning; read the status column for the current state.
>
> Remaining work is deliberate scope, not gaps: cross-encoder reranking as an
> alternative to the LLM judge, non-Gemini providers, OCR, and the eval numbers
> themselves, which have to be produced on a machine with an API key. See
> [`CASE_STUDY.md`](./CASE_STUDY.md).

**Original verdict:** KAI is already a strong **productized RAG demo** (hybrid retrieve + rerank + streaming UI + hosted deploy). It is **not yet** at the full Project 6 “production RAG engineer / interview case study” bar. The biggest gaps are **quality infrastructure** (eval, citation verification, confidence, multi-strategy chunking, dedup, multi-format ingest) — not the absence of hybrid search.

Guide source: [`PROJECT_6_RAG_PIPELINE_GUIDE.md`](./PROJECT_6_RAG_PIPELINE_GUIDE.md)

---

## Scorecard (by phase)

| Phase | Guide requirement | KAI status *then* | Gap size | Now |
|-------|-------------------|------------|----------|-----|
| 1.1 | Multi-format loader (md/txt/html/pdf) + raw storage | PDF only; no re-index-from-raw pipeline | **Large** | Closed — `lib/loaders.ts`, `lib/formats.ts`, `POST /api/documents/:id/reindex` |
| 1.2 | 3 switchable chunkers + strategy metadata | One fixed-size + slide-aware merge | **Large** | Closed — `lib/chunking/{fixed,structural,semantic}.ts`, strategy stored per chunk |
| 1.3 | OpenAI embeddings + Chroma + BM25 index in sync | Gemini 768-d + Qdrant/local + MiniSearch (ad-hoc, not persisted BM25) | **Medium** | Closed — `lib/bm25.ts`, invalidated on ingest, reindex, and delete |
| 1.4 | Near-dupe dedup (cosine > 0.95) | None | **Medium** | Closed — `lib/dedup.ts` (content hash, then cosine) |
| 2.1 | Dense top-k | Yes (Qdrant/local cosine) | None | Unchanged |
| 2.2 | Sparse BM25 | MiniSearch fuzzy/prefix (≈ sparse, not true BM25) | **Small–Medium** | Closed — real Okapi BM25 with identifier-aware tokenization |
| 2.3 | RRF + configurable dense/sparse weights | RRF yes; **no** weight knobs | **Small** | Closed — `weightedRrf` + `denseWeight`/`sparseWeight` settings |
| 2.4 | Rerank top-20 → top-5 | Gemini LLM rerank (pool ≤16) + lexical fallback | **Small** (close enough; not cross-encoder) | Closed — pool now `max(20, topK*3)`; cross-encoder still optional future work |
| 3.1 | Grounded prompt + `[1]`/`[2]` inline cites | Grounded yes; soft page mentions, not enforced bracket cites | **Medium** | Closed — enforced in `prompt.ts`, parsed in `citations.ts`, chips in the UI |
| 3.2 | Citation verification (LLM-as-judge) | None | **Large** | Closed — `lib/verify.ts`, per-claim verdicts surfaced per source |
| 3.3 | Confidence score (retrieval / citation / completeness) | None | **Large** | Closed — `lib/confidence.ts` + `confidence-panel.tsx` |
| 3.4 | Structured low-confidence / “I don’t know” | Prompt-only soft refusal | **Medium** | Closed — abstain gate in `pipeline.ts`, `buildAbstainAnswer` |
| 4.1 | 50+ golden Q&A | None | **Large** | Closed — 70 cases over 8 documents in `eval/` |
| 4.2 | Automated eval metrics | No tests / no harness | **Large** | Closed — `eval/lib/runner.ts`, `npm run eval`, 89 unit tests |
| 4.3 | Chunking strategy comparison report | N/A (only one strategy) | **Large** | Closed — `npm run eval:chunking`, `npm run eval:retrieval` |
| 5.1 | FastAPI `/v1/ask|documents|ingest` + OpenAPI | Next.js App Router APIs (no versioned OpenAPI) | **Small** (equivalent surface, different shape) | Closed — `/api/v1/*` + OpenAPI 3.1 at `/api/openapi`, rendered at `/api-docs` |
| 5.2 | Dashboard: cites, chunks, confidence, hybrid vs dense A/B | Chat + sources + PDF preview; no confidence / A/B toggle | **Medium** | Closed — confidence panel, per-source scores, `retrieval-compare.tsx` |
| 5.3 | Full docker-compose (API + vector + UI + seed corpus) | Compose = Postgres + Qdrant only; no seed docs | **Medium** | Closed — `apps/web/Dockerfile`, `web` + `seed` services in compose |
| 6 | Demo + numbers-led case study | Live site exists; no eval numbers to lead with | **Large** (portfolio story) | Scaffolded — `docs/CASE_STUDY.md`; numbers require an eval run |

**Rough coverage then:** ~40–50% of the guide’s *intent*; ~20–25% of the *interview/portfolio differentiators*. **Now:** every capability is implemented and tested; the outstanding item is running the eval to fill in the case study.

---

## What KAI already has that the guide wants

These are real strengths — do not throw them away:

1. **Hybrid dense + keyword + RRF** (`apps/web/src/lib/retrieve.ts`) — the core Phase 2 story.
2. **LLM-as-judge rerank** (`rerank.ts`) — interview-grade second pass (guide suggests cross-encoder *or* LLM-as-judge).
3. **Neighbor expansion + slide-aware chunk merging** — production nuance for lecture/deck PDFs the guide doesn’t even specify.
4. **Grounded system prompt** with explicit “not in document” rule (`prompt.ts`).
5. **Streaming answers + source panel + PDF page preview** — stronger UX than a minimal Streamlit dashboard.
6. **Multi-document scope**, guest workspace, BYOK, settings (models, topK, rerank, theme).
7. **Dual backends** (PGlite/local vectors vs Postgres/Qdrant) + Vercel deploy — more “shipped product” than many guide completions.
8. **Docker for data plane** (Postgres + Qdrant).

KAI is **above** a LangChain quickstart. It is **below** a complete Project 6 portfolio case study because it cannot yet say: “X% faithfulness, Y% citation accuracy on 50 questions.”

---

## Line-by-line gap detail

### Phase 1 — Ingestion & chunking

| Guide item | KAI reality | Gap |
|------------|-------------|-----|
| md / txt / html / pdf | PDF-only gate in `api/upload` | Need loaders + normalized plaintext + metadata (heading, page) |
| Store raw + processed for re-index | Stores PDF bytes/path; no processed corpus versioning / rechunk without re-upload flow | Add raw blob + processed artifact + `POST /reindex` |
| Fixed / recursive-header / semantic chunkers | Single `chunkPages` (850/150 + soft breaks + min-size merges) | Three strategies + `chunking_strategy` on chunk metadata |
| Track strategy per chunk | Not in schema | Extend `chunks` / Qdrant payload |
| OpenAI `text-embedding-3-small` | Gemini `gemini-embedding-001` (768-d) | Stack choice, not capability gap — keep Gemini *or* add OpenAI provider |
| ChromaDB | Qdrant (or local JSON) | Fine — Qdrant is on the guide’s approved list |
| BM25 index in parallel, kept in sync | MiniSearch rebuilt from ≤500 DB rows per query | Persist BM25 (or use Qdrant sparse) and update on ingest/delete |
| Dedup cosine > 0.95 | Missing | Pre-upsert similarity check vs existing guest/corpus chunks |

### Phase 2 — Hybrid retrieval

| Guide item | KAI reality | Gap |
|------------|-------------|-----|
| Dense top-k (start 10) | Dense pool `max(topK*3, 12)`, final topK default 5 | Tune defaults; expose dense k |
| True BM25 | MiniSearch (BM25-like IR) | Prefer `rank_bm25` equivalent in TS or Qdrant sparse / dedicated BM25 index |
| Weighted RRF (0.7/0.3) | Classic unweighted RRF (`k=60`) | Add `denseWeight` / `sparseWeight` |
| Rerank top 20 → keep 5 | Pool ≤16 Gemini JSON scores → topK | Bump pool to 20; optional cross-encoder for cost/latency story |
| Dense-only A/B | Rerank toggle only | Add `retrievalMode: hybrid \| dense \| sparse` |

### Phase 3 — Generation & citations

| Guide item | KAI reality | Gap |
|------------|-------------|-----|
| Bracket cites `[1]`, `[2]` | Sources numbered in prompt; model asked to “mention pages,” not enforce `[n]` | Prompt + parse + UI linkify |
| Citation verification | None | Post-answer LLM judge per claim→cite |
| Confidence dimensions | None | Score retrieval (avg/top scores), citation coverage, completeness |
| Structured abstain | Soft prompt refusal | If retrieval score < threshold → structured payload (found / missing / docs to check) |

### Phase 4 — Evaluation (largest interview gap)

| Guide item | KAI reality | Gap |
|------------|-------------|-----|
| 50+ golden Q&A | None | Seed internal-docs corpus + hand-written set |
| Correctness / faithfulness / retrieval / citation metrics | No harness | CLI or `/api/eval` runner |
| Chunk strategy bake-off report | Impossible today | Depends on Phase 1.2 |

Without Phase 4, portfolio claims stay qualitative. **This is the gap that most hurts interviews.**

### Phase 5 — API & dashboard

| Guide item | KAI reality | Gap |
|------------|-------------|-----|
| FastAPI + OpenAPI | Next.js routes | Optional: keep Next *or* add FastAPI microservice; add OpenAPI for Next via zod-openapi |
| Confidence + hybrid vs dense toggle in UI | Missing | Extend chat response + settings/compare view |
| Full compose + seed corpus | Partial compose | Add web service + `scripts/seed` with sample internal docs |

### Phase 6 — Polish

| Guide item | KAI reality | Gap |
|------------|-------------|-----|
| Demo with citation catch | Can demo hybrid + sources | Need verification feature to “catch hallucination” live |
| Case study with numbers | No numbers | Blocked on eval |

---

## Are the gaps big?

**Yes for portfolio/interview completeness. No for “does hybrid RAG work.”**

| Category | Severity | Why |
|----------|----------|-----|
| Eval + golden set + metrics | **Critical** | Without numbers, you can’t lead a case study |
| Citation verify + confidence + abstain | **High** | Guide’s “production quality layer most systems skip” |
| Multi-format + 3 chunkers + dedup | **High** | Shows systems design, not just one PDF path |
| True BM25 + weighted RRF + mode A/B | **Medium** | KAI is close; polish + knobs |
| FastAPI / OpenAI / Chroma specifically | **Low** | Tooling preference; KAI’s stack is defensible |
| Full docker + seed | **Medium** | Onboarding / reviewer experience |

You do **not** need to rewrite KAI in Python to match the guide’s spirit. Matching the **capabilities and measurement story** matters more than matching the stack table.

---

## Should we make KAI better? (Arguments in favor)

### Interview / hiring signal
1. Hiring managers ask: “How do you know retrieval works?” → need eval harness + faithfulness %.
2. “What happens when the model cites wrong?” → citation verification is a rare, strong answer.
3. “Why hybrid?” → need dense-only vs hybrid A/B with measured lift.
4. “How did you choose chunk size?” → three strategies + comparison report answers this.
5. Multi-hop / no-answer / ambiguous cases in the golden set mirror real doc search failure modes.

### Product quality
6. Dedup stops redundant context burning tokens and confusing the model.
7. Confidence scores let the UI show “low confidence” instead of sounding certain.
8. Structured abstain is more useful than a wrong answer for internal docs.
9. Multi-format ingest matches real company corpora (Confluence HTML, READMEs, runbooks).
10. Section-aware chunking preserves headings that MiniSearch/BM25 need for API names / error codes.
11. Persisted BM25 keeps sparse search correct as the corpus grows past the current 500-row rebuild.

### Architecture maturity
12. Re-index without re-upload is required once chunkers/embeddings change.
13. Tracking `chunking_strategy` on every chunk makes experiments reproducible.
14. Weighted RRF and retrieval-mode flags turn KAI from a fixed pipeline into a tunable system.
15. Seed corpus + docker-compose one-command demo removes “it only works on my PDFs.”

### Portfolio differentiation vs current KAI
16. Today’s KAI story: “I shipped a Gemini RAG app with hybrid search and a nice UI.”
17. Upgraded story: “Hybrid beat dense-only by N% retrieval recall; citation verify caught M% bad cites; semantic chunking won faithfulness on multi-hop.”
18. The UI already exists — upgrading the **brain** (eval + verify + chunk experiments) multiplies the value of the frontend you already built.
19. README already lists OCR, auth, object storage, eval harness as WIP — Project 6 maps cleanly onto that roadmap.
20. Keeping Next.js + Gemini is fine; add OpenAI as an optional provider if you want stack-table checkbox coverage without a rewrite.

### What *not* to do
- Don’t abandon neighbor expansion / slide merges — they’re a KAI-specific win.
- Don’t replace Qdrant with Chroma just to match the guide.
- Don’t rebuild FastAPI unless you want a separate Python service for interview optics; Next APIs already cover ingest/ask/list.
- Don’t claim production-grade until eval + citation verify exist.

---

## Recommended upgrade path (priority order)

### P0 — Interview differentiators (biggest ROI)
1. Golden corpus (internal-docs style) + 50 Q&A set  
2. Eval harness: faithfulness, retrieval hit-rate, citation accuracy, correctness  
3. Prompt: enforce `[n]` citations + parse them in the UI  
4. Citation verification pass + flag unsupported claims  
5. Retrieval confidence + composite score + structured abstain threshold  

### P1 — Retrieval / ingest depth
6. Weighted RRF + `retrievalMode` hybrid/dense/sparse + UI A/B  
7. True BM25 (or Qdrant sparse) persisted, synced on ingest/delete  
8. Near-duplicate dedup at ingest  
9. Three chunk strategies + metadata + bake-off via eval  

### P2 — Product surface
10. Multi-format loaders (md/txt/html/pdf) + raw storage + reindex  
11. Dashboard panels: confidence breakdown, ranked chunks, hybrid vs dense compare  
12. Full compose + seed script  
13. Optional OpenAPI for the Next routes  

### P3 — Nice / optional
14. Cross-encoder rerank option (alongside Gemini judge)  
15. OpenAI / Anthropic providers for embeddings + chat  
16. Demo video + case study once numbers exist  

---

## Bottom line

**KAI is already at “real hybrid RAG app” level.**  
**Project 6 is at “measured, verifiable, interview-grade RAG system” level.**  

The gaps are **real and worth closing**, especially eval + citation verification + confidence. They are **not** a reason to scrap KAI — they are a reason to **upgrade KAI into the Project 6 system**, using the existing Next.js + Qdrant + Gemini product as the chassis.
