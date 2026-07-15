import { readFile } from "fs/promises";

import { and, eq } from "drizzle-orm";
import { NextResponse } from "next/server";

import { getDb } from "@/lib/db";
import { documents } from "@/lib/db/schema";
import { getOrCreateGuestId } from "@/lib/guest";

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

  if (!doc?.storagePath) {
    return NextResponse.json({ error: "PDF not found." }, { status: 404 });
  }

  try {
    const data = await readFile(doc.storagePath);
    return new NextResponse(data, {
      headers: {
        "content-type": "application/pdf",
        "content-disposition": `inline; filename="${doc.filename}"`,
        "cache-control": "private, max-age=3600",
      },
    });
  } catch {
    return NextResponse.json({ error: "PDF file missing on disk." }, { status: 404 });
  }
}
