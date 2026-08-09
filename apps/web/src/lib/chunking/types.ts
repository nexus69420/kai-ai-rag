import type { ProcessedSection } from "../db/schema";

export const CHUNK_STRATEGIES = ["fixed", "structural", "semantic"] as const;

export type ChunkStrategy = (typeof CHUNK_STRATEGIES)[number];

export const DEFAULT_CHUNK_STRATEGY: ChunkStrategy = "structural";

export type Chunk = {
  text: string;
  page: number;
  chunkIndex: number;
  heading: string | null;
  strategy: ChunkStrategy;
  charCount: number;
};

export type EmbedFn = (texts: string[]) => Promise<number[][]>;

export type ChunkOptions = {
  chunkSize: number;
  overlap: number;
  /** Chunks below this length get merged into a neighbour. */
  minChunkChars: number;
  /** Required by the semantic strategy; ignored by the others. */
  embed?: EmbedFn;
  /** Percentile of consecutive-sentence distance that becomes a split point. */
  semanticBreakpointPercentile: number;
  /** Hard cap on sentences embedded for boundary detection per document. */
  semanticMaxSentences: number;
};

export const DEFAULT_CHUNK_OPTIONS: ChunkOptions = {
  chunkSize: 850,
  overlap: 150,
  minChunkChars: 400,
  semanticBreakpointPercentile: 90,
  semanticMaxSentences: 1200,
};

export type Chunker = (
  sections: ProcessedSection[],
  options: ChunkOptions,
) => Promise<Chunk[]> | Chunk[];

export function isChunkStrategy(value: unknown): value is ChunkStrategy {
  return (
    typeof value === "string" &&
    (CHUNK_STRATEGIES as readonly string[]).includes(value)
  );
}
