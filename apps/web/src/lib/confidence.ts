import type {
  CitationReport,
  ConfidenceReport,
  RetrievalStats,
} from "./db/schema";

export const DEFAULT_ABSTAIN_THRESHOLD = 0.35;

/**
 * Empirical cosine band for this embedding model: relevant passages land above
 * ~0.85, clearly unrelated ones below ~0.55. Values are mapped into 0–1 so the
 * threshold is interpretable instead of being a raw similarity.
 */
const DENSE_FLOOR = 0.55;
const DENSE_CEILING = 0.85;

const WEIGHTS = {
  retrieval: 0.4,
  citations: 0.35,
  completeness: 0.25,
} as const;

/**
 * How much to trust that the right evidence was found, before generation.
 * Used as the abstain gate, so it must not depend on the answer text.
 */
export function scoreRetrievalConfidence(stats: RetrievalStats): number {
  const dense = normalizeDense(stats.topDenseScore);
  const keyword = clamp01(stats.keywordCoverage);
  const rerank =
    typeof stats.meanRerankScore === "number"
      ? clamp01(stats.meanRerankScore)
      : null;

  if (!stats.passagesReturned && !stats.fusedCandidates) return 0;

  if (rerank !== null) {
    if (stats.mode === "sparse") {
      return round(clamp01(0.7 * rerank + 0.3 * keyword));
    }
    return round(clamp01(0.55 * rerank + 0.3 * dense + 0.15 * keyword));
  }

  if (stats.mode === "sparse") return round(keyword);
  return round(clamp01(0.65 * dense + 0.35 * keyword));
}

export function scoreAnswer(options: {
  stats: RetrievalStats;
  citations: CitationReport;
  completeness: number;
}): ConfidenceReport {
  const retrieval = scoreRetrievalConfidence(options.stats);
  const citationCoverage = citationScore(options.citations);
  const completeness = clamp01(options.completeness);

  const score = round(
    clamp01(
      WEIGHTS.retrieval * retrieval +
        WEIGHTS.citations * citationCoverage +
        WEIGHTS.completeness * completeness,
    ),
  );

  return {
    score,
    band: score >= 0.7 ? "high" : score >= 0.45 ? "medium" : "low",
    retrieval,
    citationCoverage: round(citationCoverage),
    completeness: round(completeness),
    reasons: explain(options.stats, options.citations, {
      retrieval,
      citationCoverage,
      completeness,
    }),
  };
}

/** Share of claims whose cited sources were confirmed to support them. */
export function citationScore(report: CitationReport): number {
  if (!report.totalClaims) return 0;

  if (!report.verified) {
    // Unverified answers get partial credit for citing at all.
    return clamp01((report.citedClaims / report.totalClaims) * 0.6);
  }

  const supported = report.supportedClaims / report.totalClaims;
  const invalidPenalty = report.invalidCitations.length ? 0.15 : 0;
  const miscitePenalty = (report.miscitedClaims / report.totalClaims) * 0.3;
  return clamp01(supported - invalidPenalty - miscitePenalty);
}

function explain(
  stats: RetrievalStats,
  citations: CitationReport,
  scores: { retrieval: number; citationCoverage: number; completeness: number },
): string[] {
  const reasons: string[] = [];

  if (scores.retrieval < 0.5) {
    reasons.push(
      `Weak retrieval signal (top similarity ${stats.topDenseScore.toFixed(2)}, keyword coverage ${pct(stats.keywordCoverage)}).`,
    );
  }
  if (stats.mode === "hybrid" && (!stats.denseHits || !stats.sparseHits)) {
    reasons.push(
      `Only one retriever returned results (${stats.denseHits} dense, ${stats.sparseHits} sparse).`,
    );
  }
  if (!stats.rerankUsed) {
    reasons.push("Reranking was skipped, so passage ordering is unfiltered.");
  } else if (stats.rerankBackend === "lexical") {
    reasons.push("LLM reranker was unavailable; lexical fallback was used.");
  }
  if (!citations.verified) {
    reasons.push("Citations were not verified against the sources.");
  } else {
    if (citations.unsupportedClaims) {
      reasons.push(
        `${citations.unsupportedClaims} of ${citations.totalClaims} claims were not supported by any retrieved source.`,
      );
    }
    if (citations.miscitedClaims) {
      reasons.push(
        `${citations.miscitedClaims} claims cited the wrong source number.`,
      );
    }
    if (citations.invalidCitations.length) {
      reasons.push(
        `Answer referenced non-existent sources: ${citations.invalidCitations.map((n) => `[${n}]`).join(", ")}.`,
      );
    }
  }
  if (scores.completeness < 0.75) {
    reasons.push("Part of the question appears unanswered.");
  }
  if (!reasons.length) {
    reasons.push("All claims verified against retrieved sources.");
  }

  return reasons;
}

function normalizeDense(score: number) {
  if (!Number.isFinite(score) || score <= 0) return 0;
  return clamp01((score - DENSE_FLOOR) / (DENSE_CEILING - DENSE_FLOOR));
}

function clamp01(value: number) {
  if (!Number.isFinite(value)) return 0;
  return Math.min(1, Math.max(0, value));
}

function round(value: number) {
  return Math.round(value * 1000) / 1000;
}

function pct(value: number) {
  return `${Math.round(clamp01(value) * 100)}%`;
}
