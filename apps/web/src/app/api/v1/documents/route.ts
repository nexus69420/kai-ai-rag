import { desc, eq } from "drizzle-orm";
import { NextResponse } from "next/server";

import { ensureSchema, getDb } from "@/lib/db";
import { documents } from "@/lib/db/schema";
import { resolveWorkspaceId } from "@/lib/guest";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  await ensureSchema();
  const guestId = await resolveWorkspaceId(request);
  const db = getDb();

  const rows = await db
    .select({
      id: documents.id,
      filename: documents.filename,
      sourceType: documents.sourceType,
      chunkStrategy: documents.chunkStrategy,
      embeddingModel: documents.embeddingModel,
      chunkCount: documents.chunkCount,
      duplicateChunks: documents.duplicateChunks,
      pageCount: documents.pageCount,
      status: documents.status,
      createdAt: documents.createdAt,
    })
    .from(documents)
    .where(eq(documents.guestId, guestId))
    .orderBy(desc(documents.createdAt));

  return NextResponse.json({
    documents: rows,
    totals: {
      documents: rows.length,
      chunks: rows.reduce((acc, row) => acc + row.chunkCount, 0),
      duplicatesSkipped: rows.reduce(
        (acc, row) => acc + row.duplicateChunks,
        0,
      ),
    },
  });
}
