import { and, eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { z } from "zod";

import { scoreRetrievalConfidence } from "@/lib/confidence";
import { ensureSchema, getDb } from "@/lib/db";
import { documents } from "@/lib/db/schema";
import { formatGeminiError, resolveApiKey } from "@/lib/gemini";
import { getOrCreateGuestId } from "@/lib/guest";
import { rateLimit } from "@/lib/rate-limit";
import { hybridRetrieve, RETRIEVAL_MODES } from "@/lib/retrieve";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const compareSchema = z.object({
  question: z.string().min(1).max(4000),
  documentIds: z.array(z.string().uuid()).optional(),
  topK: z.number().int().min(1).max(12).default(5),
  rerank: z.boolean().default(true),
  denseWeight: z.number().min(0).max(1).default(0.7),
  sparseWeight: z.number().min(0).max(1).default(0.3),
  modes: z.array(z.enum(RETRIEVAL_MODES)).default(["hybrid", "dense", "sparse"]),
  embeddingModel: z.string().optional(),
  apiKey: z.string().optional(),
});

/**
 * Runs the same question through each retrieval mode so hybrid can be compared
 * against dense-only and sparse-only on identical inputs. Generation is skipped
 * — this endpoint exists to measure retrieval, not answers.
 */
export async function POST(request: Request) {
  await ensureSchema();
  const guestId = await getOrCreateGuestId();
  const limited = rateLimit(`compare:${guestId}`);
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

  const parsed = compareSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid compare request.", details: parsed.error.issues },
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
      { error: "Index a document before comparing retrieval." },
      { status: 400 },
    );
  }

  const filenameByDoc = new Map(docs.map((d) => [d.id, d.filename]));
  const scopeIds = data.documentIds?.length ? data.documentIds : null;

  try {
    const runs = [];
    for (const mode of data.modes) {
      const result = await hybridRetrieve({
        query: data.question,
        guestId,
        documentIds: scopeIds,
        apiKey,
        embeddingModel: data.embeddingModel,
        topK: data.topK,
        filenameByDoc,
        mode,
        denseWeight: data.denseWeight,
        sparseWeight: data.sparseWeight,
        rerank: data.rerank,
        expandNeighbors: false,
      });

      runs.push({
        mode,
        retrievalConfidence: scoreRetrievalConfidence(result.stats),
        stats: result.stats,
        sources: result.sources.map((source) => ({
          citation: source.citation,
          chunkId: source.chunkId,
          filename: source.filename,
          page: source.page,
          heading: source.heading,
          score: source.score,
          denseScore: source.denseScore,
          sparseScore: source.sparseScore,
          rerankScore: source.rerankScore,
          retrievedBy: source.retrievedBy,
          text: source.text.slice(0, 600),
        })),
      });
    }

    return NextResponse.json({
      question: data.question,
      runs,
      overlap: buildOverlap(runs),
    });
  } catch (error) {
    console.error("Retrieval compare failed", error);
    return NextResponse.json(
      { error: formatGeminiError(error) },
      { status: 502 },
    );
  }
}

type Run = { mode: string; sources: Array<{ chunkId?: string }> };

/** Jaccard overlap of returned chunk ids between every pair of modes. */
function buildOverlap(runs: Run[]) {
  const pairs: Array<{ a: string; b: string; shared: number; jaccard: number }> = [];

  for (let i = 0; i < runs.length; i++) {
    for (let j = i + 1; j < runs.length; j++) {
      const left = new Set(
        runs[i].sources.map((s) => s.chunkId).filter(Boolean) as string[],
      );
      const right = new Set(
        runs[j].sources.map((s) => s.chunkId).filter(Boolean) as string[],
      );
      const shared = [...left].filter((id) => right.has(id)).length;
      const union = new Set([...left, ...right]).size;
      pairs.push({
        a: runs[i].mode,
        b: runs[j].mode,
        shared,
        jaccard: union ? Math.round((shared / union) * 1000) / 1000 : 0,
      });
    }
  }

  return pairs;
}
