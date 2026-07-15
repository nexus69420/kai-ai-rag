import { desc, eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { z } from "zod";

import { getDb, ensureSchema } from "@/lib/db";
import { chats } from "@/lib/db/schema";
import { getOrCreateGuestId } from "@/lib/guest";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  await ensureSchema();
  const guestId = await getOrCreateGuestId();
  const db = getDb();
  const rows = await db
    .select({
      id: chats.id,
      title: chats.title,
      documentId: chats.documentId,
      documentIds: chats.documentIds,
      createdAt: chats.createdAt,
      updatedAt: chats.updatedAt,
    })
    .from(chats)
    .where(eq(chats.guestId, guestId))
    .orderBy(desc(chats.updatedAt))
    .limit(50);

  return NextResponse.json({ chats: rows });
}

const createSchema = z.object({
  title: z.string().min(1).max(120).optional(),
  documentId: z.string().uuid().nullable().optional(),
  documentIds: z.array(z.string().uuid()).optional(),
});

export async function POST(request: Request) {
  await ensureSchema();
  const guestId = await getOrCreateGuestId();
  const body = createSchema.parse(await request.json().catch(() => ({})));
  const db = getDb();
  const documentIds = body.documentIds ?? (body.documentId ? [body.documentId] : []);
  const [created] = await db
    .insert(chats)
    .values({
      guestId,
      title: body.title ?? "New chat",
      documentId: documentIds[0] ?? body.documentId ?? null,
      documentIds,
    })
    .returning();

  return NextResponse.json({ chat: created });
}
