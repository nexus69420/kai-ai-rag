"use client";

import { useState } from "react";

import type { RetrievalStats } from "@/lib/db/schema";
import { formatGeminiError } from "@/lib/gemini-errors";
import type { KaiSettings } from "@/lib/settings";

type CompareSource = {
  citation?: number;
  chunkId?: string;
  filename: string;
  page: number;
  heading?: string | null;
  score?: number;
  denseScore?: number;
  sparseScore?: number;
  rerankScore?: number;
  retrievedBy?: string[];
  text: string;
};

type CompareRun = {
  mode: string;
  retrievalConfidence: number;
  stats: RetrievalStats;
  sources: CompareSource[];
};

type CompareResponse = {
  question: string;
  runs: CompareRun[];
  overlap: Array<{ a: string; b: string; shared: number; jaccard: number }>;
};

/**
 * Side-by-side retrieval comparison. This is the "why hybrid?" evidence panel:
 * the same question, the same corpus, three retrievers.
 */
export function RetrievalCompare({
  settings,
  documentIds,
  initialQuestion,
  onClose,
}: {
  settings: KaiSettings;
  documentIds: string[];
  initialQuestion: string;
  onClose: () => void;
}) {
  const [question, setQuestion] = useState(initialQuestion);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [data, setData] = useState<CompareResponse | null>(null);

  async function run() {
    const trimmed = question.trim();
    if (!trimmed || busy) return;

    setBusy(true);
    setError("");
    try {
      const res = await fetch("/api/retrieval/compare", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          ...(settings.apiKey ? { "x-api-key": settings.apiKey } : {}),
        },
        body: JSON.stringify({
          question: trimmed,
          documentIds,
          topK: settings.topK,
          rerank: settings.rerank,
          denseWeight: settings.denseWeight,
          sparseWeight: settings.sparseWeight,
          embeddingModel: settings.embeddingModel,
        }),
      });

      const payload = await res.json();
      if (!res.ok) throw new Error(payload.error || "Comparison failed");
      setData(payload as CompareResponse);
    } catch (err) {
      setError(formatGeminiError(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="compare-overlay" role="dialog" aria-modal="true">
      <div className="compare-panel">
        <header>
          <div>
            <div className="eyebrow">Retrieval diagnostics</div>
            <h2>Hybrid vs dense vs sparse</h2>
          </div>
          <button type="button" className="rename" onClick={onClose}>
            Close
          </button>
        </header>

        <form
          className="compare-form"
          onSubmit={(e) => {
            e.preventDefault();
            void run();
          }}
        >
          <input
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            placeholder="Question to compare retrievers on…"
          />
          <button type="submit" className="primary" disabled={busy || !question.trim()}>
            {busy ? "Running…" : "Compare"}
          </button>
        </form>

        {error && <p className="compare-error">{error}</p>}

        {data && (
          <>
            {!!data.overlap.length && (
              <div className="compare-overlap">
                {data.overlap.map((pair) => (
                  <span key={`${pair.a}-${pair.b}`}>
                    {pair.a} ∩ {pair.b}: {pair.shared} shared (Jaccard{" "}
                    {pair.jaccard.toFixed(2)})
                  </span>
                ))}
              </div>
            )}

            <div className="compare-grid">
              {data.runs.map((run) => (
                <section className="compare-column" key={run.mode}>
                  <h3>{run.mode}</h3>
                  <div className="compare-meta">
                    <span>
                      confidence {Math.round(run.retrievalConfidence * 100)}%
                    </span>
                    <span>
                      {run.stats.denseHits} dense · {run.stats.sparseHits} sparse
                    </span>
                    <span>{run.stats.durationMs} ms</span>
                  </div>

                  <ol className="compare-list">
                    {run.sources.map((source, index) => (
                      <li key={`${run.mode}-${source.chunkId ?? index}`}>
                        <div className="compare-source-head">
                          <strong>
                            {source.filename}
                            {source.heading ? ` › ${source.heading}` : ""}
                          </strong>
                          <small>page {source.page}</small>
                        </div>
                        <div className="source-badges">
                          {(source.retrievedBy ?? []).map((via) => (
                            <span className="badge" key={via}>
                              {via}
                            </span>
                          ))}
                          {typeof source.rerankScore === "number" && (
                            <span className="badge">
                              rerank {source.rerankScore.toFixed(2)}
                            </span>
                          )}
                          {typeof source.denseScore === "number" && (
                            <span className="badge">
                              cosine {source.denseScore.toFixed(3)}
                            </span>
                          )}
                          {typeof source.sparseScore === "number" && (
                            <span className="badge">
                              bm25 {source.sparseScore.toFixed(2)}
                            </span>
                          )}
                        </div>
                        <p>{source.text.slice(0, 260)}</p>
                      </li>
                    ))}
                    {!run.sources.length && <li className="compare-empty">No results.</li>}
                  </ol>
                </section>
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
