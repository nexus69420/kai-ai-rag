import { mkdir, writeFile } from "fs/promises";
import path from "path";

import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { v4 as uuidv4 } from "uuid";

import { chunkPages } from "@/lib/chunk";
import { ensureSchema, getDb } from "@/lib/db";
import { chunks, documents } from "@/lib/db/schema";
import { embedTexts, resolveApiKey } from "@/lib/gemini";
import { getOrCreateGuestId } from "@/lib/guest";
import { extractPdfPages } from "@/lib/pdf";
import { upsertChunkVectors } from "@/lib/qdrant";
import { rateLimit } from "@/lib/rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

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

  if (!(file instanceof File)) {
    return NextResponse.json({ error: "Missing PDF file." }, { status: 400 });
  }

  if (!file.name.toLowerCase().endsWith(".pdf")) {
    return NextResponse.json({ error: "Only PDF files are supported." }, { status: 400 });
  }

  if (file.size > 20 * 1024 * 1024) {
    return NextResponse.json({ error: "PDF must be under 20MB." }, { status: 400 });
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
  const db = getDb();

  const uploadDir = path.join(process.cwd(), "uploads", guestId);
  await mkdir(uploadDir, { recursive: true });
  const storagePath = path.join(uploadDir, `${documentId}.pdf`);
  await writeFile(storagePath, buffer);

  await db.insert(documents).values({
    id: documentId,
    guestId,
    filename: file.name,
    chunkCount: 0,
    status: "processing",
    storagePath,
  });

  try {
    const pages = await extractPdfPages(buffer);
    const textChunks = chunkPages(pages);
    if (!textChunks.length) {
      throw new Error("No text chunks produced from PDF.");
    }

    const vectors = await embedTexts(
      textChunks.map((c) => c.text),
      { apiKey, model: embeddingModel },
    );

    const chunkRows = textChunks.map((chunk) => ({
      id: uuidv4(),
      documentId,
      guestId,
      chunkIndex: chunk.chunkIndex,
      page: chunk.page,
      text: chunk.text,
    }));

    await db.insert(chunks).values(chunkRows);

    await upsertChunkVectors(
      chunkRows.map((row, index) => ({
        id: row.id,
        vector: vectors[index],
        payload: {
          text: row.text,
          document_id: documentId,
          guest_id: guestId,
          filename: file.name,
          page: row.page,
          chunk_index: row.chunkIndex,
        },
      })),
    );

    await db
      .update(documents)
      .set({ chunkCount: chunkRows.length, status: "ready" })
      .where(eq(documents.id, documentId));

    return NextResponse.json({
      document_id: documentId,
      filename: file.name,
      total_chunks: chunkRows.length,
      message: "PDF indexed successfully",
    });
  } catch (error) {
    await db
      .update(documents)
      .set({ status: "failed" })
      .where(eq(documents.id, documentId));

    console.error("Upload failed", error);
    return NextResponse.json(
      {
        error:
          error instanceof Error ? error.message : "Failed to index PDF",
      },
      { status: 500 },
    );
  }
}
