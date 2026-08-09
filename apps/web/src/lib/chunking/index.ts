import type { ProcessedSection } from "../db/schema";
import { chunkFixed } from "./fixed";
import { chunkSemantic } from "./semantic";
import { chunkStructural } from "./structural";
import { reindex } from "./text";
import {
  DEFAULT_CHUNK_OPTIONS,
  DEFAULT_CHUNK_STRATEGY,
  type Chunk,
  type ChunkOptions,
  type ChunkStrategy,
} from "./types";

export {
  CHUNK_STRATEGIES,
  DEFAULT_CHUNK_OPTIONS,
  DEFAULT_CHUNK_STRATEGY,
  isChunkStrategy,
} from "./types";
export type { Chunk, ChunkOptions, ChunkStrategy, EmbedFn } from "./types";
export { chunkFixed } from "./fixed";
export { chunkSemantic } from "./semantic";
export { chunkStructural } from "./structural";

export const STRATEGY_DESCRIPTIONS: Record<ChunkStrategy, string> = {
  fixed: "Fixed-size window with overlap. Structure-agnostic baseline.",
  structural:
    "Recursive split that respects section headings and keeps the heading breadcrumb.",
  semantic:
    "Splits on embedding-similarity topic boundaries between sentence windows.",
};

export async function chunkDocument(
  sections: ProcessedSection[],
  options: Partial<ChunkOptions> & { strategy?: ChunkStrategy } = {},
): Promise<Chunk[]> {
  const strategy = options.strategy ?? DEFAULT_CHUNK_STRATEGY;
  const resolved: ChunkOptions = { ...DEFAULT_CHUNK_OPTIONS, ...options };

  const chunks =
    strategy === "semantic"
      ? await chunkSemantic(sections, resolved)
      : strategy === "fixed"
        ? chunkFixed(sections, resolved)
        : chunkStructural(sections, resolved);

  // The semantic path can fall back to structural; report what actually ran.
  return reindex(chunks.filter((chunk) => chunk.text.trim().length > 0));
}

export function resolvedStrategy(chunks: Chunk[]): ChunkStrategy {
  return chunks[0]?.strategy ?? DEFAULT_CHUNK_STRATEGY;
}
