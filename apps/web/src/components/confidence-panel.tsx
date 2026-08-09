"use client";

import { useState } from "react";

import type {
  CitationReport,
  ConfidenceReport,
  RetrievalStats,
} from "@/lib/db/schema";

const STATUS_LABELS: Record<string, string> = {
  supported: "Verified",
  partial: "Partial",
  unsupported: "Unsupported",
  unverified: "Not checked",
};

export function ConfidencePanel({
  confidence,
  citations,
  stats,
  abstained,
}: {
  confidence?: ConfidenceReport;
  citations?: CitationReport;
  stats?: RetrievalStats;
  abstained?: boolean;
}) {
  const [open, setOpen] = useState(false);

  if (!confidence) return null;

  const flagged =
    citations?.verdicts.filter(
      (verdict) => verdict.status === "unsupported" || verdict.status === "partial",
    ) ?? [];

  return (
    <div className="confidence" data-band={confidence.band}>
      <button
        type="button"
        className="confidence-toggle"
        onClick={() => setOpen((v) => !v)}
      >
        <span className="confidence-dot" />
        <strong>{Math.round(confidence.score * 100)}% confidence</strong>
        <span className="confidence-band">{confidence.band}</span>
        {abstained && <span className="confidence-tag">declined to answer</span>}
        {!!flagged.length && (
          <span className="confidence-tag warn">
            {flagged.length} claim{flagged.length > 1 ? "s" : ""} flagged
          </span>
        )}
        <b>{open ? "−" : "+"}</b>
      </button>

      {open && (
        <div className="confidence-body">
          <div className="confidence-bars">
            <Meter label="Retrieval" value={confidence.retrieval} />
            <Meter label="Citation coverage" value={confidence.citationCoverage} />
            <Meter label="Completeness" value={confidence.completeness} />
          </div>

          {!!confidence.reasons.length && (
            <ul className="confidence-reasons">
              {confidence.reasons.map((reason) => (
                <li key={reason}>{reason}</li>
              ))}
            </ul>
          )}

          {stats && (
            <dl className="confidence-stats">
              <Stat label="Mode" value={stats.mode} />
              <Stat
                label="Fusion"
                value={`${Math.round(stats.denseWeight * 100)}/${Math.round(stats.sparseWeight * 100)}`}
              />
              <Stat label="Dense hits" value={String(stats.denseHits)} />
              <Stat label="Sparse hits" value={String(stats.sparseHits)} />
              <Stat label="Candidates" value={String(stats.fusedCandidates)} />
              <Stat
                label="Rerank"
                value={stats.rerankUsed ? (stats.rerankBackend ?? "on") : "off"}
              />
              <Stat
                label="Top similarity"
                value={stats.topDenseScore.toFixed(3)}
              />
              <Stat
                label="Keyword coverage"
                value={`${Math.round(stats.keywordCoverage * 100)}%`}
              />
              <Stat label="Retrieval time" value={`${stats.durationMs} ms`} />
            </dl>
          )}

          {citations?.verified && (
            <div className="verdicts">
              <div className="verdicts-head">
                {citations.supportedClaims}/{citations.totalClaims} claims
                verified
                {citations.miscitedClaims > 0 &&
                  ` · ${citations.miscitedClaims} miscited`}
                {citations.invalidCitations.length > 0 &&
                  ` · invalid ${citations.invalidCitations.map((n) => `[${n}]`).join(" ")}`}
              </div>
              {citations.verdicts.map((verdict, index) => (
                <div
                  className="verdict"
                  data-status={verdict.status}
                  key={`${index}-${verdict.claim.slice(0, 24)}`}
                >
                  <span className="verdict-status">
                    {STATUS_LABELS[verdict.status] ?? verdict.status}
                  </span>
                  <p>{verdict.claim}</p>
                  <small>
                    cited{" "}
                    {verdict.citations.length
                      ? verdict.citations.map((n) => `[${n}]`).join("")
                      : "nothing"}
                    {verdict.supportedBy.length
                      ? ` · supported by ${verdict.supportedBy.map((n) => `[${n}]`).join("")}`
                      : ""}
                    {verdict.reason ? ` · ${verdict.reason}` : ""}
                  </small>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function Meter({ label, value }: { label: string; value: number }) {
  const percent = Math.round(Math.min(1, Math.max(0, value)) * 100);
  return (
    <div className="meter">
      <span>{label}</span>
      <div className="meter-track">
        <div className="meter-fill" style={{ width: `${percent}%` }} />
      </div>
      <b>{percent}%</b>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="stat">
      <dt>{label}</dt>
      <dd>{value}</dd>
    </div>
  );
}
