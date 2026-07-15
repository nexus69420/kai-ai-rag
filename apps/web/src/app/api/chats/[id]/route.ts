import { and, asc, eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { z } from "zod";

import { getDb, ensureSchema } from "@/lib/db";
import { chats, messages } from "@/lib/db/schema";
import { getOrCreateGuestId } from "@/lib/guest";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

export async function GET(_request: Request, { params }: Params) {
  await ensureSchema();
  const { id } = await params;
  const guestId = await getOrCreateGuestId();
  const db = getDb();

  const [chat] = await db
    .select()
    .from(chats)
    .where(and(eq(chats.id, id), eq(chats.guestId, guestId)))
    .limit(1);

  if (!chat) {
    return NextResponse.json({ error: "Chat not found." }, { status: 404 });
  }

  const rows = await db
    .select()
    .from(messages)
    .where(eq(messages.chatId, id))
    .orderBy(asc(messages.createdAt));

  return NextResponse.json({ chat, messages: rows });
}

const patchSchema = z.object({
  title: z.string().min(1).max(120).optional(),
  documentId: z.string().uuid().nullable().optional(),
  documentIds: z.array(z.string().uuid()).optional(),
});

export async function PATCH(request: Request, { params }: Params) {
  await ensureSchema();
  const { id } = await params;
  const guestId = await getOrCreateGuestId();
  let body: z.infer<typeof patchSchema>;
  try {
    body = patchSchema.parse(await request.json());
  } catch {
    return NextResponse.json({ error: "Invalid rename/update payload." }, { status: 400 });
  }
  const db = getDb();

  const [updated] = await db
    .update(chats)
    .set({
      ...(body.title !== undefined ? { title: body.title } : {}),
      ...(body.documentId !== undefined ? { documentId: body.documentId } : {}),
      ...(body.documentIds !== undefined
        ? {
            documentIds: body.documentIds,
            documentId: body.documentIds[0] ?? null,
          }
        : {}),
      updatedAt: new Date(),
    })
    .where(and(eq(chats.id, id), eq(chats.guestId, guestId)))
    .returning();

  if (!updated) {
    return NextResponse.json({ error: "Chat not found." }, { status: 404 });
  }

  return NextResponse.json({ chat: updated });
}

export async function DELETE(_request: Request, { params }: Params) {
  await ensureSchema();
  const { id } = await params;
  const guestId = await getOrCreateGuestId();
  const db = getDb();

  const deleted = await db
    .delete(chats)
    .where(and(eq(chats.id, id), eq(chats.guestId, guestId)))
    .returning();

  if (!deleted.length) {
    return NextResponse.json({ error: "Chat not found." }, { status: 404 });
  }

  return NextResponse.json({ ok: true });
}
