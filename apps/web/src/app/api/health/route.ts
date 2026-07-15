import { NextResponse } from "next/server";

import { checkDbHealth, ensureSchema } from "@/lib/db";
import { checkQdrantHealth } from "@/lib/qdrant";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    if (process.env.DATABASE_URL && process.env.DATABASE_URL !== "pglite") {
      await ensureSchema();
    }
  } catch (error) {
    console.error("Schema bootstrap failed", error);
  }

  const [db, qdrant] = await Promise.all([checkDbHealth(), checkQdrantHealth()]);

  return NextResponse.json({
    status: db.ok && qdrant.ok ? "ok" : "degraded",
    database: db,
    qdrant,
    hints:
      !db.ok || !qdrant.ok
        ? [
            "Set DATABASE_URL (Neon/Postgres) in Vercel project env",
            "Set QDRANT_URL + QDRANT_API_KEY (Qdrant Cloud) in Vercel project env",
            "Redeploy after saving env vars",
          ]
        : undefined,
    timestamp: new Date().toISOString(),
  });
}
