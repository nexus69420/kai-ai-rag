import { describe, expect, it } from "vitest";

import {
  extractCitationNumbers,
  parseCitations,
  stripCitations,
} from "../src/lib/citations";
import { linkifyCitations } from "../src/components/answer-markdown";

describe("extractCitationNumbers", () => {
  it("reads adjacent and comma-separated markers", () => {
    expect(extractCitationNumbers("Limit is 500 [1][3] and 2000/min [2, 4].")).toEqual([
      1, 2, 3, 4,
    ]);
  });

  it("ignores ranges the prompt forbids", () => {
    expect(extractCitationNumbers("See [1-3].")).toEqual([]);
  });
});

describe("stripCitations", () => {
  it("removes markers and collapses the leftover spacing", () => {
    expect(stripCitations("Batch max is 500 [2] events.")).toBe(
      "Batch max is 500 events.",
    );
  });
});

describe("parseCitations", () => {
  it("splits sentences and bullets into separate claims", () => {
    const parsed = parseCitations(
      [
        "The payload limit is 512 KB [1]. Batches cap at 500 events [1].",
        "- Rate limit is 2,000 requests per minute [2]",
        "- Burst allowance is 300 requests [2]",
      ].join("\n"),
      2,
    );

    expect(parsed.claims).toHaveLength(4);
    expect(parsed.citedClaims).toHaveLength(4);
    expect(parsed.uncitedClaims).toHaveLength(0);
  });

  it("flags citations that point at sources which were not retrieved", () => {
    const parsed = parseCitations("Keys rotate every 90 days [7].", 3);
    expect(parsed.invalidCitations).toEqual([7]);
  });

  it("reports retrieved sources the answer never used", () => {
    const parsed = parseCitations("The default batch size is 250 [2].", 4);
    expect(parsed.unusedSources).toEqual([1, 3, 4]);
  });

  it("separates uncited factual claims from cited ones", () => {
    const parsed = parseCitations(
      "The default is 250 [1]. It can probably be raised safely.",
      1,
    );
    expect(parsed.citedClaims).toHaveLength(1);
    expect(parsed.uncitedClaims).toHaveLength(1);
    expect(parsed.uncitedClaims[0].text).toContain("raised safely");
  });

  it("skips headings, short labels, and questions", () => {
    const parsed = parseCitations(
      [
        "## Summary",
        "**Rate limits:**",
        "Which environment did you mean?",
        "Requests are capped at 2,000 per minute [1].",
      ].join("\n"),
      1,
    );

    expect(parsed.claims).toHaveLength(1);
    expect(parsed.claims[0].citations).toEqual([1]);
  });

  it("ignores bracketed numbers inside fenced code", () => {
    const parsed = parseCitations(
      ["Use the CLI [1].", "```bash", "echo ${items[2]}", "```"].join("\n"),
      1,
    );

    expect(parsed.citedNumbers).toEqual([1]);
  });
});

describe("linkifyCitations", () => {
  it("turns markers into anchor links", () => {
    expect(linkifyCitations("Capped at 512 KB [1].")).toBe(
      "Capped at 512 KB [1](#kai-source-1).",
    );
  });

  it("expands grouped markers into one link each", () => {
    expect(linkifyCitations("Both apply [1, 2].")).toBe(
      "Both apply [1](#kai-source-1)[2](#kai-source-2).",
    );
  });

  it("leaves code spans untouched", () => {
    expect(linkifyCitations("Read `items[0]` first [1].")).toBe(
      "Read `items[0]` first [1](#kai-source-1).",
    );
  });
});
