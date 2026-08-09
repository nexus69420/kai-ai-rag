import { and, desc, eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { z } from "zod";

import { DEFAULT_ABSTAIN_THRESHOLD } from "@/lib/confidence";
import { ensureSchema, getDb } from "@/lib/db";
import { chats, documents, messages } from "@/lib/db/schema";
import { formatGeminiError, resolveApiKey } from "@/lib/gemini";
import { getOrCreateGuestId } from "@/lib/guest";
import { runRagPipeline } from "@/lib/pipeline";
import { rateLimit } from "@/lib/rate-limit";
import { RETRIEVAL_MODES } from "@/lib/retrieve";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const chatSchema = z.object({
  question: z.string().min(1).max(4000),
  chatId: z.string().uuid().optional().nullable(),
  documentId: z.string().uuid().optional().nullable(),
  documentIds: z.array(z.string().uuid()).optional(),
  scopeAll: z.boolean().optional(),
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
  apiKey: z.string().optional(),
});

export async function POST(request: Request) {
  await ensureSchema();
  const guestId = await getOrCreateGuestId();
  const limited = rateLimit(`chat:${guestId}`);
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

  const parsed = chatSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid chat request.", details: parsed.error.issues },
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
  const scopeIds = data.scopeAll
    ? []
    : data.documentIds?.length
      ? data.documentIds
      : data.documentId
        ? [data.documentId]
        : [];

  const docs = await db
    .select()
    .from(documents)
    .where(and(eq(documents.guestId, guestId), eq(documents.status, "ready")));

  if (!docs.length) {
    return NextResponse.json(
      { error: "Index a document before chatting." },
      { status: 400 },
    );
  }

  if (scopeIds.length) {
    const allowed = new Set(docs.map((d) => d.id));
    const missing = scopeIds.filter((id) => !allowed.has(id));
    if (missing.length) {
      return NextResponse.json(
        { error: "One or more selected documents were not found." },
        { status: 404 },
      );
    }
  }

  const filenameByDoc = new Map(docs.map((d) => [d.id, d.filename]));

  let chatId = data.chatId ?? null;
  if (!chatId) {
    const title =
      data.question.length > 48
        ? `${data.question.slice(0, 48)}…`
        : data.question;
    const [created] = await db
      .insert(chats)
      .values({
        guestId,
        title,
        documentId: scopeIds[0] ?? null,
        documentIds: scopeIds,
      })
      .returning();
    chatId = created.id;
  }

  const prior = await db
    .select()
    .from(messages)
    .where(eq(messages.chatId, chatId))
    .orderBy(desc(messages.createdAt))
    .limit(12);

  const history = prior
    .reverse()
    .filter((m) => m.role === "user" || m.role === "assistant")
    .map((m) => ({
      role: m.role as "user" | "assistant",
      content: m.content.slice(0, 2000),
    }));

  await db.insert(messages).values({
    chatId,
    role: "user",
    content: data.question,
    sources: [],
  });

  const activeChatId = chatId;
  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      const send = (event: object) =>
        controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`));

      try {
        const result = await runRagPipeline({
          question: data.question,
          guestId,
          apiKey,
          filenameByDoc,
          documentIds: scopeIds.length ? scopeIds : null,
          history,
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
          onEvent: (event) => {
            if (event.type === "meta") {
              send({ ...event, chatId: activeChatId, model: data.chatModel });
              return;
            }
            send(event);
          },
        });

        await db.insert(messages).values({
          chatId: activeChatId,
          role: "assistant",
          content: result.answer || "No response generated.",
          sources: result.sources,
          retrievalMode: result.stats.mode,
          retrievalStats: result.stats,
          citations: result.citations,
          confidence: result.confidence,
          abstained: result.abstained ? "yes" : "no",
        });

        await db
          .update(chats)
          .set({
            updatedAt: new Date(),
            documentId: scopeIds[0] ?? null,
            documentIds: scopeIds,
          })
          .where(eq(chats.id, activeChatId));

        send({ type: "done" });
      } catch (error) {
        console.error("Chat stream failed", error);
        send({ type: "error", error: formatGeminiError(error) });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "content-type": "application/x-ndjson; charset=utf-8",
      "cache-control": "no-cache, no-transform",
      "x-accel-buffering": "no",
    },
  });
}
