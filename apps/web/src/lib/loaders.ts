import type { ProcessedSection } from "./db/schema";
import {
  detectSourceType,
  SUPPORTED_EXTENSIONS,
  type SourceType,
} from "./formats";
import { extractPdfPages } from "./pdf";

export {
  detectSourceType,
  isSupportedFilename,
  SUPPORTED_EXTENSIONS,
} from "./formats";
export type { SourceType } from "./formats";

export type LoadedDocument = {
  sourceType: SourceType;
  /** Normalized plaintext blocks with structural metadata. */
  sections: ProcessedSection[];
  /** PDF page count, or section count for text formats. */
  pageCount: number;
};

/**
 * Collapses horizontal whitespace while preserving the line breaks that carry
 * meaning in slides, bullet lists, and code blocks.
 */
export function normalizeText(raw: string) {
  return String(raw ?? "")
    .replace(/\r\n?/g, "\n")
    .replace(/\u00a0/g, " ")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/[ \t]{2,}/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export async function loadDocument(options: {
  filename: string;
  buffer: Buffer;
}): Promise<LoadedDocument> {
  const sourceType = detectSourceType(options.filename);
  if (!sourceType) {
    throw new Error(
      `Unsupported file type. Supported: ${SUPPORTED_EXTENSIONS.join(", ")}`,
    );
  }

  if (sourceType === "pdf") {
    const pages = await extractPdfPages(options.buffer);
    const sections = pages.map((page) => ({
      page: page.page,
      heading: inferPdfHeading(page.text),
      text: normalizeText(page.text),
    }));
    return { sourceType, sections, pageCount: sections.length };
  }

  const raw = options.buffer.toString("utf8");
  const sections =
    sourceType === "markdown"
      ? splitMarkdownSections(raw)
      : sourceType === "html"
        ? splitHtmlSections(raw)
        : splitPlainTextSections(raw);

  if (!sections.length) {
    throw new Error("No readable text found in this file.");
  }

  return { sourceType, sections, pageCount: sections.length };
}

/** Slide decks and reports usually open with a short title line. */
function inferPdfHeading(pageText: string): string | null {
  const firstLine = normalizeText(pageText).split("\n")[0]?.trim() ?? "";
  if (!firstLine || firstLine.length > 120) return null;
  if (/[.!?]$/.test(firstLine) && firstLine.split(" ").length > 12) return null;
  return firstLine;
}

const FENCE_RE = /^\s*(```|~~~)/;

/**
 * Splits markdown on ATX/setext headings and records the heading breadcrumb so
 * retrieval can show "Runbook › Rollback › Step 2" instead of a bare page.
 */
export function splitMarkdownSections(raw: string): ProcessedSection[] {
  const lines = normalizeText(raw).split("\n");
  const sections: ProcessedSection[] = [];
  const trail: string[] = [];
  let buffer: string[] = [];
  let heading: string | null = null;
  let inFence = false;

  const flush = () => {
    const text = normalizeText(buffer.join("\n"));
    if (text) {
      sections.push({ page: sections.length + 1, heading, text });
    }
    buffer = [];
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    if (FENCE_RE.test(line)) {
      inFence = !inFence;
      buffer.push(line);
      continue;
    }
    if (inFence) {
      buffer.push(line);
      continue;
    }

    const atx = /^(#{1,6})\s+(.*\S)\s*$/.exec(line);
    const setextUnderline =
      !atx && /^(=+|-{2,})\s*$/.test(line) && (buffer.at(-1)?.trim() ?? "");

    if (atx || setextUnderline) {
      let level: number;
      let title: string;

      if (atx) {
        level = atx[1].length;
        title = atx[2].trim();
      } else {
        level = line.trim().startsWith("=") ? 1 : 2;
        title = buffer.pop()!.trim();
      }

      flush();
      trail.length = Math.max(0, level - 1);
      trail[level - 1] = title;
      heading = trail.filter(Boolean).join(" › ");
      continue;
    }

    buffer.push(line);
  }

  flush();
  return sections.length ? sections : splitPlainTextSections(raw);
}

const BLOCK_TAGS =
  "address|article|aside|blockquote|dd|div|dl|dt|fieldset|figcaption|figure|footer|form|h[1-6]|header|hr|li|main|nav|ol|p|pre|section|table|tbody|td|tfoot|th|thead|tr|ul";

export function htmlToText(raw: string) {
  return normalizeText(
    String(raw ?? "")
      .replace(/<!--[\s\S]*?-->/g, " ")
      .replace(/<(script|style|noscript|template)[\s\S]*?<\/\1>/gi, " ")
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(new RegExp(`</(?:${BLOCK_TAGS})>`, "gi"), "\n\n")
      .replace(new RegExp(`<(?:${BLOCK_TAGS})\\b[^>]*>`, "gi"), "\n")
      .replace(/<[^>]+>/g, " ")
      .replace(/&nbsp;/gi, " ")
      .replace(/&amp;/gi, "&")
      .replace(/&lt;/gi, "<")
      .replace(/&gt;/gi, ">")
      .replace(/&quot;/gi, '"')
      .replace(/&#39;|&apos;/gi, "'")
      .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code))),
  );
}

/** Uses h1–h6 as section boundaries; falls back to whole-page text. */
export function splitHtmlSections(raw: string): ProcessedSection[] {
  const body = /<body[^>]*>([\s\S]*?)<\/body>/i.exec(raw)?.[1] ?? raw;
  const docTitle = /<title[^>]*>([\s\S]*?)<\/title>/i
    .exec(raw)?.[1]
    ?.trim();

  const parts = body.split(/(?=<h[1-6]\b)/i);
  const sections: ProcessedSection[] = [];
  const trail: string[] = [];

  for (const part of parts) {
    const headingMatch = /<h([1-6])\b[^>]*>([\s\S]*?)<\/h\1>/i.exec(part);
    let heading: string | null = docTitle ?? null;

    if (headingMatch) {
      const level = Number(headingMatch[1]);
      const title = htmlToText(headingMatch[2]);
      trail.length = Math.max(0, level - 1);
      trail[level - 1] = title;
      heading = trail.filter(Boolean).join(" › ");
    }

    const text = htmlToText(part);
    if (!text) continue;
    sections.push({ page: sections.length + 1, heading, text });
  }

  if (sections.length) return sections;
  const text = htmlToText(body);
  return text ? [{ page: 1, heading: docTitle ?? null, text }] : [];
}

/** Plain text has no structure, so blank-line groups become the sections. */
export function splitPlainTextSections(raw: string): ProcessedSection[] {
  const normalized = normalizeText(raw);
  if (!normalized) return [];

  const paragraphs = normalized.split(/\n{2,}/);
  const sections: ProcessedSection[] = [];
  let buffer: string[] = [];
  const TARGET = 1800;

  const flush = () => {
    const text = normalizeText(buffer.join("\n\n"));
    if (text) sections.push({ page: sections.length + 1, heading: null, text });
    buffer = [];
  };

  for (const paragraph of paragraphs) {
    buffer.push(paragraph);
    if (buffer.join("\n\n").length >= TARGET) flush();
  }
  flush();

  return sections;
}
