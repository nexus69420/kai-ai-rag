import type { Chunk, ChunkStrategy } from "./types";

/** Ordered coarse-to-fine separators, mirroring recursive character splitting. */
const SEPARATORS = ["\n\n\n", "\n\n", "\n", ". ", "? ", "! ", "; ", " "];

export function splitSentences(text: string): string[] {
  const units: string[] = [];

  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    // Bullets, table rows, and headings stay whole — splitting them on "." only
    // produces fragments that embed poorly.
    if (/^([-*+•]|\d+[.)]|\||#{1,6}\s)/.test(trimmed) || trimmed.length < 80) {
      units.push(trimmed);
      continue;
    }

    const sentences = trimmed
      .split(/(?<=[.!?])\s+(?=[A-Z(“"'\d])/)
      .map((s) => s.trim())
      .filter(Boolean);

    units.push(...(sentences.length ? sentences : [trimmed]));
  }

  return units;
}

/**
 * Splits text into <= chunkSize pieces, preferring the coarsest separator that
 * still fits, and carrying `overlap` characters of tail context forward.
 */
export function recursiveSplit(
  text: string,
  chunkSize: number,
  overlap: number,
): string[] {
  const clean = text.trim();
  if (!clean) return [];
  if (clean.length <= chunkSize) return [clean];

  const pieces = splitToPieces(clean, chunkSize, 0);
  const out: string[] = [];
  let current = "";

  for (const piece of pieces) {
    const candidate = current ? joinPieces(current, piece) : piece;

    if (candidate.length <= chunkSize) {
      current = candidate;
      continue;
    }

    if (current) out.push(current);
    current = overlap > 0 ? withOverlap(current, piece, overlap) : piece;

    while (current.length > chunkSize) {
      out.push(current.slice(0, chunkSize).trim());
      current = current.slice(Math.max(1, chunkSize - overlap)).trim();
    }
  }

  if (current.trim()) out.push(current.trim());
  return out.filter(Boolean);
}

function splitToPieces(
  text: string,
  chunkSize: number,
  separatorIndex: number,
): string[] {
  if (text.length <= chunkSize) return [text];
  if (separatorIndex >= SEPARATORS.length) {
    const hard: string[] = [];
    for (let i = 0; i < text.length; i += chunkSize) {
      hard.push(text.slice(i, i + chunkSize));
    }
    return hard;
  }

  const separator = SEPARATORS[separatorIndex];
  const parts = text.split(separator).filter((p) => p !== "");
  if (parts.length === 1) {
    return splitToPieces(text, chunkSize, separatorIndex + 1);
  }

  return parts.flatMap((part, index) => {
    const withSep =
      index < parts.length - 1 && separator.trim() ? `${part}${separator}` : part;
    return splitToPieces(withSep, chunkSize, separatorIndex + 1);
  });
}

function joinPieces(left: string, right: string) {
  if (/\n$/.test(left) || /^\n/.test(right)) return `${left}${right}`;
  if (/\s$/.test(left) || /^\s/.test(right)) return `${left}${right}`;
  return `${left} ${right}`;
}

function withOverlap(previous: string, next: string, overlap: number) {
  if (!previous) return next;
  const tail = previous.slice(-overlap);
  const boundary = tail.search(/[\s\n]/);
  const carried = boundary >= 0 ? tail.slice(boundary + 1) : tail;
  return carried ? joinPieces(carried, next) : next;
}

/** Prefixing the heading gives dense + BM25 search the section context. */
export function withHeadingContext(text: string, heading: string | null) {
  if (!heading) return text;
  const firstLine = text.split("\n", 1)[0]?.trim() ?? "";
  const leaf = heading.split("›").pop()?.trim() ?? heading;
  if (firstLine.toLowerCase() === leaf.toLowerCase()) return text;
  return `${heading}\n${text}`;
}

/**
 * Merges undersized chunks forward. Lecture slides and short doc sections
 * otherwise index as title-only chunks that match a query but carry no answer.
 */
export function mergeTinyChunks(chunks: Chunk[], minChars: number): Chunk[] {
  if (chunks.length <= 1) return reindex(chunks);

  const out: Chunk[] = [];
  let current: Chunk | null = null;

  for (const next of chunks) {
    if (!current) {
      current = { ...next };
      continue;
    }

    const sameDoc = current.page === next.page || current.heading === next.heading;
    if (current.charCount < minChars && sameDoc) {
      current = {
        ...current,
        text: `${current.text}\n\n${next.text}`.trim(),
        heading: current.heading ?? next.heading,
        charCount: current.text.length + next.text.length + 2,
      };
      continue;
    }

    out.push(current);
    current = { ...next };
  }

  if (current) out.push(current);
  return reindex(out);
}

export function reindex(chunks: Chunk[]): Chunk[] {
  return chunks.map((chunk, index) => ({
    ...chunk,
    chunkIndex: index,
    charCount: chunk.text.length,
  }));
}

export function makeChunk(
  text: string,
  page: number,
  heading: string | null,
  strategy: ChunkStrategy,
): Chunk {
  const clean = text.trim();
  return {
    text: clean,
    page,
    heading,
    strategy,
    chunkIndex: 0,
    charCount: clean.length,
  };
}
