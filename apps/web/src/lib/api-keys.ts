/**
 * Gemini API key pool.
 *
 * A single free-tier key cannot carry an eval run: 70 questions each cost an
 * embedding, an answer, a verification pass, and a judge call. Numbered keys
 * (`GOOGLE_API_KEY`, `GOOGLE_API_KEY_2`, …) are tried in order, and a key that
 * reports exhausted quota is skipped for a cooldown window so later requests
 * do not pay for its 429 again.
 *
 * This is failover, not load balancing: the first healthy key handles
 * everything until it runs out.
 */

/** `GOOGLE_API_KEY` plus `GOOGLE_API_KEY_2` through `_10`. */
const MAX_KEYS = 10;

/** Used when the error carries no `retryDelay` of its own. */
const DEFAULT_COOLDOWN_MS = 60_000;

/** Key → timestamp it becomes usable again. Module-scoped, so it resets on redeploy. */
const cooldowns = new Map<string, number>();

export function envApiKeys(): string[] {
  const raw = [
    process.env.GOOGLE_API_KEY,
    ...Array.from(
      { length: MAX_KEYS - 1 },
      (_, index) => process.env[`GOOGLE_API_KEY_${index + 2}`],
    ),
  ];

  const seen = new Set<string>();
  const keys: string[] = [];
  for (const value of raw) {
    const key = value?.trim();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    keys.push(key);
  }
  return keys;
}

/**
 * Keys to try, in order. A caller-supplied key (BYOK from Settings, or the one
 * the eval harness resolved) goes first; the server pool backs it up, matching
 * the existing behaviour where `GOOGLE_API_KEY` is a fallback. Keys in cooldown
 * sort to the back rather than being dropped, so an exhausted pool still gets
 * one last attempt instead of failing with no request at all.
 */
export function keyPool(preferred?: string | null): string[] {
  const first = preferred?.trim();
  const ordered = first
    ? [first, ...envApiKeys().filter((key) => key !== first)]
    : envApiKeys();

  const now = Date.now();
  const ready = ordered.filter((key) => (cooldowns.get(key) ?? 0) <= now);
  const cooling = ordered.filter((key) => (cooldowns.get(key) ?? 0) > now);
  return [...ready, ...cooling];
}

export function markKeyExhausted(key: string, retryAfterMs?: number | null) {
  const wait =
    typeof retryAfterMs === "number" && retryAfterMs > 0
      ? retryAfterMs
      : DEFAULT_COOLDOWN_MS;
  cooldowns.set(key, Date.now() + wait);
}

export function isKeyCoolingDown(key: string) {
  return (cooldowns.get(key) ?? 0) > Date.now();
}

/** Test seam; also useful for a manual reset after rotating keys. */
export function clearKeyCooldowns() {
  cooldowns.clear();
}

/** How many keys are configured and usable right now, for /api/health. */
export function keyPoolStatus() {
  const keys = envApiKeys();
  return {
    configured: keys.length,
    available: keys.filter((key) => !isKeyCoolingDown(key)).length,
  };
}
