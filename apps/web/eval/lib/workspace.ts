import { readdirSync, readFileSync } from "fs";
import path from "path";

import { and, eq } from "drizzle-orm";

import { invalidateSparseIndex } from "../../src/lib/bm25";
import type { ChunkStrategy } from "../../src/lib/chunking";
import { ensureSchema, getDb } from "../../src/lib/db";
import { documents } from "../../src/lib/db/schema";
import { ingestDocument } from "../../src/lib/ingest";
import { deleteDocumentVectors } from "../../src/lib/qdrant";

export const CORPUS_DIR = path.join(process.cwd(), "eval", "corpus");

export type CorpusFile = { filename: string; buffer: Buffer };

export function readCorpus(): CorpusFile[] {
  return readdirSync(CORPUS_DIR)
    .filter((file) => /\.(md|markdown|txt|html?|pdf)$/i.test(file))
    .sort()
    .map((filename) => ({
      filename,
      buffer: readFileSync(path.join(CORPUS_DIR, filename)),
    }));
}

/** Deterministic workspace per chunking strategy, so runs can reuse an index. */
export function workspaceIdFor(strategy: ChunkStrategy) {
  return `eval-${strategy}`;
}

export type IndexSummary = {
  workspaceId: string;
  strategy: ChunkStrategy;
  documents: number;
  chunks: number;
  duplicatesSkipped: number;
  reused: boolean;
};

/**
 * Makes the workspace match the corpus at the requested chunking strategy.
 * Reuses an existing index when it already matches, since re-embedding the
 * corpus is the slowest and most expensive part of an eval run.
 */
export async function ensureCorpusIndexed(options: {
  strategy: ChunkStrategy;
  apiKey: string;
  embeddingModel: string;
  /** Defaults to the per-strategy eval workspace. */
  workspaceId?: string;
  force?: boolean;
  dedupe?: boolean;
  onProgress?: (message: string) => void;
}): Promise<IndexSummary> {
  await ensureSchema();
  const db = getDb();
  const workspaceId = options.workspaceId ?? workspaceIdFor(options.strategy);
  const corpus = readCorpus();
  const report = options.onProgress ?? (() => {});

  if (!corpus.length) {
    throw new Error(`No corpus files found in ${CORPUS_DIR}`);
  }

  const existing = await db
    .select()
    .from(documents)
    .where(eq(documents.guestId, workspaceId));

  const matches =
    !options.force &&
    existing.length === corpus.length &&
    existing.every(
      (doc) =>
        doc.status === "ready" &&
        doc.chunkStrategy === options.strategy &&
        doc.embeddingModel === options.embeddingModel &&
        corpus.some((file) => file.filename === doc.filename),
    );

  if (matches) {
    report(
      `Reusing existing ${options.strategy} index (${existing.length} docs, ${existing.reduce((a, d) => a + d.chunkCount, 0)} chunks).`,
    );
    return {
      workspaceId,
      strategy: options.strategy,
      documents: existing.length,
      chunks: existing.reduce((acc, doc) => acc + doc.chunkCount, 0),
      duplicatesSkipped: existing.reduce(
        (acc, doc) => acc + doc.duplicateChunks,
        0,
      ),
      reused: true,
    };
  }

  for (const doc of existing) {
    await deleteDocumentVectors(doc.id);
    await db.delete(documents).where(eq(documents.id, doc.id));
  }
  invalidateSparseIndex(workspaceId);

  let chunks = 0;
  let duplicates = 0;

  for (const file of corpus) {
    report(`Indexing ${file.filename} (${options.strategy})…`);
    const result = await ingestDocument({
      guestId: workspaceId,
      filename: file.filename,
      buffer: file.buffer,
      apiKey: options.apiKey,
      embeddingModel: options.embeddingModel,
      chunkStrategy: options.strategy,
      // Eval runs keep everything: dropping duplicates would change the corpus
      // between strategies and make the comparison unfair.
      dedupe: options.dedupe ?? false,
    });
    chunks += result.totalChunks;
    duplicates += result.duplicateChunks;
  }

  return {
    workspaceId,
    strategy: options.strategy,
    documents: corpus.length,
    chunks,
    duplicatesSkipped: duplicates,
    reused: false,
  };
}

export async function loadFilenameMapFor(workspaceId: string) {
  const db = getDb();
  const rows = await db
    .select()
    .from(documents)
    .where(and(eq(documents.guestId, workspaceId), eq(documents.status, "ready")));
  return new Map(rows.map((row) => [row.id, row.filename]));
}
