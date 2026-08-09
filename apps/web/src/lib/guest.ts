import { cookies } from "next/headers";
import { v4 as uuidv4 } from "uuid";

export const GUEST_COOKIE = "kai_guest_id";
export const GUEST_HEADER = "x-guest-id";

export async function getOrCreateGuestId() {
  const jar = await cookies();
  const existing = jar.get(GUEST_COOKIE)?.value;
  if (existing) return existing;

  const id = uuidv4();
  jar.set(GUEST_COOKIE, id, {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 24 * 365,
  });
  return id;
}

export async function readGuestId() {
  const jar = await cookies();
  return jar.get(GUEST_COOKIE)?.value ?? null;
}

/**
 * Workspace resolution for the machine-facing `/api/v1` surface.
 *
 * Cookies are awkward for scripts, seeds, and eval runs, so an explicit
 * `x-guest-id` header is honoured — but only when the operator opts in with
 * `KAI_ALLOW_GUEST_HEADER=1`, since it lets a caller read any workspace.
 */
export async function resolveWorkspaceId(request: Request) {
  const header = request.headers.get(GUEST_HEADER)?.trim();
  if (header && process.env.KAI_ALLOW_GUEST_HEADER === "1") {
    return header;
  }
  return getOrCreateGuestId();
}
