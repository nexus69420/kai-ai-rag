import type { ProcessedSection } from "../db/schema";
import {
  makeChunk,
  mergeTinyChunks,
  recursiveSplit,
  withHeadingContext,
} from "./text";
import type { Chunk, ChunkOptions } from "./types";

/**
 * Structure-aware strategy: never split across a section boundary, and split
 * oversized sections recursively on the coarsest separator that fits. Each
 * chunk keeps its heading breadcrumb so citations stay locatable.
 */
export function chunkStructural(
  sections: ProcessedSection[],
  options: ChunkOptions,
): Chunk[] {
  const chunks: Chunk[] = [];

  for (const section of sections) {
    const text = section.text.trim();
    if (!text) continue;

    const pieces = recursiveSplit(text, options.chunkSize, options.overlap);
    for (const piece of pieces) {
      const body = withHeadingContext(piece, section.heading);
      chunks.push(makeChunk(body, section.page, section.heading, "structural"));
    }
  }

  return mergeTinyChunks(chunks, options.minChunkChars);
}
