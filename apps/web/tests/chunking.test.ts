import { describe, expect, it } from "vitest";

import { chunkDocument } from "../src/lib/chunking";
import { percentile } from "../src/lib/chunking/semantic";
import { recursiveSplit, splitSentences } from "../src/lib/chunking/text";
import type { ProcessedSection } from "../src/lib/db/schema";

const sections: ProcessedSection[] = [
  {
    page: 1,
    heading: "Configuration › Ingest settings",
    text: "HALOGEN_BATCH_SIZE controls how many events a worker pulls per poll. The default is 250 and the maximum is 500.",
  },
  {
    page: 2,
    heading: "Configuration › Ledger settings",
    text: "HALOGEN_LEDGER_POOL_MAX caps Postgres connections per pod. Exhausting the pool returns HLG-4022.",
  },
];

describe("splitSentences", () => {
  it("keeps bullets and table rows whole", () => {
    const units = splitSentences("- Sev1 acknowledges in 5 min.\n| a | b |");
    expect(units).toEqual(["- Sev1 acknowledges in 5 min.", "| a | b |"]);
  });

  it("splits long prose on sentence boundaries", () => {
    const long =
      "Halogen runs active-active across three regions and pins ledger writes to a home region. " +
      "That means a single ledger entry is only ever written by one region, which keeps commits serializable.";
    expect(splitSentences(long)).toHaveLength(2);
  });
});

describe("recursiveSplit", () => {
  it("returns the input untouched when it already fits", () => {
    expect(recursiveSplit("short text", 100, 10)).toEqual(["short text"]);
  });

  it("respects the size ceiling", () => {
    const text = Array.from({ length: 60 }, (_, i) => `sentence number ${i}.`).join(" ");
    const pieces = recursiveSplit(text, 200, 40);
    expect(pieces.length).toBeGreaterThan(1);
    for (const piece of pieces) {
      expect(piece.length).toBeLessThanOrEqual(200);
    }
  });

  it("loses no words across the split", () => {
    const text = Array.from({ length: 40 }, (_, i) => `token${i}`).join(" ");
    const joined = recursiveSplit(text, 120, 0).join(" ");
    for (let i = 0; i < 40; i++) {
      expect(joined).toContain(`token${i}`);
    }
  });

  it("returns nothing for blank input", () => {
    expect(recursiveSplit("   ", 100, 10)).toEqual([]);
  });
});

describe("percentile", () => {
  it("picks the nearest-rank value", () => {
    expect(percentile([0.1, 0.2, 0.3, 0.4], 50)).toBe(0.2);
    expect(percentile([0.1, 0.2, 0.3, 0.4], 100)).toBe(0.4);
  });

  it("never splits when there are no distances", () => {
    expect(percentile([], 90)).toBe(Number.POSITIVE_INFINITY);
  });
});

describe("chunkDocument", () => {
  it("tags every chunk with the strategy that produced it", async () => {
    const chunks = await chunkDocument(sections, { strategy: "fixed" });
    expect(chunks.length).toBeGreaterThan(0);
    expect(chunks.every((chunk) => chunk.strategy === "fixed")).toBe(true);
  });

  it("assigns contiguous chunk indexes", async () => {
    const chunks = await chunkDocument(sections, { strategy: "structural" });
    expect(chunks.map((chunk) => chunk.chunkIndex)).toEqual(
      chunks.map((_, index) => index),
    );
  });

  it("keeps the heading breadcrumb on structural chunks", async () => {
    const chunks = await chunkDocument(sections, {
      strategy: "structural",
      minChunkChars: 1,
    });
    expect(chunks[0].heading).toBe("Configuration › Ingest settings");
    expect(chunks[0].text).toContain("Configuration › Ingest settings");
  });

  it("never splits a structural chunk across sections", async () => {
    const chunks = await chunkDocument(sections, {
      strategy: "structural",
      chunkSize: 400,
      minChunkChars: 1,
    });
    for (const chunk of chunks) {
      const mentionsIngest = chunk.text.includes("HALOGEN_BATCH_SIZE");
      const mentionsLedger = chunk.text.includes("HALOGEN_LEDGER_POOL_MAX");
      expect(mentionsIngest && mentionsLedger).toBe(false);
    }
  });

  it("falls back to structural when semantic chunking has no embedder", async () => {
    const chunks = await chunkDocument(sections, { strategy: "semantic" });
    expect(chunks.every((chunk) => chunk.strategy === "structural")).toBe(true);
  });

  it("uses embedding distance to place semantic boundaries", async () => {
    const alpha = Array.from(
      { length: 5 },
      (_, i) => `Ledger commits are region pinned, note alpha ${i}.`,
    );
    const beta = Array.from(
      { length: 5 },
      (_, i) => `Webhook signatures use HMAC-SHA256, note beta ${i}.`,
    );
    const input: ProcessedSection[] = [
      { page: 1, heading: null, text: [...alpha, ...beta].join("\n") },
    ];

    const chunks = await chunkDocument(input, {
      strategy: "semantic",
      minChunkChars: 1,
      chunkSize: 2000,
      semanticBreakpointPercentile: 50,
      // Vector counts topic markers in each sentence window, so consecutive
      // windows only diverge where the topic actually turns over.
      embed: async (texts) =>
        texts.map((text) => [
          (text.match(/alpha/g) ?? []).length,
          (text.match(/beta/g) ?? []).length,
        ]),
    });

    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks.every((chunk) => chunk.strategy === "semantic")).toBe(true);

    // No chunk should straddle the topic change.
    const straddling = chunks.filter(
      (chunk) => chunk.text.includes("alpha") && chunk.text.includes("beta"),
    );
    expect(straddling).toHaveLength(0);
  });

  it("drops empty sections", async () => {
    const chunks = await chunkDocument(
      [{ page: 1, heading: null, text: "   " }],
      { strategy: "fixed" },
    );
    expect(chunks).toEqual([]);
  });
});
