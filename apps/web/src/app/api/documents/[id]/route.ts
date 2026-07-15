import { and, eq, sql } from "drizzle-orm";
import { NextResponse } from "next/server";

import { getDb, ensureSchema } from "@/lib/db";
import { documents } from "@/lib/db/schema";
import { getOrCreateGuestId } from "@/lib/guest";
import { deleteDocumentVectors } from "@/lib/qdrant";
import { removeStoredPdf } from "@/lib/storage";

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
  await removeStoredPdf({ storagePath: doc.storagePath });

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
      storagePath: documents.storagePath,
      hasFileBytes: sql<boolean>`(${documents.fileBytes} is not null)`,
    })
    .from(documents)
    .where(and(eq(documents.id, id), eq(documents.guestId, guestId)))
    .limit(1);

  if (!doc) {
    return NextResponse.json({ error: "Document not found." }, { status: 404 });
  }

  return NextResponse.json({
    id: doc.id,
    filename: doc.filename,
    chunkCount: doc.chunkCount,
    status: doc.status,
    createdAt: doc.createdAt,
    hasFile: Boolean(doc.storagePath) || Boolean(doc.hasFileBytes),
  });
}
