import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  clearKeyCooldowns,
  envApiKeys,
  isKeyCoolingDown,
  keyPool,
  keyPoolStatus,
  markKeyExhausted,
} from "../src/lib/api-keys";
import {
  formatGeminiError,
  isQuotaError,
  quotaRetryAfterMs,
} from "../src/lib/gemini-errors";

const KEY_VARS = [
  "GOOGLE_API_KEY",
  "GOOGLE_API_KEY_2",
  "GOOGLE_API_KEY_3",
  "GOOGLE_API_KEY_4",
  "GOOGLE_API_KEY_5",
];

describe("envApiKeys", () => {
  beforeEach(() => {
    for (const name of KEY_VARS) delete process.env[name];
    clearKeyCooldowns();
  });

  afterEach(() => {
    for (const name of KEY_VARS) delete process.env[name];
    clearKeyCooldowns();
    vi.useRealTimers();
  });

  it("collects the numbered keys in order", () => {
    process.env.GOOGLE_API_KEY = "k1";
    process.env.GOOGLE_API_KEY_2 = "k2";
    process.env.GOOGLE_API_KEY_5 = "k5";
    expect(envApiKeys()).toEqual(["k1", "k2", "k5"]);
  });

  it("skips blank entries and trims whitespace", () => {
    process.env.GOOGLE_API_KEY = "  k1  ";
    process.env.GOOGLE_API_KEY_2 = "   ";
    process.env.GOOGLE_API_KEY_3 = "k3";
    expect(envApiKeys()).toEqual(["k1", "k3"]);
  });

  it("deduplicates a key pasted into two slots", () => {
    process.env.GOOGLE_API_KEY = "same";
    process.env.GOOGLE_API_KEY_2 = "same";
    process.env.GOOGLE_API_KEY_3 = "other";
    expect(envApiKeys()).toEqual(["same", "other"]);
  });

  it("returns an empty pool when nothing is configured", () => {
    expect(envApiKeys()).toEqual([]);
  });
});

describe("keyPool", () => {
  beforeEach(() => {
    for (const name of KEY_VARS) delete process.env[name];
    clearKeyCooldowns();
    process.env.GOOGLE_API_KEY = "k1";
    process.env.GOOGLE_API_KEY_2 = "k2";
    process.env.GOOGLE_API_KEY_3 = "k3";
  });

  afterEach(() => {
    for (const name of KEY_VARS) delete process.env[name];
    clearKeyCooldowns();
    vi.useRealTimers();
  });

  it("puts a caller-supplied key first and keeps the server pool as backup", () => {
    expect(keyPool("byok")).toEqual(["byok", "k1", "k2", "k3"]);
  });

  it("does not duplicate a caller key that is also in the environment", () => {
    expect(keyPool("k2")).toEqual(["k2", "k1", "k3"]);
  });

  it("moves an exhausted key to the back instead of dropping it", () => {
    markKeyExhausted("k1");
    expect(keyPool()).toEqual(["k2", "k3", "k1"]);
  });

  it("restores a key once its cooldown expires", () => {
    vi.useFakeTimers();
    markKeyExhausted("k1", 5_000);
    expect(keyPool()[0]).toBe("k2");
    expect(isKeyCoolingDown("k1")).toBe(true);

    vi.advanceTimersByTime(5_001);
    expect(keyPool()[0]).toBe("k1");
    expect(isKeyCoolingDown("k1")).toBe(false);
  });

  it("still offers every key when the whole pool is cooling down", () => {
    for (const key of ["k1", "k2", "k3"]) markKeyExhausted(key);
    // Better to attempt a request that might succeed than to fail with none.
    expect(keyPool().sort()).toEqual(["k1", "k2", "k3"]);
  });

  it("reports configured and available counts without leaking keys", () => {
    markKeyExhausted("k2");
    expect(keyPoolStatus()).toEqual({ configured: 3, available: 2 });
  });
});

describe("isQuotaError", () => {
  it("recognizes the shapes Gemini returns for exhausted quota", () => {
    expect(isQuotaError(new Error("429 Too Many Requests"))).toBe(true);
    expect(isQuotaError(new Error("RESOURCE_EXHAUSTED"))).toBe(true);
    expect(isQuotaError("You exceeded your current quota")).toBe(true);
    expect(
      isQuotaError(
        JSON.stringify({
          error: { code: 429, status: "RESOURCE_EXHAUSTED", message: "quota" },
        }),
      ),
    ).toBe(true);
  });

  it("does not treat auth or request errors as quota errors", () => {
    expect(isQuotaError(new Error("API key not valid"))).toBe(false);
    expect(isQuotaError(new Error("400 Bad Request"))).toBe(false);
    expect(
      isQuotaError(
        JSON.stringify({ error: { code: 403, message: "permission denied" } }),
      ),
    ).toBe(false);
    expect(isQuotaError(undefined)).toBe(false);
  });

  it("agrees with the user-facing message, so failover and UI cannot diverge", () => {
    const error = new Error("429 RESOURCE_EXHAUSTED");
    expect(isQuotaError(error)).toBe(true);
    expect(formatGeminiError(error)).toMatch(/quota/i);
  });
});

describe("quotaRetryAfterMs", () => {
  it("reads the retry delay the API suggests", () => {
    expect(
      quotaRetryAfterMs('{"error":{"details":[{"retryDelay":"29s"}]}}'),
    ).toBe(29_000);
  });

  it("returns null when no delay is present", () => {
    expect(quotaRetryAfterMs(new Error("429"))).toBeNull();
  });
});
