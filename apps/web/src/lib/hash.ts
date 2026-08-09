import { createHash } from "crypto";

/**
 * Stable fingerprint for duplicate detection: case- and whitespace-insensitive
 * but punctuation-preserving, since config keys and code identifiers matter.
 */
export function contentFingerprint(text: string) {
  const normalized = String(text ?? "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
  return createHash("sha256").update(normalized).digest("hex");
}
