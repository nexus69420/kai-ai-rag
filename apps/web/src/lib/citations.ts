const CITATION_RE = /\[(\d+(?:\s*,\s*\d+)*)\]/g;
const FENCE_RE = /```[\s\S]*?```/g;

export type ParsedClaim = {
  /** Claim text with citation markers removed. */
  text: string;
  raw: string;
  citations: number[];
};

export type ParsedAnswer = {
  claims: ParsedClaim[];
  citedClaims: ParsedClaim[];
  uncitedClaims: ParsedClaim[];
  citedNumbers: number[];
  /** Citations pointing at a source number that was never provided. */
  invalidCitations: number[];
  /** Retrieved sources the model never used. */
  unusedSources: number[];
};

export function extractCitationNumbers(text: string): number[] {
  const found = new Set<number>();
  for (const match of text.matchAll(CITATION_RE)) {
    for (const part of match[1].split(",")) {
      const value = Number(part.trim());
      if (Number.isInteger(value)) found.add(value);
    }
  }
  return [...found].sort((a, b) => a - b);
}

export function stripCitations(text: string): string {
  return text.replace(CITATION_RE, "").replace(/\s{2,}/g, " ").trim();
}

/**
 * Splits an answer into verifiable claims and checks the citation numbers
 * against the sources that were actually retrieved. Structural markdown
 * (headings, fences, list scaffolding) is excluded so the coverage metric
 * reflects factual sentences rather than formatting.
 */
export function parseCitations(
  answer: string,
  sourceCount: number,
): ParsedAnswer {
  const withoutCode = answer.replace(FENCE_RE, " ");
  const claims: ParsedClaim[] = [];

  for (const line of withoutCode.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    if (/^#{1,6}\s/.test(trimmed)) continue;
    if (/^([-*_]\s*){3,}$/.test(trimmed)) continue;

    const body = trimmed.replace(/^([-*+]|\d+[.)])\s+/, "").trim();
    if (!body) continue;

    const isListItem = body !== trimmed;
    const units = isListItem ? [body] : splitIntoSentences(body);

    for (const unit of units) {
      if (!isFactualClaim(unit)) continue;
      claims.push({
        raw: unit,
        text: stripCitations(unit),
        citations: extractCitationNumbers(unit),
      });
    }
  }

  const citedNumbers = [
    ...new Set(claims.flatMap((claim) => claim.citations)),
  ].sort((a, b) => a - b);

  const invalidCitations = citedNumbers.filter(
    (n) => n < 1 || n > sourceCount,
  );

  const unusedSources = Array.from(
    { length: Math.max(0, sourceCount) },
    (_, i) => i + 1,
  ).filter((n) => !citedNumbers.includes(n));

  return {
    claims,
    citedClaims: claims.filter((claim) => claim.citations.length > 0),
    uncitedClaims: claims.filter((claim) => claim.citations.length === 0),
    citedNumbers,
    invalidCitations,
    unusedSources,
  };
}

function splitIntoSentences(text: string): string[] {
  return text
    .split(/(?<=[.!?])\s+(?=[A-Z(“"'\d])/)
    .map((s) => s.trim())
    .filter(Boolean);
}

/**
 * Filters out scaffolding that cannot be verified: bold section labels,
 * questions back to the user, and fragments too short to assert anything.
 */
function isFactualClaim(text: string): boolean {
  const bare = stripCitations(text);
  if (!bare) return false;
  if (bare.endsWith("?")) return false;
  if (bare.endsWith(":") && bare.split(/\s+/).length <= 8) return false;
  if (/^\*\*[^*]+\*\*:?$/.test(bare)) return false;
  if (!/[a-zA-Z]/.test(bare)) return false;
  return bare.split(/\s+/).filter(Boolean).length >= 4;
}
