const buckets = new Map<string, { count: number; resetAt: number }>();

export function rateLimit(
  key: string,
  limit = Number(process.env.RATE_LIMIT_PER_MINUTE ?? 30),
) {
  const now = Date.now();
  const windowMs = 60_000;
  const current = buckets.get(key);

  if (!current || now >= current.resetAt) {
    buckets.set(key, { count: 1, resetAt: now + windowMs });
    return { ok: true as const, remaining: limit - 1 };
  }

  if (current.count >= limit) {
    return {
      ok: false as const,
      remaining: 0,
      retryAfterMs: current.resetAt - now,
    };
  }

  current.count += 1;
  return { ok: true as const, remaining: limit - current.count };
}
