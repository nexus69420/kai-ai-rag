import { NextResponse } from "next/server";
import { v4 as uuidv4 } from "uuid";

import { DEFAULT_CHUNK_STRATEGY, isChunkStrategy } from "@/lib/chunking";
import { ensureSchema } from "@/lib/db";
import { formatGeminiError, resolveApiKey } from "@/lib/gemini";
import { resolveWorkspaceId } from "@/lib/guest";
import { ingestDocument } from "@/lib/ingest";
import { detectSourceType, SUPPORTED_EXTENSIONS } from "@/lib/loaders";
import { rateLimit } from "@/lib/rate-limit";
import { storeFilesInDb, writeFileToDisk } from "@/lib/storage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_BYTES = 20 * 1024 * 1024;

/**
 * Accepts either `multipart/form-data` with a `file` field, or JSON
 * `{ filename, content }` for text formats — the JSON path is what makes
 * seeding and CI indexing scriptable without building a multipart body.
 */
export async function POST(request: Request) {
  await ensureSchema();
  const guestId = await resolveWorkspaceId(request);
  const limited = rateLimit(`ingest:${guestId}`);
  if (!limited.ok) {
    return NextResponse.json(
      { error: "Rate limit exceeded. Try again shortly." },
      { status: 429 },
    );
  }

  let apiKey: string;
  try {
    apiKey = resolveApiKey(request.headers.get("x-api-key"));
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Missing API key" },
      { status: 401 },
    );
  }

  let filename: string;
  let buffer: Buffer;
  let chunkStrategy = DEFAULT_CHUNK_STRATEGY;
  let embeddingModel = "gemini-embedding-001";
  let dedupe = true;

  const contentType = request.headers.get("content-type") ?? "";

  try {
    if (contentType.includes("application/json")) {
      const body = (await request.json()) as {
        filename?: string;
        content?: string;
        chunkStrategy?: string;
        embeddingModel?: string;
        dedupe?: boolean;
      };

      if (!body.filename || typeof body.content !== "string") {
        return NextResponse.json(
          { error: "JSON ingest requires `filename` and `content`." },
          { status: 400 },
        );
      }

      filename = body.filename;
      buffer = Buffer.from(body.content, "utf8");
      if (isChunkStrategy(body.chunkStrategy)) chunkStrategy = body.chunkStrategy;
      if (body.embeddingModel) embeddingModel = body.embeddingModel;
      if (body.dedupe === false) dedupe = false;
    } else {
      const form = await request.formData();
      const file = form.get("file");
      if (!(file instanceof File)) {
        return NextResponse.json({ error: "Missing file." }, { status: 400 });
      }
      filename = file.name;
      buffer = Buffer.from(await file.arrayBuffer());

      const strategy = form.get("chunkStrategy");
      if (isChunkStrategy(strategy)) chunkStrategy = strategy;
      const model = form.get("embeddingModel");
      if (typeof model === "string" && model) embeddingModel = model;
      if (form.get("dedupe") === "false") dedupe = false;
    }
  } catch {
    return NextResponse.json({ error: "Could not read request body." }, { status: 400 });
  }

  const sourceType = detectSourceType(filename);
  if (!sourceType) {
    return NextResponse.json(
      {
        error: `Unsupported file type. Supported: ${SUPPORTED_EXTENSIONS.join(", ")}`,
      },
      { status: 400 },
    );
  }

  if (buffer.byteLength > MAX_BYTES) {
    return NextResponse.json({ error: "File must be under 20MB." }, { status: 413 });
  }

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
      filename,
      buffer,
      apiKey,
      embeddingModel,
      chunkStrategy,
      dedupe,
      storagePath,
      fileBytes,
    });

    return NextResponse.json(
      {
        documentId: result.documentId,
        filename: result.filename,
        sourceType: result.sourceType,
        chunkStrategy: result.chunkStrategy,
        totalChunks: result.totalChunks,
        duplicateChunks: result.duplicateChunks,
        pages: result.pageCount,
        skipped: result.skipped,
      },
      { status: 201 },
    );
  } catch (error) {
    console.error("Ingest failed", error);
    return NextResponse.json(
      { error: formatGeminiError(error) },
      { status: 500 },
    );
  }
}
