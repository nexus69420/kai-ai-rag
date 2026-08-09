import { eq } from "drizzle-orm";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";

import { ensureSchema, getDb } from "@/lib/db";
import { documents } from "@/lib/db/schema";
import { GUEST_COOKIE } from "@/lib/guest";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const DEMO_WORKSPACE_ID =
  process.env.KAI_DEMO_WORKSPACE_ID ?? "kai-demo-workspace";

/**
 * Attaches the browser session to the seeded demo workspace. Disabled unless
 * the operator sets KAI_ENABLE_DEMO=1, because it hands out a shared workspace.
 */
export async function GET(request: Request) {
  if (process.env.KAI_ENABLE_DEMO !== "1") {
    return NextResponse.json(
      { error: "Demo workspace is disabled. Set KAI_ENABLE_DEMO=1 to enable." },
      { status: 404 },
    );
  }

  await ensureSchema();
  const db = getDb();
  const seeded = await db
    .select({ id: documents.id })
    .from(documents)
    .where(eq(documents.guestId, DEMO_WORKSPACE_ID))
    .limit(1);

  if (!seeded.length) {
    return NextResponse.json(
      { error: "Demo workspace is empty. Run `npm run seed` first." },
      { status: 409 },
    );
  }

  const jar = await cookies();
  jar.set(GUEST_COOKIE, DEMO_WORKSPACE_ID, {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 24 * 7,
  });

  return NextResponse.redirect(new URL("/chat", request.url));
}
