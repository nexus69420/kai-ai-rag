import { and, eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { z } from "zod";

import { CHUNK_STRATEGIES } from "@/lib/chunking";
import { ensureSchema, getDb } from "@/lib/db";
import { documents } from "@/lib/db/schema";
import { formatGeminiError, resolveApiKey } from "@/lib/gemini";
import { getOrCreateGuestId } from "@/lib/guest";
import { ingestDocument } from "@/lib/ingest";
import { loadDocument, type SourceType } from "@/lib/loaders";
import { rateLimit } from "@/lib/rate-limit";
import { readStoredFile } from "@/lib/storage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

const reindexSchema = z.object({
  chunkStrategy: z.enum(CHUNK_STRATEGIES),
  embeddingModel: z.string().optional(),
  dedupe: z.boolean().default(true),
  apiKey: z.string().optional(),
});

/**
 * Re-chunks an already-indexed document without a re-upload. The normalized
 * sections are stored at ingest time precisely so chunking strategy can be
 * changed (and compared) without touching the original file.
 */
export async function POST(request: Request, { params }: Params) {
  await ensureSchema();
  const { id } = await params;
  const guestId = await getOrCreateGuestId();

  const limited = rateLimit(`reindex:${guestId}`);
  if (!limited.ok) {
    return NextResponse.json(
      { error: "Rate limit exceeded. Try again shortly." },
      { status: 429 },
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const parsed = reindexSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid reindex request.", details: parsed.error.issues },
      { status: 400 },
    );
  }

  let apiKey: string;
  try {
    apiKey = resolveApiKey(parsed.data.apiKey || request.headers.get("x-api-key"));
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Missing API key" },
      { status: 401 },
    );
  }

  const db = getDb();
  const [doc] = await db
    .select()
    .from(documents)
    .where(and(eq(documents.id, id), eq(documents.guestId, guestId)))
    .limit(1);

  if (!doc) {
    return NextResponse.json({ error: "Document not found." }, { status: 404 });
  }

  let sections = doc.processedSections ?? undefined;
  if (!sections?.length) {
    // Documents indexed before section storage existed still have their bytes.
    const buffer = await readStoredFile({
      storagePath: doc.storagePath,
      fileBytes: doc.fileBytes,
    });
    if (!buffer) {
      return NextResponse.json(
        {
          error:
            "This document has no stored text or file to re-index. Upload it again.",
        },
        { status: 409 },
      );
    }
    const loaded = await loadDocument({ filename: doc.filename, buffer });
    sections = loaded.sections;
  }

  try {
    const result = await ingestDocument({
      guestId,
      documentId: id,
      reindex: true,
      filename: doc.filename,
      sections,
      sourceType: doc.sourceType as SourceType,
      apiKey,
      embeddingModel: parsed.data.embeddingModel ?? doc.embeddingModel ?? undefined,
      chunkStrategy: parsed.data.chunkStrategy,
      dedupe: parsed.data.dedupe,
    });

    return NextResponse.json({
      document_id: result.documentId,
      chunk_strategy: result.chunkStrategy,
      total_chunks: result.totalChunks,
      duplicate_chunks: result.duplicateChunks,
      message: `Re-indexed with the ${result.chunkStrategy} strategy`,
    });
  } catch (error) {
    console.error("Reindex failed", error);
    return NextResponse.json(
      { error: formatGeminiError(error) },
      { status: 500 },
    );
  }
}
