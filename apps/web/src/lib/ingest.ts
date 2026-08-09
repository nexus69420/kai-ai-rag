import { and, eq, inArray } from "drizzle-orm";
import { v4 as uuidv4 } from "uuid";

import { invalidateSparseIndex } from "./bm25";
import {
  chunkDocument,
  DEFAULT_CHUNK_STRATEGY,
  type ChunkStrategy,
} from "./chunking";
import { getDb } from "./db";
import { chunks, documents, type ProcessedSection } from "./db/schema";
import { dedupeChunks, type DedupSkip } from "./dedup";
import { embedTexts } from "./gemini";
import { contentFingerprint } from "./hash";
import { loadDocument, type SourceType } from "./loaders";
import { deleteDocumentVectors, upsertChunkVectors } from "./qdrant";

export type IngestResult = {
  documentId: string;
  filename: string;
  sourceType: SourceType;
  chunkStrategy: ChunkStrategy;
  totalChunks: number;
  duplicateChunks: number;
  pageCount: number;
  skipped: DedupSkip[];
};

export type IngestInput = {
  guestId: string;
  filename: string;
  apiKey: string;
  embeddingModel?: string;
  chunkStrategy?: ChunkStrategy;
  /** Raw bytes for a new upload. Omit when re-indexing stored sections. */
  buffer?: Buffer;
  /** Pre-normalized sections, used by re-index so the file is not re-uploaded. */
  sections?: ProcessedSection[];
  sourceType?: SourceType;
  /** Pre-generated id, so the caller can store the file before indexing. */
  documentId?: string;
  /** Re-chunk an existing row in place instead of inserting a new document. */
  reindex?: boolean;
  storagePath?: string | null;
  fileBytes?: string | null;
  dedupe?: boolean;
};

/**
 * The single ingestion path: load → chunk → embed → dedupe → index.
 *
 * Postgres and the vector store are written with the same chunk UUIDs, and the
 * sparse index is invalidated at the end, so all three views of the corpus stay
 * consistent after every ingest or re-index.
 */
export async function ingestDocument(input: IngestInput): Promise<IngestResult> {
  const db = getDb();
  const embeddingModel = input.embeddingModel ?? "gemini-embedding-001";
  const requestedStrategy = input.chunkStrategy ?? DEFAULT_CHUNK_STRATEGY;

  let sections = input.sections;
  let sourceType = input.sourceType ?? "pdf";

  if (!sections) {
    if (!input.buffer) {
      throw new Error("ingestDocument needs either a buffer or sections.");
    }
    const loaded = await loadDocument({
      filename: input.filename,
      buffer: input.buffer,
    });
    sections = loaded.sections;
    sourceType = loaded.sourceType;
  }

  const pageCount = sections.length;
  const documentId = input.documentId ?? uuidv4();
  const isReindex = input.reindex === true;

  if (isReindex) {
    await db
      .update(documents)
      .set({ status: "processing", chunkStrategy: requestedStrategy })
      .where(eq(documents.id, documentId));
    await db.delete(chunks).where(eq(chunks.documentId, documentId));
    await deleteDocumentVectors(documentId);
  } else {
    await db.insert(documents).values({
      id: documentId,
      guestId: input.guestId,
      filename: input.filename,
      chunkCount: 0,
      status: "processing",
      storagePath: input.storagePath ?? null,
      fileBytes: input.fileBytes ?? null,
      sourceType,
      chunkStrategy: requestedStrategy,
      embeddingModel,
      pageCount,
      processedSections: sections,
    });
  }

  try {
    const produced = await chunkDocument(sections, {
      strategy: requestedStrategy,
      embed: (texts) =>
        embedTexts(texts, {
          apiKey: input.apiKey,
          model: embeddingModel,
          taskType: "SEMANTIC_SIMILARITY",
        }),
    });

    if (!produced.length) {
      throw new Error("No text chunks were produced from this document.");
    }

    const vectors = await embedTexts(
      produced.map((chunk) => chunk.text),
      { apiKey: input.apiKey, model: embeddingModel },
    );

    const hashes = produced.map((chunk) => contentFingerprint(chunk.text));
    const existingHashes = await loadExistingHashes(
      input.guestId,
      documentId,
      hashes,
    );

    const { kept, skipped } = await dedupeChunks({
      chunks: produced,
      vectors,
      hashes,
      guestId: input.guestId,
      documentId,
      existingHashes,
      enabled: input.dedupe !== false,
    });

    if (!kept.length) {
      throw new Error(
        "Every chunk in this document already exists in your workspace.",
      );
    }

    const rows = kept.map((item, index) => ({
      id: uuidv4(),
      documentId,
      guestId: input.guestId,
      chunkIndex: index,
      page: item.chunk.page,
      text: item.chunk.text,
      heading: item.chunk.heading,
      chunkStrategy: item.chunk.strategy,
      charCount: item.chunk.charCount,
      contentHash: item.contentHash,
    }));

    await insertInBatches(rows);

    await upsertChunkVectors(
      rows.map((row, index) => ({
        id: row.id,
        vector: kept[index].vector,
        payload: {
          text: row.text,
          document_id: documentId,
          guest_id: input.guestId,
          filename: input.filename,
          page: row.page,
          chunk_index: row.chunkIndex,
          heading: row.heading,
          chunk_strategy: row.chunkStrategy,
          content_hash: row.contentHash,
          char_count: row.charCount,
        },
      })),
    );

    const resolvedStrategy = kept[0].chunk.strategy;

    await db
      .update(documents)
      .set({
        chunkCount: rows.length,
        duplicateChunks: skipped.length,
        status: "ready",
        chunkStrategy: resolvedStrategy,
        embeddingModel,
        pageCount,
        sourceType,
        processedSections: sections,
      })
      .where(eq(documents.id, documentId));

    invalidateSparseIndex(input.guestId);

    return {
      documentId,
      filename: input.filename,
      sourceType,
      chunkStrategy: resolvedStrategy,
      totalChunks: rows.length,
      duplicateChunks: skipped.length,
      pageCount,
      skipped,
    };
  } catch (error) {
    await db
      .update(documents)
      .set({ status: "failed" })
      .where(eq(documents.id, documentId));
    invalidateSparseIndex(input.guestId);
    throw error;
  }
}

async function loadExistingHashes(
  guestId: string,
  documentId: string,
  hashes: string[],
): Promise<Set<string>> {
  if (!hashes.length) return new Set();
  const db = getDb();
  const unique = [...new Set(hashes)];
  const found = new Set<string>();

  // Chunked IN() lists keep the statement well inside parameter limits.
  for (let i = 0; i < unique.length; i += 500) {
    const slice = unique.slice(i, i + 500);
    const rows = await db
      .select({ contentHash: chunks.contentHash, documentId: chunks.documentId })
      .from(chunks)
      .where(
        and(eq(chunks.guestId, guestId), inArray(chunks.contentHash, slice)),
      );

    for (const row of rows) {
      if (row.documentId === documentId) continue;
      if (row.contentHash) found.add(row.contentHash);
    }
  }

  return found;
}

async function insertInBatches(rows: Array<typeof chunks.$inferInsert>) {
  const db = getDb();
  const BATCH = 200;
  for (let i = 0; i < rows.length; i += BATCH) {
    await db.insert(chunks).values(rows.slice(i, i + BATCH));
  }
}
