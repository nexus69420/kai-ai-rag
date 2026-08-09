import { NextResponse } from "next/server";

import { keyPoolStatus } from "@/lib/api-keys";
import { CHUNK_STRATEGIES } from "@/lib/chunking";
import { checkDbHealth, ensureSchema } from "@/lib/db";
import { checkQdrantHealth } from "@/lib/qdrant";
import { RETRIEVAL_MODES } from "@/lib/retrieve";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    await ensureSchema();
  } catch (error) {
    console.error("Schema bootstrap failed", error);
  }

  const [db, qdrant] = await Promise.all([checkDbHealth(), checkQdrantHealth()]);

  return NextResponse.json({
    status: db.ok && qdrant.ok ? "ok" : "degraded",
    database: db,
    qdrant,
    capabilities: {
      chunkStrategies: CHUNK_STRATEGIES,
      retrievalModes: RETRIEVAL_MODES,
      sparseRetriever: "bm25",
      citationVerification: true,
      confidenceScoring: true,
      openapi: "/api/openapi",
    },
    // Counts only; never the keys themselves.
    apiKeys: keyPoolStatus(),
    hints:
      !db.ok || !qdrant.ok
        ? [
            "Set DATABASE_URL (Neon/Postgres) in the project env",
            "Set QDRANT_URL + QDRANT_API_KEY (Qdrant Cloud) in the project env",
            "Redeploy after saving env vars",
          ]
        : undefined,
    timestamp: new Date().toISOString(),
  });
}
