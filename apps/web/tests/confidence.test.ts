import { describe, expect, it } from "vitest";

import {
  citationScore,
  scoreAnswer,
  scoreRetrievalConfidence,
} from "../src/lib/confidence";
import type { CitationReport, RetrievalStats } from "../src/lib/db/schema";

function stats(overrides: Partial<RetrievalStats> = {}): RetrievalStats {
  return {
    mode: "hybrid",
    denseWeight: 0.7,
    sparseWeight: 0.3,
    denseHits: 12,
    sparseHits: 9,
    fusedCandidates: 18,
    rerankUsed: true,
    rerankBackend: "gemini",
    topDenseScore: 0.82,
    meanRerankScore: 0.9,
    keywordCoverage: 1,
    documentsSearched: 8,
    passagesReturned: 5,
    durationMs: 900,
    ...overrides,
  };
}

function citations(overrides: Partial<CitationReport> = {}): CitationReport {
  return {
    verified: true,
    totalClaims: 4,
    citedClaims: 4,
    supportedClaims: 4,
    unsupportedClaims: 0,
    groundedClaims: 4,
    miscitedClaims: 0,
    invalidCitations: [],
    unusedSources: [],
    verdicts: [],
    ...overrides,
  };
}

describe("scoreRetrievalConfidence", () => {
  it("is high when rerank, similarity, and keyword coverage all agree", () => {
    expect(scoreRetrievalConfidence(stats())).toBeGreaterThan(0.85);
  });

  it("is zero when nothing was retrieved", () => {
    expect(
      scoreRetrievalConfidence(
        stats({ passagesReturned: 0, fusedCandidates: 0 }),
      ),
    ).toBe(0);
  });

  it("collapses when the question's terms are absent from the corpus", () => {
    const score = scoreRetrievalConfidence(
      stats({ topDenseScore: 0.56, meanRerankScore: 0.05, keywordCoverage: 0 }),
    );
    expect(score).toBeLessThan(0.35);
  });

  it("falls back to similarity and keywords without a rerank score", () => {
    const score = scoreRetrievalConfidence(stats({ meanRerankScore: null }));
    expect(score).toBeGreaterThan(0.5);
    expect(score).toBeLessThanOrEqual(1);
  });

  it("uses keyword coverage as the only dense-free signal in sparse mode", () => {
    expect(
      scoreRetrievalConfidence(
        stats({ mode: "sparse", meanRerankScore: null, keywordCoverage: 0.4 }),
      ),
    ).toBeCloseTo(0.4, 5);
  });

  it("stays within 0 and 1 for out-of-range similarity", () => {
    expect(scoreRetrievalConfidence(stats({ topDenseScore: 5 }))).toBeLessThanOrEqual(1);
    expect(scoreRetrievalConfidence(stats({ topDenseScore: -1 }))).toBeGreaterThanOrEqual(0);
  });
});

describe("citationScore", () => {
  it("gives full credit when every claim is verified", () => {
    expect(citationScore(citations())).toBe(1);
  });

  it("gives partial credit to unverified answers that at least cite", () => {
    expect(citationScore(citations({ verified: false }))).toBeCloseTo(0.6, 5);
  });

  it("penalizes invalid source numbers", () => {
    expect(citationScore(citations({ invalidCitations: [9] }))).toBeCloseTo(0.85, 5);
  });

  it("penalizes claims attached to the wrong source", () => {
    expect(citationScore(citations({ miscitedClaims: 2 }))).toBeCloseTo(0.85, 5);
  });

  it("is zero with no claims to score", () => {
    expect(citationScore(citations({ totalClaims: 0 }))).toBe(0);
  });
});

describe("scoreAnswer", () => {
  it("bands a fully verified, complete answer as high", () => {
    const report = scoreAnswer({
      stats: stats(),
      citations: citations(),
      completeness: 1,
    });
    expect(report.band).toBe("high");
    expect(report.score).toBeGreaterThan(0.9);
    expect(report.reasons).toEqual([
      "All claims verified against retrieved sources.",
    ]);
  });

  it("drops to low when claims are unsupported", () => {
    const report = scoreAnswer({
      stats: stats({ topDenseScore: 0.6, meanRerankScore: 0.3, keywordCoverage: 0.4 }),
      citations: citations({ supportedClaims: 1, unsupportedClaims: 3, groundedClaims: 1 }),
      completeness: 0.5,
    });
    expect(report.band).toBe("low");
    expect(report.reasons.join(" ")).toContain("not supported");
  });

  it("explains a lexical rerank fallback", () => {
    const report = scoreAnswer({
      stats: stats({ rerankBackend: "lexical" }),
      citations: citations(),
      completeness: 1,
    });
    expect(report.reasons.join(" ")).toContain("lexical fallback");
  });

  it("explains when only one retriever contributed in hybrid mode", () => {
    const report = scoreAnswer({
      stats: stats({ sparseHits: 0 }),
      citations: citations(),
      completeness: 1,
    });
    expect(report.reasons.join(" ")).toContain("Only one retriever");
  });

  it("never leaves the 0–1 range", () => {
    const report = scoreAnswer({
      stats: stats({ topDenseScore: 9, meanRerankScore: 9, keywordCoverage: 9 }),
      citations: citations(),
      completeness: 9,
    });
    expect(report.score).toBeLessThanOrEqual(1);
  });
});
