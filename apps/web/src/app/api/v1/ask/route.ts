import { and, eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { z } from "zod";

import { DEFAULT_ABSTAIN_THRESHOLD } from "@/lib/confidence";
import { ensureSchema, getDb } from "@/lib/db";
import { documents } from "@/lib/db/schema";
import { formatGeminiError, resolveApiKey } from "@/lib/gemini";
import { resolveWorkspaceId } from "@/lib/guest";
import { runRagPipeline } from "@/lib/pipeline";
import { rateLimit } from "@/lib/rate-limit";
import { RETRIEVAL_MODES } from "@/lib/retrieve";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const askSchema = z.object({
  question: z.string().min(1).max(4000),
  documentIds: z.array(z.string().uuid()).optional(),
  chatModel: z.string().default("gemini-2.5-flash"),
  embeddingModel: z.string().default("gemini-embedding-001"),
  temperature: z.number().min(0).max(1).default(0.4),
  topK: z.number().int().min(1).max(12).default(5),
  rerank: z.boolean().default(true),
  retrievalMode: z.enum(RETRIEVAL_MODES).default("hybrid"),
  denseWeight: z.number().min(0).max(1).default(0.7),
  sparseWeight: z.number().min(0).max(1).default(0.3),
  verifyCitations: z.boolean().default(true),
  abstainThreshold: z.number().min(0).max(1).default(DEFAULT_ABSTAIN_THRESHOLD),
  includeSourceText: z.boolean().default(true),
  apiKey: z.string().optional(),
});

/** Non-streaming counterpart of `/api/chat`, for scripts, evals, and clients. */
export async function POST(request: Request) {
  await ensureSchema();
  const guestId = await resolveWorkspaceId(request);
  const limited = rateLimit(`ask:${guestId}`);
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

  const parsed = askSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid ask request.", details: parsed.error.issues },
      { status: 400 },
    );
  }

  const data = parsed.data;

  let apiKey: string;
  try {
    apiKey = resolveApiKey(data.apiKey || request.headers.get("x-api-key"));
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Missing API key" },
      { status: 401 },
    );
  }

  const db = getDb();
  const docs = await db
    .select()
    .from(documents)
    .where(and(eq(documents.guestId, guestId), eq(documents.status, "ready")));

  if (!docs.length) {
    return NextResponse.json(
      { error: "No indexed documents in this workspace." },
      { status: 400 },
    );
  }

  const filenameByDoc = new Map(docs.map((d) => [d.id, d.filename]));

  try {
    const result = await runRagPipeline({
      question: data.question,
      guestId,
      apiKey,
      filenameByDoc,
      documentIds: data.documentIds?.length ? data.documentIds : null,
      chatModel: data.chatModel,
      embeddingModel: data.embeddingModel,
      temperature: data.temperature,
      topK: data.topK,
      rerank: data.rerank,
      retrievalMode: data.retrievalMode,
      denseWeight: data.denseWeight,
      sparseWeight: data.sparseWeight,
      verifyCitations: data.verifyCitations,
      abstainThreshold: data.abstainThreshold,
    });

    return NextResponse.json({
      question: data.question,
      answer: result.answer,
      abstained: result.abstained,
      confidence: result.confidence,
      citations: result.citations,
      completeness: result.completeness,
      retrieval: result.stats,
      sources: result.sources.map((source) => ({
        citation: source.citation,
        chunkId: source.chunkId,
        documentId: source.documentId,
        filename: source.filename,
        page: source.page,
        heading: source.heading,
        score: source.score,
        denseScore: source.denseScore,
        sparseScore: source.sparseScore,
        rerankScore: source.rerankScore,
        retrievedBy: source.retrievedBy,
        ...(data.includeSourceText ? { text: source.text } : {}),
      })),
    });
  } catch (error) {
    console.error("Ask failed", error);
    return NextResponse.json(
      { error: formatGeminiError(error) },
      { status: 502 },
    );
  }
}
