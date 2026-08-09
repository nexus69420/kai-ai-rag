import { and, eq } from "drizzle-orm";
import { NextResponse } from "next/server";

import { getDb } from "@/lib/db";
import { documents } from "@/lib/db/schema";
import { getOrCreateGuestId } from "@/lib/guest";
import type { SourceType } from "@/lib/loaders";
import { CONTENT_TYPES, readStoredFile } from "@/lib/storage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

export async function GET(_request: Request, { params }: Params) {
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

  const data = await readStoredFile({
    storagePath: doc.storagePath,
    fileBytes: doc.fileBytes,
  });

  if (!data) {
    return NextResponse.json(
      { error: "Original file is no longer available." },
      { status: 404 },
    );
  }

  const contentType =
    CONTENT_TYPES[(doc.sourceType as SourceType) ?? "pdf"] ??
    "application/octet-stream";

  return new NextResponse(new Uint8Array(data), {
    headers: {
      "content-type": contentType,
      "content-disposition": `inline; filename="${doc.filename}"`,
      "cache-control": "private, max-age=3600",
    },
  });
}
