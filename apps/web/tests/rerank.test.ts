import { describe, expect, it } from "vitest";

import { contentFingerprint } from "../src/lib/hash";
import { lexicalRerank, type Rerankable } from "../src/lib/rerank";

function passage(id: string, text: string): Rerankable {
  return { id, text, page: 1, filename: "doc.md" };
}

describe("lexicalRerank", () => {
  it("puts the passage matching the rarest query terms first", () => {
    const pool = [
      passage("a", "Halogen runs in three regions with active-active failover."),
      passage("b", "HALOGEN_LEDGER_POOL_MAX caps Postgres connections per pod."),
      passage("c", "Deploys are frozen on Fridays after 14:00 UTC."),
    ];

    const ranked = lexicalRerank("HALOGEN_LEDGER_POOL_MAX default", pool);
    expect(ranked[0].id).toBe("b");
  });

  it("produces scores inside the 0–1 range", () => {
    const ranked = lexicalRerank("regions", [
      passage("a", "three regions"),
      passage("b", "unrelated text"),
    ]);
    for (const item of ranked) {
      expect(item.rerankScore).toBeGreaterThanOrEqual(0);
      expect(item.rerankScore).toBeLessThanOrEqual(1);
    }
  });

  it("returns the pool unchanged when the query has no usable terms", () => {
    const pool = [passage("a", "one"), passage("b", "two")];
    expect(lexicalRerank("the a of", pool).map((p) => p.id)).toEqual(["a", "b"]);
  });

  it("considers the heading as well as the body", () => {
    const ranked = lexicalRerank("rollback", [
      passage("body", "Run the command and wait."),
      { ...passage("headed", "Run the command and wait."), heading: "Rollback procedure" },
    ]);
    expect(ranked[0].id).toBe("headed");
  });
});

describe("contentFingerprint", () => {
  it("ignores case and whitespace differences", () => {
    expect(contentFingerprint("Batch  size\nis 250")).toBe(
      contentFingerprint("batch size is 250"),
    );
  });

  it("distinguishes different punctuation, since config values depend on it", () => {
    expect(contentFingerprint("pool_max=20")).not.toBe(
      contentFingerprint("pool_max: 20"),
    );
  });
});
