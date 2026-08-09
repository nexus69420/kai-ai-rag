import { describe, expect, it } from "vitest";

import {
  detectSourceType,
  htmlToText,
  normalizeText,
  splitHtmlSections,
  splitMarkdownSections,
  splitPlainTextSections,
} from "../src/lib/loaders";

describe("detectSourceType", () => {
  it("maps known extensions", () => {
    expect(detectSourceType("runbook.md")).toBe("markdown");
    expect(detectSourceType("Guide.MDX")).toBe("markdown");
    expect(detectSourceType("index.htm")).toBe("html");
    expect(detectSourceType("notes.txt")).toBe("text");
    expect(detectSourceType("slides.pdf")).toBe("pdf");
  });

  it("rejects unsupported extensions", () => {
    expect(detectSourceType("data.csv")).toBeNull();
    expect(detectSourceType("archive.zip")).toBeNull();
  });
});

describe("normalizeText", () => {
  it("collapses horizontal whitespace but keeps line structure", () => {
    expect(normalizeText("a    b\n\n\n\nc")).toBe("a b\n\nc");
  });
});

describe("splitMarkdownSections", () => {
  it("builds a heading breadcrumb from nesting", () => {
    const sections = splitMarkdownSections(
      ["# Runbook", "## Rollback", "Roll back within 15 minutes."].join("\n"),
    );
    const last = sections.at(-1)!;
    expect(last.heading).toBe("Runbook › Rollback");
    expect(last.text).toContain("15 minutes");
  });

  it("resets deeper headings when the level goes back up", () => {
    const sections = splitMarkdownSections(
      [
        "# Config",
        "## Ingest",
        "batch size",
        "## Ledger",
        "pool max",
      ].join("\n"),
    );
    expect(sections.map((s) => s.heading)).toEqual([
      "Config › Ingest",
      "Config › Ledger",
    ]);
  });

  it("does not treat hashes inside fenced code as headings", () => {
    const sections = splitMarkdownSections(
      ["# Setup", "```bash", "# not a heading", "make test", "```"].join("\n"),
    );
    expect(sections).toHaveLength(1);
    expect(sections[0].text).toContain("# not a heading");
  });

  it("supports setext headings", () => {
    const sections = splitMarkdownSections(
      ["Overview", "========", "Halogen ingests events."].join("\n"),
    );
    expect(sections[0].heading).toBe("Overview");
  });

  it("numbers sections sequentially", () => {
    const sections = splitMarkdownSections(
      ["## One", "a", "## Two", "b", "## Three", "c"].join("\n"),
    );
    expect(sections.map((s) => s.page)).toEqual([1, 2, 3]);
  });
});

describe("htmlToText", () => {
  it("strips tags, scripts, and entities", () => {
    const text = htmlToText(
      "<div>Rate limit is 2,000&nbsp;rpm<script>evil()</script></div>",
    );
    expect(text).toContain("2,000 rpm");
    expect(text).not.toContain("evil");
  });

  it("turns block boundaries into line breaks", () => {
    expect(htmlToText("<p>one</p><p>two</p>")).toBe("one\n\ntwo");
  });
});

describe("splitHtmlSections", () => {
  it("splits on headings and keeps a breadcrumb", () => {
    const sections = splitHtmlSections(
      "<html><head><title>Docs</title></head><body><h1>API</h1><p>intro</p><h2>Limits</h2><p>2,000 rpm</p></body></html>",
    );
    expect(sections.at(-1)!.heading).toBe("API › Limits");
    expect(sections.at(-1)!.text).toContain("2,000 rpm");
  });

  it("falls back to the document title when there are no headings", () => {
    const sections = splitHtmlSections(
      "<html><head><title>Notes</title></head><body><p>plain</p></body></html>",
    );
    expect(sections).toHaveLength(1);
    expect(sections[0].heading).toBe("Notes");
  });
});

describe("splitPlainTextSections", () => {
  it("groups paragraphs up to the target size", () => {
    const paragraph = "word ".repeat(120).trim();
    const sections = splitPlainTextSections(
      Array.from({ length: 8 }, () => paragraph).join("\n\n"),
    );
    expect(sections.length).toBeGreaterThan(1);
    expect(sections.every((section) => section.heading === null)).toBe(true);
    expect(sections.map((section) => section.page)).toEqual(
      sections.map((_, index) => index + 1),
    );
  });

  it("returns nothing for blank input", () => {
    expect(splitPlainTextSections("   \n\n  ")).toEqual([]);
  });
});
