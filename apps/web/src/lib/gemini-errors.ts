const QUOTA_MESSAGE = "Quota exceeded. Use a different API key in Settings.";

function errorText(error: unknown): string {
  return error instanceof Error
    ? error.message
    : typeof error === "string"
      ? error
      : String(error ?? "");
}

/**
 * Whether the failure is a rate limit or exhausted quota, as opposed to a bad
 * key or a malformed request. Drives both the user-facing message and key
 * failover, so the two can never disagree about what "out of quota" means.
 */
export function isQuotaError(error: unknown): boolean {
  const raw = errorText(error);
  const lower = raw.toLowerCase();

  if (
    lower.includes("resource_exhausted") ||
    lower.includes("exceeded your current quota") ||
    lower.includes("quota exceeded") ||
    lower.includes("too many requests") ||
    lower.includes('"code":429') ||
    lower.includes('"code": 429') ||
    /\b429\b/.test(raw)
  ) {
    return true;
  }

  const parsed = parseErrorJson(raw);
  if (!parsed) return false;
  return (
    parsed.status === "RESOURCE_EXHAUSTED" ||
    parsed.code === 429 ||
    /quota|rate limit|too many requests/i.test(parsed.message ?? "")
  );
}

/**
 * Gemini reports how long to wait in a `retryDelay` field (for example
 * `"retryDelay":"29s"`). Used to decide how long to skip an exhausted key
 * rather than guessing.
 */
export function quotaRetryAfterMs(error: unknown): number | null {
  const match = /"retryDelay"\s*:\s*"(\d+(?:\.\d+)?)s"/.exec(errorText(error));
  if (!match) return null;
  const seconds = Number(match[1]);
  return Number.isFinite(seconds) ? Math.round(seconds * 1000) : null;
}

/** Map Gemini / GenAI SDK errors to short user-facing messages. */
export function formatGeminiError(error: unknown): string {
  const raw = errorText(error);
  if (isQuotaError(error)) return QUOTA_MESSAGE;

  // Avoid dumping huge JSON blobs into the chat UI.
  if (raw.trim().startsWith("{") && raw.length > 180) {
    const parsed = parseErrorJson(raw);
    if (parsed?.message) return parsed.message.slice(0, 240);
    return "The model request failed. Try again or check your API key in Settings.";
  }

  return raw || "The model stopped while generating an answer.";
}

function parseErrorJson(raw: string) {
  if (!raw.trim().startsWith("{")) return null;
  try {
    const parsed = JSON.parse(raw) as {
      error?: { message?: string; status?: string; code?: number };
    };
    return parsed.error ?? null;
  } catch {
    return null;
  }
}
