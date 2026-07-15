import type { PageText } from "./pdf";

export type TextChunk = {
  text: string;
  page: number;
  chunkIndex: number;
};

const DEFAULT_SIZE = 850;
const DEFAULT_OVERLAP = 150;
/** Slide decks often extract tiny title-only pages — merge until we hit this. */
const MIN_CHUNK_CHARS = 400;

export function chunkPages(
  pages: PageText[],
  chunkSize = DEFAULT_SIZE,
  overlap = DEFAULT_OVERLAP,
): TextChunk[] {
  // Merge consecutive short pages first (common for lecture slides).
  const mergedPages = mergeShortPages(pages, MIN_CHUNK_CHARS);

  const chunks: TextChunk[] = [];
  let chunkIndex = 0;

  for (const page of mergedPages) {
    const text = page.text;
    if (text.length <= chunkSize) {
      chunks.push({ text, page: page.page, chunkIndex: chunkIndex++ });
      continue;
    }

    let start = 0;
    while (start < text.length) {
      const end = Math.min(start + chunkSize, text.length);
      let slice = text.slice(start, end).trim();
      // Prefer breaking on sentence/newline boundaries when possible.
      if (end < text.length) {
        const soft = Math.max(slice.lastIndexOf("\n"), slice.lastIndexOf(". "));
        if (soft > chunkSize * 0.5) {
          slice = slice.slice(0, soft + 1).trim();
        }
      }
      if (slice) {
        chunks.push({ text: slice, page: page.page, chunkIndex: chunkIndex++ });
      }
      if (end >= text.length) break;
      const advanced = slice.length > 0 ? slice.length : chunkSize - overlap;
      start = Math.max(0, start + advanced - overlap);
      if (advanced <= 0) start = end;
    }
  }

  return mergeTinyChunks(chunks, MIN_CHUNK_CHARS);
}

function mergeShortPages(pages: PageText[], minChars: number): PageText[] {
  const out: PageText[] = [];
  let buffer = "";
  let startPage = 1;

  for (const page of pages) {
    if (!buffer) {
      buffer = page.text;
      startPage = page.page;
      continue;
    }

    const combined = `${buffer}\n\n${page.text}`;
    // Keep packing short pages together; flush when we hit a solid block
    // or the next page is already long on its own.
    if (buffer.length < minChars || page.text.length < minChars / 2) {
      buffer = combined;
      continue;
    }

    out.push({ page: startPage, text: buffer.trim() });
    buffer = page.text;
    startPage = page.page;
  }

  if (buffer.trim()) {
    out.push({ page: startPage, text: buffer.trim() });
  }

  return out.length ? out : pages;
}

function mergeTinyChunks(chunks: TextChunk[], minChars: number): TextChunk[] {
  if (!chunks.length) return chunks;
  const out: TextChunk[] = [];
  let current = { ...chunks[0] };

  for (let i = 1; i < chunks.length; i++) {
    const next = chunks[i];
    if (current.text.length < minChars) {
      current = {
        ...current,
        text: `${current.text}\n\n${next.text}`.trim(),
      };
    } else {
      out.push(current);
      current = { ...next };
    }
  }
  out.push(current);

  return out.map((c, index) => ({ ...c, chunkIndex: index }));
}
