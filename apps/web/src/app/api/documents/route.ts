import { and, desc, eq } from "drizzle-orm";
import { NextResponse } from "next/server";

import { getDb, ensureSchema } from "@/lib/db";
import { documents } from "@/lib/db/schema";
import { getOrCreateGuestId } from "@/lib/guest";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  await ensureSchema();
  const guestId = await getOrCreateGuestId();
  const db = getDb();
  const rows = await db
    .select({
      id: documents.id,
      filename: documents.filename,
      chunkCount: documents.chunkCount,
      status: documents.status,
      createdAt: documents.createdAt,
    })
    .from(documents)
    .where(eq(documents.guestId, guestId))
    .orderBy(desc(documents.createdAt));

  return NextResponse.json({ documents: rows });
}
