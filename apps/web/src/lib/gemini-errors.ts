const QUOTA_MESSAGE =
  "Quota exceeded. Use a different API key in Settings.";

/** Map Gemini / GenAI SDK errors to short user-facing messages. */
export function formatGeminiError(error: unknown): string {
  const raw =
    error instanceof Error
      ? error.message
      : typeof error === "string"
        ? error
        : String(error ?? "");

  const lower = raw.toLowerCase();
  const looksLikeQuota =
    lower.includes("resource_exhausted") ||
    lower.includes("exceeded your current quota") ||
    lower.includes("quota exceeded") ||
    lower.includes("too many requests") ||
    lower.includes('"code":429') ||
    lower.includes('"code": 429') ||
    /\b429\b/.test(raw);

  if (looksLikeQuota) return QUOTA_MESSAGE;

  // Avoid dumping huge JSON blobs into the chat UI.
  if (raw.trim().startsWith("{") && raw.length > 180) {
    try {
      const parsed = JSON.parse(raw) as {
        error?: { message?: string; status?: string; code?: number };
      };
      const msg = parsed.error?.message ?? "";
      if (
        parsed.error?.status === "RESOURCE_EXHAUSTED" ||
        parsed.error?.code === 429 ||
        /quota|rate limit|too many requests/i.test(msg)
      ) {
        return QUOTA_MESSAGE;
      }
      if (msg) return msg.slice(0, 240);
    } catch {
      // fall through
    }
    return "The model request failed. Try again or check your API key in Settings.";
  }

  return raw || "The model stopped while generating an answer.";
}
