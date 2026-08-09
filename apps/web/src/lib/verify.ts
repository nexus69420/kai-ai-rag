import { parseCitations, type ParsedClaim } from "./citations";
import type { CitationReport, CitationVerdict, SourcePayload } from "./db/schema";
import { generateJson } from "./gemini";

/** Cost guard: long answers get their first N claims verified. */
const MAX_CLAIMS = 24;
const MAX_SOURCE_CHARS = 1400;

export type CompletenessReport = {
  score: number;
  subQuestions: Array<{ question: string; addressed: boolean }>;
};

export type VerificationResult = {
  citations: CitationReport;
  completeness: CompletenessReport;
};

type JudgeResponse = {
  verdicts?: Array<{
    id: number;
    status?: string;
    supportedBy?: number[];
    reason?: string;
  }>;
  subQuestions?: Array<{ question?: string; addressed?: boolean }>;
};

/**
 * Verifies the answer against the passages it claims to be based on.
 *
 * Two failure modes get caught here that a plain RAG pipeline never sees:
 * a claim that no retrieved source supports (hallucination), and a claim that
 * is true of the corpus but attached to the wrong source number (miscitation).
 */
export async function verifyAnswer(options: {
  question: string;
  answer: string;
  sources: SourcePayload[];
  apiKey: string;
  model?: string;
  enabled?: boolean;
}): Promise<VerificationResult> {
  const parsed = parseCitations(options.answer, options.sources.length);

  if (options.enabled === false || !parsed.claims.length) {
    return {
      citations: unverifiedReport(parsed),
      completeness: { score: parsed.claims.length ? 1 : 0, subQuestions: [] },
    };
  }

  const claims = parsed.claims.slice(0, MAX_CLAIMS);

  try {
    const judged = await runJudge({
      question: options.question,
      claims,
      sources: options.sources,
      apiKey: options.apiKey,
      model: options.model ?? "gemini-2.5-flash",
    });

    return buildReport(parsed, claims, judged);
  } catch (error) {
    console.warn("Citation verification failed:", error);
    return {
      citations: unverifiedReport(parsed),
      completeness: { score: 0.5, subQuestions: [] },
    };
  }
}

async function runJudge(options: {
  question: string;
  claims: ParsedClaim[];
  sources: SourcePayload[];
  apiKey: string;
  model: string;
}): Promise<JudgeResponse> {
  const sources = options.sources.map((source, index) => ({
    id: source.citation ?? index + 1,
    source: source.filename,
    page: source.page,
    heading: source.heading ?? undefined,
    text: source.text.slice(0, MAX_SOURCE_CHARS),
  }));

  const claims = options.claims.map((claim, index) => ({
    id: index,
    claim: claim.text,
    cited: claim.citations,
  }));

  const prompt = `You are a strict citation auditor for a documentation QA system.

For each CLAIM decide whether the SOURCES literally support it.
- "supported": at least one source states the claim (paraphrase is fine, inference is not).
- "partial": a source is clearly on topic but is missing part of the claim (a number, condition, or step).
- "unsupported": no source states it. Outside knowledge, plausible guesses, and unstated inferences are unsupported.

Also list "supportedBy" — every source id that supports the claim, independent of what the author cited.

Then decompose the QUESTION into its distinct sub-questions and mark whether the set of claims addresses each one.

Return ONLY JSON:
{"verdicts":[{"id":0,"status":"supported","supportedBy":[1],"reason":"short"}],
 "subQuestions":[{"question":"...","addressed":true}]}

QUESTION:
${options.question}

SOURCES:
${JSON.stringify(sources, null, 2)}

CLAIMS:
${JSON.stringify(claims, null, 2)}`;

  return generateJson<JudgeResponse>({
    apiKey: options.apiKey,
    model: options.model,
    prompt,
  });
}

function buildReport(
  parsed: ReturnType<typeof parseCitations>,
  judgedClaims: ParsedClaim[],
  judged: JudgeResponse,
): VerificationResult {
  const byId = new Map(
    (judged.verdicts ?? []).map((verdict) => [Number(verdict.id), verdict]),
  );

  const verdicts: CitationVerdict[] = judgedClaims.map((claim, index) => {
    const raw = byId.get(index);
    const supportedBy = (raw?.supportedBy ?? [])
      .map(Number)
      .filter((n) => Number.isInteger(n) && n > 0);
    const judgeStatus = normalizeStatus(raw?.status);

    if (!raw) {
      return {
        claim: claim.text,
        citations: claim.citations,
        supportedBy,
        status: "unverified",
      };
    }

    // Grounded in the corpus but attached to the wrong source number.
    const citedCorrectly =
      claim.citations.length > 0 &&
      claim.citations.some((n) => supportedBy.includes(n));

    let status: CitationVerdict["status"] = judgeStatus;
    if (judgeStatus === "supported" && claim.citations.length && !citedCorrectly) {
      status = "partial";
    }

    return {
      claim: claim.text,
      citations: claim.citations,
      supportedBy,
      status,
      reason: raw.reason?.slice(0, 240),
    };
  });

  // Claims beyond the verification budget stay explicitly unverified.
  for (const claim of parsed.claims.slice(judgedClaims.length)) {
    verdicts.push({
      claim: claim.text,
      citations: claim.citations,
      supportedBy: [],
      status: "unverified",
    });
  }

  const cited = verdicts.filter((v) => v.citations.length > 0);
  const supportedCited = cited.filter((v) => v.status === "supported");
  const grounded = verdicts.filter(
    (v) => v.status === "supported" || v.status === "partial",
  );
  const miscited = cited.filter(
    (v) =>
      v.status === "partial" &&
      v.supportedBy.length > 0 &&
      !v.citations.some((n) => v.supportedBy.includes(n)),
  );

  const subQuestions = (judged.subQuestions ?? [])
    .map((item) => ({
      question: String(item.question ?? "").slice(0, 200),
      addressed: Boolean(item.addressed),
    }))
    .filter((item) => item.question);

  const completeness = subQuestions.length
    ? subQuestions.filter((s) => s.addressed).length / subQuestions.length
    : verdicts.length
      ? 1
      : 0;

  return {
    citations: {
      verified: true,
      totalClaims: verdicts.length,
      citedClaims: cited.length,
      supportedClaims: supportedCited.length,
      unsupportedClaims: verdicts.filter((v) => v.status === "unsupported").length,
      groundedClaims: grounded.length,
      miscitedClaims: miscited.length,
      invalidCitations: parsed.invalidCitations,
      unusedSources: parsed.unusedSources,
      verdicts,
    },
    completeness: { score: round(completeness), subQuestions },
  };
}

function normalizeStatus(value?: string): CitationVerdict["status"] {
  const status = String(value ?? "").toLowerCase();
  if (status === "supported") return "supported";
  if (status === "partial" || status === "partially_supported") return "partial";
  if (status === "unsupported") return "unsupported";
  return "unverified";
}

function unverifiedReport(
  parsed: ReturnType<typeof parseCitations>,
): CitationReport {
  return {
    verified: false,
    totalClaims: parsed.claims.length,
    citedClaims: parsed.citedClaims.length,
    supportedClaims: 0,
    unsupportedClaims: 0,
    groundedClaims: 0,
    miscitedClaims: 0,
    invalidCitations: parsed.invalidCitations,
    unusedSources: parsed.unusedSources,
    verdicts: parsed.claims.map((claim) => ({
      claim: claim.text,
      citations: claim.citations,
      supportedBy: [],
      status: "unverified" as const,
    })),
  };
}

function round(value: number) {
  return Math.round(value * 1000) / 1000;
}
