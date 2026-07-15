import { NextResponse } from "next/server";

import { checkDbHealth, ensureSchema } from "@/lib/db";
import { checkQdrantHealth } from "@/lib/qdrant";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  await ensureSchema();
  const [db, qdrant] = await Promise.all([checkDbHealth(), checkQdrantHealth()]);

  return NextResponse.json({
    status: db.ok && qdrant.ok ? "ok" : "degraded",
    database: db,
    qdrant,
    timestamp: new Date().toISOString(),
  });
}
