import { and, desc, eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { z } from "zod";

import { getDb, ensureSchema } from "@/lib/db";
import { chats, documents, messages } from "@/lib/db/schema";
import { streamChatAnswer, resolveApiKey } from "@/lib/gemini";
import { getOrCreateGuestId } from "@/lib/guest";
import { buildUserPrompt, RAG_SYSTEM_PROMPT } from "@/lib/prompt";
import { rateLimit } from "@/lib/rate-limit";
import { hybridRetrieve } from "@/lib/retrieve";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const chatSchema = z.object({
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
  const headerKey = request.headers.get("x-api-key");

  let apiKey: string;
  try {
    apiKey = resolveApiKey(data.apiKey || headerKey);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Missing API key" },
      { status: 401 },
    );
  }

  const db = getDb();
  const scopeIds = data.scopeAll
    ? []
    : (data.documentIds?.length
        ? data.documentIds
        : data.documentId
          ? [data.documentId]
          : []);
  // Empty scopeIds => search across all guest documents

  const docs = await db
    .select()
    .from(documents)
    .where(and(eq(documents.guestId, guestId), eq(documents.status, "ready")));

  if (!docs.length) {
    return NextResponse.json(
      { error: "Upload a PDF before chatting." },
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
  } else {
    await db
      .update(chats)
      .set({
        documentId: scopeIds[0] ?? null,
        documentIds: scopeIds,
        updatedAt: new Date(),
      })
      .where(and(eq(chats.id, chatId), eq(chats.guestId, guestId)));
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

  let sources;
  try {
    sources = await hybridRetrieve({
      query: data.question,
      guestId,
      documentIds: scopeIds.length ? scopeIds : null,
      apiKey,
      embeddingModel: data.embeddingModel,
      topK: data.topK,
      filenameByDoc,
      rerank: data.rerank,
    });
  } catch (error) {
    console.error("Retrieval failed", error);
    return NextResponse.json(
      {
        error:
          error instanceof Error ? error.message : "Retrieval failed",
      },
      { status: 502 },
    );
  }

  const userPrompt = buildUserPrompt(data.question, sources);
  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      const send = (event: object) =>
        controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`));

      try {
        send({
          type: "meta",
          chatId,
          sources,
          model: data.chatModel,
        });

        let answer = "";
        for await (const delta of streamChatAnswer({
          apiKey,
          model: data.chatModel,
          temperature: data.temperature,
          system: RAG_SYSTEM_PROMPT,
          user: userPrompt,
          history,
        })) {
          answer += delta;
          send({ type: "delta", text: delta });
        }

        await db.insert(messages).values({
          chatId: chatId!,
          role: "assistant",
          content: answer || "No response generated.",
          sources,
        });

        await db
          .update(chats)
          .set({
            updatedAt: new Date(),
            documentId: scopeIds[0] ?? null,
            documentIds: scopeIds,
          })
          .where(eq(chats.id, chatId!));

        send({ type: "done" });
      } catch (error) {
        console.error("Chat stream failed", error);
        send({
          type: "error",
          error:
            error instanceof Error
              ? error.message
              : "The model stopped while generating an answer.",
        });
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
