import type { ProcessedSection } from "../db/schema";
import { makeChunk, mergeTinyChunks } from "./text";
import type { Chunk, ChunkOptions } from "./types";

/**
 * Baseline strategy: ignore document structure and slide a fixed window with
 * overlap across the text, breaking on the nearest sentence/newline boundary.
 */
export function chunkFixed(
  sections: ProcessedSection[],
  options: ChunkOptions,
): Chunk[] {
  const merged = mergeShortSections(sections, options.minChunkChars);
  const chunks: Chunk[] = [];

  for (const section of merged) {
    const text = section.text.trim();
    if (!text) continue;

    if (text.length <= options.chunkSize) {
      chunks.push(makeChunk(text, section.page, section.heading, "fixed"));
      continue;
    }

    let start = 0;
    while (start < text.length) {
      const end = Math.min(start + options.chunkSize, text.length);
      let slice = text.slice(start, end);

      if (end < text.length) {
        const soft = Math.max(slice.lastIndexOf("\n"), slice.lastIndexOf(". "));
        if (soft > options.chunkSize * 0.5) {
          slice = slice.slice(0, soft + 1);
        }
      }

      const trimmed = slice.trim();
      if (trimmed) {
        chunks.push(makeChunk(trimmed, section.page, section.heading, "fixed"));
      }

      if (end >= text.length) break;
      const advanced = Math.max(slice.length, options.chunkSize - options.overlap);
      start = Math.max(start + 1, start + advanced - options.overlap);
    }
  }

  return mergeTinyChunks(chunks, options.minChunkChars);
}

/** Slide decks extract as many tiny pages; pack them before windowing. */
function mergeShortSections(
  sections: ProcessedSection[],
  minChars: number,
): ProcessedSection[] {
  const out: ProcessedSection[] = [];
  let buffer: ProcessedSection | null = null;

  for (const section of sections) {
    if (!buffer) {
      buffer = { ...section };
      continue;
    }

    if (buffer.text.length < minChars || section.text.length < minChars / 2) {
      buffer = {
        page: buffer.page,
        heading: buffer.heading ?? section.heading,
        text: `${buffer.text}\n\n${section.text}`.trim(),
      };
      continue;
    }

    out.push(buffer);
    buffer = { ...section };
  }

  if (buffer?.text.trim()) out.push(buffer);
  return out.length ? out : sections;
}
