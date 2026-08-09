import type { Chunk } from "./chunking";
import { cosine } from "./chunking/semantic";
import { denseSearchBatch } from "./qdrant";

export const DEFAULT_DEDUP_THRESHOLD = 0.95;

export type DedupSkip = {
  chunkIndex: number;
  page: number;
  reason: "exact" | "near";
  similarity?: number;
  matchedChunkId?: string;
  matchedFilename?: string;
};

export type DedupResult = {
  kept: Array<{ chunk: Chunk; vector: number[]; contentHash: string }>;
  skipped: DedupSkip[];
};

/**
 * Drops chunks whose content already exists in the workspace so the retriever
 * does not spend context-window slots on the same paragraph repeated across
 * documents. Exact hashes are checked first (free), then cosine similarity
 * against the existing corpus, then within the incoming batch itself.
 */
export async function dedupeChunks(options: {
  chunks: Chunk[];
  vectors: number[][];
  hashes: string[];
  guestId: string;
  documentId: string;
  /** Hashes already present in the workspace. */
  existingHashes: Set<string>;
  threshold?: number;
  /** Set false to index everything (used by eval runs that need parity). */
  enabled?: boolean;
}): Promise<DedupResult> {
  const threshold = options.threshold ?? DEFAULT_DEDUP_THRESHOLD;
  const kept: DedupResult["kept"] = [];
  const skipped: DedupSkip[] = [];

  if (options.enabled === false) {
    return {
      kept: options.chunks.map((chunk, index) => ({
        chunk,
        vector: options.vectors[index],
        contentHash: options.hashes[index],
      })),
      skipped,
    };
  }

  const batchHashes = new Set<string>();
  const survivors: Array<{ chunk: Chunk; vector: number[]; hash: string }> = [];

  for (let i = 0; i < options.chunks.length; i++) {
    const hash = options.hashes[i];
    if (options.existingHashes.has(hash) || batchHashes.has(hash)) {
      skipped.push({
        chunkIndex: options.chunks[i].chunkIndex,
        page: options.chunks[i].page,
        reason: "exact",
        similarity: 1,
      });
      continue;
    }
    batchHashes.add(hash);
    survivors.push({ chunk: options.chunks[i], vector: options.vectors[i], hash });
  }

  let neighbours: Awaited<ReturnType<typeof denseSearchBatch>> = [];
  try {
    neighbours = await denseSearchBatch({
      vectors: survivors.map((s) => s.vector),
      guestId: options.guestId,
      limit: 1,
      excludeDocumentId: options.documentId,
    });
  } catch (error) {
    // Dedup is an optimisation; never fail an upload because of it.
    console.warn("Dedup neighbour lookup failed, indexing all chunks:", error);
  }

  for (let i = 0; i < survivors.length; i++) {
    const survivor = survivors[i];
    const best = neighbours[i]?.[0];

    if (best && best.score >= threshold) {
      skipped.push({
        chunkIndex: survivor.chunk.chunkIndex,
        page: survivor.chunk.page,
        reason: "near",
        similarity: round(best.score),
        matchedChunkId: best.id,
        matchedFilename: best.payload.filename ?? undefined,
      });
      continue;
    }

    const internalDupe = kept.find(
      (k) => cosine(k.vector, survivor.vector) >= threshold,
    );
    if (internalDupe) {
      skipped.push({
        chunkIndex: survivor.chunk.chunkIndex,
        page: survivor.chunk.page,
        reason: "near",
        similarity: round(cosine(internalDupe.vector, survivor.vector)),
      });
      continue;
    }

    kept.push({
      chunk: survivor.chunk,
      vector: survivor.vector,
      contentHash: survivor.hash,
    });
  }

  return { kept, skipped };
}

function round(value: number) {
  return Math.round(value * 1000) / 1000;
}
