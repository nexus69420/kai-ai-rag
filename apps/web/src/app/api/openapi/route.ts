import { NextResponse } from "next/server";

import { buildOpenApiSpec } from "@/lib/openapi";

export const runtime = "nodejs";

export async function GET() {
  return NextResponse.json(buildOpenApiSpec(), {
    headers: { "cache-control": "public, max-age=300" },
  });
}
