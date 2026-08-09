import { generateJson } from "../../src/lib/gemini";
import type { GoldenCase } from "./types";

type JudgeResponse = { score?: number; reason?: string };

/**
 * LLM-as-judge correctness against the hand-written golden answer.
 *
 * Wording is allowed to differ; facts are not. Abstentions and clarification
 * requests are graded against what the case expects, so refusing to answer an
 * unanswerable question scores full marks rather than zero.
 */
export async function judgeCorrectness(options: {
  goldenCase: GoldenCase;
  answer: string;
  abstained: boolean;
  apiKey: string;
  model: string;
}): Promise<{ score: number; reason: string }> {
  const { goldenCase, answer, abstained } = options;

  if (!answer.trim()) {
    return { score: 0, reason: "Empty answer." };
  }

  const expectation =
    goldenCase.type === "no-answer"
      ? "The corpus does not contain the answer. Full credit requires the response to decline clearly and not assert an answer. Asserting a specific answer scores 0."
      : goldenCase.type === "ambiguous"
        ? "The question is ambiguous. Full credit requires either asking for clarification or enumerating the distinct interpretations from the reference. Picking one interpretation silently scores 0.5."
        : "Full credit requires every fact in the reference that the question asks for, with no contradicting statements. Extra correct detail is fine.";

  const prompt = `You grade a documentation assistant against a reference answer.

${expectation}

Score exactly one of:
1   — matches the reference on every fact the question asks for
0.5 — partially correct, or hedged/incomplete but not wrong
0   — contradicts the reference, or misses the point

Return ONLY JSON: {"score": 1, "reason": "one short sentence"}

QUESTION:
${goldenCase.question}

REFERENCE ANSWER:
${goldenCase.answer}

ASSISTANT ANSWER${abstained ? " (the assistant declined to answer)" : ""}:
${answer.slice(0, 6000)}`;

  try {
    const parsed = await generateJson<JudgeResponse>({
      apiKey: options.apiKey,
      model: options.model,
      prompt,
    });
    const score = normalizeScore(parsed.score);
    return { score, reason: String(parsed.reason ?? "").slice(0, 240) };
  } catch (error) {
    return {
      score: 0,
      reason: `Judge failed: ${error instanceof Error ? error.message : "unknown"}`,
    };
  }
}

function normalizeScore(value: unknown) {
  const score = Number(value);
  if (!Number.isFinite(score)) return 0;
  if (score >= 0.75) return 1;
  if (score >= 0.25) return 0.5;
  return 0;
}

/** Deterministic check that the answer surfaced the exact tokens that matter. */
export function checkMustInclude(
  answer: string,
  mustInclude?: string[],
): boolean | null {
  if (!mustInclude?.length) return null;
  const haystack = answer.toLowerCase();
  return mustInclude.every((needle) => haystack.includes(needle.toLowerCase()));
}

/**
 * Did retrieval surface at least one expected document, and how highly?
 * Reciprocal rank rewards putting the right document first.
 */
export function scoreRetrieval(
  retrievedFilenames: string[],
  expectedSources: string[],
): { hit: boolean | null; reciprocalRank: number | null } {
  if (!expectedSources.length) return { hit: null, reciprocalRank: null };

  const expected = new Set(expectedSources);
  const rank = retrievedFilenames.findIndex((filename) => expected.has(filename));

  return {
    hit: rank >= 0,
    reciprocalRank: rank >= 0 ? 1 / (rank + 1) : 0,
  };
}
