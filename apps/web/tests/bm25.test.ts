import { describe, expect, it } from "vitest";

import { Bm25Index, conservativeStem, tokenize } from "../src/lib/bm25";

const docs = [
  {
    id: "c1",
    documentId: "d1",
    page: 1,
    chunkIndex: 0,
    heading: "Ledger settings",
    text: "HALOGEN_LEDGER_POOL_MAX defaults to 20. Exhausting the pool returns HLG-4022 to clients.",
  },
  {
    id: "c2",
    documentId: "d1",
    page: 2,
    chunkIndex: 1,
    heading: "Ingest settings",
    text: "HALOGEN_BATCH_SIZE defaults to 250 with a maximum of 500 events per poll.",
  },
  {
    id: "c3",
    documentId: "d2",
    page: 1,
    chunkIndex: 0,
    heading: "Overview",
    text: "Halogen runs active-active in three regions and archives raw events for seven years.",
  },
];

describe("tokenize", () => {
  it("keeps identifiers whole and also emits their parts", () => {
    const tokens = tokenize("HALOGEN_LEDGER_POOL_MAX");
    expect(tokens).toContain("halogen_ledger_pool_max");
    expect(tokens).toContain("ledger");
    expect(tokens).toContain("max");
  });

  it("preserves error codes as single tokens", () => {
    expect(tokenize("Returns HLG-4022 to clients")).toContain("hlg-4022");
  });

  it("drops stopwords and single letters", () => {
    expect(tokenize("the a of x")).toEqual([]);
  });
});

describe("conservativeStem", () => {
  it("normalizes simple plurals", () => {
    expect(conservativeStem("regions")).toBe("region");
    expect(conservativeStem("policies")).toBe("policy");
  });

  it("leaves identifiers and -ss words alone", () => {
    expect(conservativeStem("halogen_batch_size")).toBe("halogen_batch_size");
    expect(conservativeStem("access")).toBe("access");
  });
});

describe("Bm25Index", () => {
  const index = new Bm25Index(docs);

  it("indexes every non-empty document", () => {
    expect(index.size).toBe(3);
  });

  it("ranks the chunk containing the exact identifier first", () => {
    const [top] = index.search("HALOGEN_BATCH_SIZE default", { limit: 3 });
    expect(top.id).toBe("c2");
  });

  it("matches error codes exactly", () => {
    const hits = index.search("HLG-4022", { limit: 3 });
    expect(hits[0].id).toBe("c1");
  });

  it("restricts results to the requested documents", () => {
    const hits = index.search("regions", { limit: 5, documentIds: ["d1"] });
    expect(hits).toHaveLength(0);
  });

  it("returns nothing for a query with no indexed terms", () => {
    expect(index.search("kubernetes istio sidecar", { limit: 5 })).toHaveLength(0);
  });

  it("scores term coverage against the corpus", () => {
    expect(index.termCoverage("HALOGEN_BATCH_SIZE")).toBe(1);
    expect(index.termCoverage("bigquery snowflake")).toBe(0);
    expect(index.termCoverage("HLG-4022 bigquery")).toBeCloseTo(0.5, 5);
  });

  it("scopes term coverage to the selected documents", () => {
    expect(index.termCoverage("regions", ["d1"])).toBe(0);
    expect(index.termCoverage("regions", ["d2"])).toBe(1);
  });
});
