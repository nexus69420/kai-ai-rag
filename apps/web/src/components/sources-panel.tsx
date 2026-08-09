"use client";

import { useEffect, useState } from "react";

import type { CitationReport, SourcePayload } from "@/lib/db/schema";

type Verification = "supported" | "partial" | "unsupported" | "unused" | null;

export function SourcesPanel({
  sources,
  citations,
  focused,
  focusSeq,
  open,
  onToggle,
}: {
  sources: SourcePayload[];
  citations?: CitationReport;
  /** Citation number the user clicked in the answer. */
  focused?: number | null;
  /** Bumped on every chip click so re-clicking the same one scrolls again. */
  focusSeq?: number;
  /**
   * Owned by the parent: clicking a citation chip has to expand the matching
   * message's panel, and the parent is what knows a chip was clicked.
   */
  open: boolean;
  onToggle: () => void;
}) {
  const [preview, setPreview] = useState<string | null>(null);

  useEffect(() => {
    if (!focused || !open) return;
    const element = document.getElementById(`kai-source-${focused}`);
    element?.scrollIntoView({ behavior: "smooth", block: "center" });
  }, [focused, focusSeq, open]);

  if (!sources?.length) return null;

  const statusByCitation = buildStatusMap(sources, citations);

  return (
    <div className="sources">
      <button type="button" className="source-toggle" onClick={onToggle}>
        <span>{sources.length}</span>
        Retrieved passages
        <b>{open ? "−" : "+"}</b>
      </button>

      {open && (
        <div className="source-list">
          {sources.map((source, index) => {
            const citation = source.citation ?? index + 1;
            const key = `${source.documentId}-${citation}`;
            const fileUrl = `/api/documents/${source.documentId}/file#page=${source.page}`;
            const showPreview = preview === key;
            const status = statusByCitation.get(citation) ?? null;

            return (
              <div
                className="source"
                id={`kai-source-${citation}`}
                data-status={status ?? undefined}
                data-focused={focused === citation ? "true" : undefined}
                key={key}
              >
                <div className="source-head">
                  <strong>[{citation}]</strong>
                  <span>
                    {source.filename}
                    {source.heading ? ` › ${source.heading}` : ""} · page{" "}
                    {source.page}
                  </span>
                  {status && (
                    <em className="source-status" data-status={status}>
                      {statusLabel(status)}
                    </em>
                  )}
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

                <p>{source.text}</p>

                <div className="source-actions">
                  <button
                    type="button"
                    className="rename"
                    onClick={() => setPreview(showPreview ? null : key)}
                  >
                    {showPreview ? "Hide original" : "Open original"}
                  </button>
                </div>

                {showPreview && (
                  <div className="pdf-preview">
                    <iframe title={`Source ${citation}`} src={fileUrl} />
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

/**
 * Maps each source number to the strongest verdict that referenced it, so a
 * passage the answer misused is visibly marked next to its text.
 */
function buildStatusMap(
  sources: SourcePayload[],
  citations?: CitationReport,
): Map<number, Verification> {
  const map = new Map<number, Verification>();
  if (!citations?.verified) return map;

  for (const verdict of citations.verdicts) {
    for (const citation of verdict.citations) {
      const current = map.get(citation);
      const next: Verification =
        verdict.status === "unverified" ? null : verdict.status;
      if (!next) continue;
      if (current === "unsupported") continue;
      if (current === "partial" && next === "supported") continue;
      map.set(citation, next);
    }
  }

  for (const unused of citations.unusedSources) {
    if (!map.has(unused)) map.set(unused, "unused");
  }

  return map;
}

function statusLabel(status: Verification) {
  switch (status) {
    case "supported":
      return "supports the answer";
    case "partial":
      return "partially supports";
    case "unsupported":
      return "does not support";
    case "unused":
      return "retrieved, not cited";
    default:
      return "";
  }
}
