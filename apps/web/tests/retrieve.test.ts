import { describe, expect, it } from "vitest";

import { normalizeWeights, weightedRrf, type Candidate } from "../src/lib/retrieve";

function candidate(id: string, overrides: Partial<Candidate> = {}): Candidate {
  return {
    id,
    chunkId: id,
    text: `text ${id}`,
    page: 1,
    chunkIndex: 0,
    documentId: "d1",
    filename: "doc.md",
    ...overrides,
  };
}

describe("normalizeWeights", () => {
  it("normalizes hybrid weights to sum to one", () => {
    expect(normalizeWeights("hybrid", 3, 1)).toEqual({
      denseWeight: 0.75,
      sparseWeight: 0.25,
    });
  });

  it("forces single-retriever weights for non-hybrid modes", () => {
    expect(normalizeWeights("dense", 0.2, 0.8)).toEqual({
      denseWeight: 1,
      sparseWeight: 0,
    });
    expect(normalizeWeights("sparse", 0.9, 0.1)).toEqual({
      denseWeight: 0,
      sparseWeight: 1,
    });
  });

  it("falls back to an even split when both weights are zero", () => {
    expect(normalizeWeights("hybrid", 0, 0)).toEqual({
      denseWeight: 0.5,
      sparseWeight: 0.5,
    });
  });
});

describe("weightedRrf", () => {
  it("ranks a document found by both retrievers above single-list hits", () => {
    const dense = [candidate("a"), candidate("b")];
    const sparse = [candidate("c"), candidate("a")];

    const fused = weightedRrf(
      [
        { list: dense, weight: 0.5, label: "dense" },
        { list: sparse, weight: 0.5, label: "sparse" },
      ],
      10,
    );

    expect(fused[0].id).toBe("a");
    expect(fused[0].retrievedBy).toEqual(["dense", "sparse"]);
  });

  it("respects the weighting when only one retriever found a document", () => {
    const dense = [candidate("dense-only")];
    const sparse = [candidate("sparse-only")];

    const denseHeavy = weightedRrf(
      [
        { list: dense, weight: 0.9, label: "dense" },
        { list: sparse, weight: 0.1, label: "sparse" },
      ],
      10,
    );
    expect(denseHeavy[0].id).toBe("dense-only");

    const sparseHeavy = weightedRrf(
      [
        { list: dense, weight: 0.1, label: "dense" },
        { list: sparse, weight: 0.9, label: "sparse" },
      ],
      10,
    );
    expect(sparseHeavy[0].id).toBe("sparse-only");
  });

  it("ignores lists with zero weight", () => {
    const fused = weightedRrf(
      [
        { list: [candidate("a")], weight: 1, label: "dense" },
        { list: [candidate("b")], weight: 0, label: "sparse" },
      ],
      10,
    );

    expect(fused.map((c) => c.id)).toEqual(["a"]);
  });

  it("preserves per-retriever ranks and scores", () => {
    const fused = weightedRrf(
      [
        { list: [candidate("x", { denseScore: 0.81 })], weight: 0.7, label: "dense" },
        { list: [candidate("y"), candidate("x", { sparseScore: 4.2 })], weight: 0.3, label: "sparse" },
      ],
      10,
    );

    const x = fused.find((c) => c.id === "x")!;
    expect(x.denseRank).toBe(1);
    expect(x.sparseRank).toBe(2);
    expect(x.denseScore).toBe(0.81);
    expect(x.sparseScore).toBe(4.2);
  });

  it("truncates to the requested limit", () => {
    const list = ["a", "b", "c", "d"].map((id) => candidate(id));
    const fused = weightedRrf([{ list, weight: 1, label: "dense" }], 2);
    expect(fused).toHaveLength(2);
  });
});
