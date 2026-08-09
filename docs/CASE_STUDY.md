# Case study: hybrid RAG over internal documentation

> **Status: scaffold.** The structure, method, and analysis prompts are written.
> Every `TODO` marks a number that must come from an actual eval run on your
> machine — do not fill them in from memory or estimate them. Run the commands in
> each section, paste the real figures, then delete this note.

---

## Problem

Internal documentation search fails in a specific way. Employees do not ask
"find the page about deployments" — they ask "why is the batch job timing out
after the region migration?" The answer is spread across a runbook, an ADR, and
an error-code table, and half the question is exact tokens (`E1042`,
`HALOGEN_BATCH_SIZE`) that semantic similarity is bad at matching.

Three failure modes matter more than average relevance:

1. **Exact identifiers get paraphrased away.** Pure vector search retrieves a
   passage *about* configuration instead of the one naming the config key.
2. **Confident wrong answers.** A retrieval miss produces a fluent answer with a
   citation that does not support it, which is worse than no answer.
3. **Unanswerable questions.** The corpus genuinely does not cover everything,
   and the system has to say so.

KAI is built to measure all three, not just to answer.

## Corpus and question set

- **8 documents**, a synthetic but realistic internal-docs corpus: architecture
  overview, API reference, on-call runbook, configuration reference, error-code
  table, onboarding guide, an architecture decision record, and a security
  policy. Source: `apps/web/eval/corpus/`.
- **70 golden questions** with reference answers, expected source documents, and
  where relevant a `mustInclude` list of tokens the answer has to contain.
  Source: `apps/web/eval/golden/questions.json`.

| Type | Cases | What it probes |
| --- | --- | --- |
| `lookup` | 44 | Single-passage factual recall, including exact identifiers |
| `multihop` | 14 | Answers requiring two or more documents |
| `no-answer` | 7 | Plausible questions the corpus does not cover |
| `ambiguous` | 5 | Questions that should ask for clarification |

The `no-answer` and `ambiguous` cases exist to keep the abstain gate honest. A
system that answers everything scores badly on them; so does one that refuses
everything.

## Pipeline

```text
load → chunk → dedupe → embed → index (vectors + BM25)
                                    │
question ──► dense top-k ──┐        │
        └──► BM25 top-k ───┴► weighted RRF ──► rerank ──► neighbours
                                    │
                        retrieval confidence gate
                                    │
                     generate with enforced [n] citations
                                    │
                    verify each claim against its cited source
                                    │
              composite confidence: retrieval + citations + completeness
```

Design decisions worth defending in an interview, each with a measurement to
back it:

| Decision | Alternative rejected | How it was checked |
| --- | --- | --- |
| Hybrid dense + BM25 | Dense only | `npm run eval:retrieval` |
| Structural chunking as default | Fixed-size windows | `npm run eval:chunking` |
| LLM rerank of the fused pool | Fusion order as final | `--rerank false` ablation |
| Claim-level citation verification | Trusting the model's brackets | Citation accuracy vs faithfulness gap |
| Abstain below a confidence threshold | Always answering | Abstain accuracy on the 12 no-answer/ambiguous cases |

## Headline results

```bash
cd apps/web
export GOOGLE_API_KEY=...
npm run eval -- --label baseline
```

TODO: paste the headline table from the generated report in
`apps/web/eval/reports/`.

| Metric | Score |
| --- | --- |
| Answer correctness | TODO |
| Faithfulness | TODO |
| Citation accuracy | TODO |
| Retrieval recall | TODO |
| Retrieval MRR | TODO |
| Exact-token recall | TODO |
| Abstain accuracy | TODO |
| Mean latency | TODO |

## Experiment 1 — does hybrid retrieval actually help?

```bash
npm run eval:retrieval
```

TODO: paste the comparison table (hybrid / dense / sparse).

Questions to answer from the numbers, not from intuition:

- What is the retrieval recall gap between hybrid and dense-only? If it is small,
  say so — a defensible "hybrid bought us 3 points" is stronger than an
  unsupported claim of a large win.
- Where does sparse-only *beat* hybrid? Expect the exact-token recall metric to
  favour it on error codes and config keys. That is the argument for keeping BM25
  in the fusion rather than replacing it.
- Which specific cases flip between modes? The per-case tables in the reports
  make this concrete; name two or three.

## Experiment 2 — which chunking strategy wins?

```bash
npm run eval:chunking
```

TODO: paste the comparison table (fixed / structural / semantic), including the
chunk count per strategy.

Questions to answer:

- Does structural chunking beat fixed-size on multi-hop questions specifically?
  Use the per-question-type breakdown, not just the overall average.
- Does semantic chunking justify its ingest cost? It requires an embedding call
  per sentence window; if it wins by less than the noise between runs, the
  honest conclusion is that it does not pay for itself on this corpus.
- How does chunk count differ, and what does that do to latency and token spend?

## Experiment 3 — what does citation verification catch?

```bash
npm run eval -- --label no-verify --verify false
npm run eval -- --label verify
```

TODO: report the gap between faithfulness and citation accuracy.

Faithfulness asks whether a claim is supported by *some* retrieved passage;
citation accuracy asks whether the *cited* passage supports it. The gap between
them is the rate at which the model attributes a true statement to the wrong
source — a failure users cannot see and a plain vector-search demo cannot
detect. Report it as a percentage and name a case where it happened.

## Experiment 4 — is the abstain gate calibrated?

TODO: report abstain accuracy overall, and split into the two error directions:

- **False abstains:** answerable questions the gate refused. These are the
  expensive ones; a user who gets "I could not find this" for something in the
  docs stops trusting the tool.
- **Missed abstains:** unanswerable questions that got an answer anyway.

Then state the threshold you settled on and why:

```bash
npm run eval -- --abstain-threshold 0.25 --label loose
npm run eval -- --abstain-threshold 0.45 --label strict
```

## What broke along the way

TODO: keep this section honest and specific. Real debugging stories interview
better than a clean narrative. Candidates from this build:

- BM25 sub-token expansion (`HLG-4022` → `hlg`, `4022`) improved recall but
  inflated the keyword-coverage signal that the confidence score depends on, so
  coverage now counts whole tokens only while search still expands them.
- Confidence scores could exceed 1.0 when a rerank score arrived outside the
  0–1 range, which silently broke the banding thresholds.
- Semantic chunking degenerates to a single chunk on short inputs where all
  adjacent-window distances tie; falling back to structural is correct, but the
  reported strategy has to reflect what actually ran.
- Client components importing the retrieval module dragged the Postgres driver
  into the browser bundle; splitting the shared vocabulary into dependency-free
  modules made `/chat` and `/settings` statically prerenderable again.

## Limitations

State these plainly rather than letting a reviewer find them:

- The corpus is synthetic and written by the same author as the questions, which
  inflates every score relative to real internal docs.
- Correctness and citation verification both use an LLM as judge, so judge bias
  is baked into the numbers. A human-labelled subset would calibrate this.
- 70 questions is enough to see large effects and not enough to resolve small
  ones. Treat sub-5-point differences as noise unless you repeat the run.
- Reranking, verification, and judging all cost model calls; latency figures
  reflect that and are not comparable to a bare vector-search demo.

## Reproducing

```bash
git clone https://github.com/nexus69420/kai-ai-rag.git
cd kai-ai-rag
export GOOGLE_API_KEY=...
docker compose up -d --build
docker compose run --rm seed

cd apps/web
npm run eval
npm run eval:chunking
npm run eval:retrieval
```

Reports are written to `apps/web/eval/reports/` as JSON and Markdown, and
aggregates are persisted to the `eval_runs` table.
