import { unlink } from "fs/promises";

import { and, eq } from "drizzle-orm";
import { NextResponse } from "next/server";

import { getDb, ensureSchema } from "@/lib/db";
import { documents } from "@/lib/db/schema";
import { getOrCreateGuestId } from "@/lib/guest";
import { deleteDocumentVectors } from "@/lib/qdrant";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

export async function DELETE(_request: Request, { params }: Params) {
  await ensureSchema();
  const { id } = await params;
  const guestId = await getOrCreateGuestId();
  const db = getDb();

  const [doc] = await db
    .select()
    .from(documents)
    .where(and(eq(documents.id, id), eq(documents.guestId, guestId)))
    .limit(1);

  if (!doc) {
    return NextResponse.json({ error: "Document not found." }, { status: 404 });
  }

  await deleteDocumentVectors(id);
  await db.delete(documents).where(eq(documents.id, id));

  if (doc.storagePath) {
    try {
      await unlink(doc.storagePath);
    } catch {
      // ignore missing file
    }
  }

  return NextResponse.json({ ok: true });
}

export async function GET(_request: Request, { params }: Params) {
  await ensureSchema();
  const { id } = await params;
  const guestId = await getOrCreateGuestId();
  const db = getDb();

  const [doc] = await db
    .select({
      id: documents.id,
      filename: documents.filename,
      chunkCount: documents.chunkCount,
      status: documents.status,
      createdAt: documents.createdAt,
      hasFile: documents.storagePath,
    })
    .from(documents)
    .where(and(eq(documents.id, id), eq(documents.guestId, guestId)))
    .limit(1);

  if (!doc) {
    return NextResponse.json({ error: "Document not found." }, { status: 404 });
  }

  return NextResponse.json({
    ...doc,
    hasFile: Boolean(doc.hasFile),
  });
}
