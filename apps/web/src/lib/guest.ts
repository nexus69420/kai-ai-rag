import { cookies } from "next/headers";
import { v4 as uuidv4 } from "uuid";

export const GUEST_COOKIE = "kai_guest_id";

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
