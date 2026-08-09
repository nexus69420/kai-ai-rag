import { NextResponse } from "next/server";
import { v4 as uuidv4 } from "uuid";

import { DEFAULT_CHUNK_STRATEGY, isChunkStrategy } from "@/lib/chunking";
import { ensureSchema } from "@/lib/db";
import { formatGeminiError, resolveApiKey } from "@/lib/gemini";
import { getOrCreateGuestId } from "@/lib/guest";
import { ingestDocument } from "@/lib/ingest";
import { detectSourceType, SUPPORTED_EXTENSIONS } from "@/lib/loaders";
import { rateLimit } from "@/lib/rate-limit";
import { storeFilesInDb, writeFileToDisk } from "@/lib/storage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_BYTES = 20 * 1024 * 1024;
/** Vercel serverless request body limit on Hobby/Pro defaults. */
const MAX_BYTES_SERVERLESS = 4.5 * 1024 * 1024;

export async function POST(request: Request) {
  await ensureSchema();
  const guestId = await getOrCreateGuestId();
  const limited = rateLimit(`upload:${guestId}`);
  if (!limited.ok) {
    return NextResponse.json(
      { error: "Rate limit exceeded. Try again shortly." },
      { status: 429 },
    );
  }

  const form = await request.formData();
  const file = form.get("file");
  const apiKeyHeader = request.headers.get("x-api-key");
  const embeddingModel =
    request.headers.get("x-embedding-model") ?? "gemini-embedding-001";

  const requestedStrategy =
    form.get("chunkStrategy") ?? request.headers.get("x-chunk-strategy");
  const chunkStrategy = isChunkStrategy(requestedStrategy)
    ? requestedStrategy
    : DEFAULT_CHUNK_STRATEGY;
  const dedupe = form.get("dedupe") !== "false";

  if (!(file instanceof File)) {
    return NextResponse.json({ error: "Missing file." }, { status: 400 });
  }

  const sourceType = detectSourceType(file.name);
  if (!sourceType) {
    return NextResponse.json(
      {
        error: `Unsupported file type. Supported: ${SUPPORTED_EXTENSIONS.join(", ")}`,
      },
      { status: 400 },
    );
  }

  if (file.size > MAX_BYTES) {
    return NextResponse.json(
      { error: "File must be under 20MB." },
      { status: 413 },
    );
  }

  if (process.env.VERCEL && file.size > MAX_BYTES_SERVERLESS) {
    return NextResponse.json(
      {
        error:
          "On this hosted deploy, uploads must be under 4.5MB. Try a smaller file or run locally.",
      },
      { status: 413 },
    );
  }

  let apiKey: string;
  try {
    apiKey = resolveApiKey(apiKeyHeader);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Missing API key" },
      { status: 401 },
    );
  }

  const buffer = Buffer.from(await file.arrayBuffer());
  const documentId = uuidv4();

  let storagePath: string | null = null;
  let fileBytes: string | null = null;
  if (storeFilesInDb()) {
    fileBytes = buffer.toString("base64");
  } else {
    storagePath = await writeFileToDisk({
      guestId,
      documentId,
      buffer,
      sourceType,
    });
  }

  try {
    const result = await ingestDocument({
      guestId,
      documentId,
      filename: file.name,
      buffer,
      apiKey,
      embeddingModel,
      chunkStrategy,
      dedupe,
      storagePath,
      fileBytes,
    });

    return NextResponse.json({
      document_id: result.documentId,
      filename: result.filename,
      source_type: result.sourceType,
      chunk_strategy: result.chunkStrategy,
      total_chunks: result.totalChunks,
      duplicate_chunks: result.duplicateChunks,
      pages: result.pageCount,
      message:
        result.duplicateChunks > 0
          ? `Indexed ${result.totalChunks} chunks, skipped ${result.duplicateChunks} duplicates`
          : `Indexed ${result.totalChunks} chunks`,
    });
  } catch (error) {
    console.error("Upload failed", error);
    return NextResponse.json(
      { error: formatGeminiError(error) },
      { status: 500 },
    );
  }
}
