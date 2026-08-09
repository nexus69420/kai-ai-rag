import { tokenize } from "./bm25";
import { generateJson } from "./gemini";

/** Passages sent to the judge. Larger pools cost more without helping much. */
const MAX_POOL = 20;
const MAX_PASSAGE_CHARS = 1200;

export type Rerankable = {
  id: string;
  text: string;
  page: number;
  filename: string;
  heading?: string | null;
  score?: number;
  rerankScore?: number;
};

export type RerankOutcome<T extends Rerankable = Rerankable> = {
  candidates: T[];
  backend: "gemini" | "lexical" | "none";
};

/**
 * Second-pass precision filter. An LLM-as-judge scores each (query, passage)
 * pair, which catches passages that fused highly on vocabulary overlap but do
 * not actually answer the question. Falls back to lexical scoring so a quota
 * error degrades ranking instead of breaking the request.
 */
export async function rerankCandidates<T extends Rerankable>(options: {
  query: string;
  candidates: T[];
  apiKey: string;
  topK: number;
  model?: string;
}): Promise<RerankOutcome<T>> {
  const { query, candidates, apiKey, topK } = options;
  if (candidates.length <= 1) {
    return { candidates: candidates.slice(0, topK), backend: "none" };
  }

  const pool = candidates.slice(0, Math.min(candidates.length, MAX_POOL));

  try {
    const scored = await geminiRerank({
      query,
      pool,
      apiKey,
      model: options.model ?? "gemini-2.5-flash",
    });
    if (scored.length) {
      return { candidates: scored.slice(0, topK), backend: "gemini" };
    }
  } catch (error) {
    console.warn("Gemini rerank failed, using lexical fallback:", error);
  }

  return {
    candidates: lexicalRerank(query, pool).slice(0, topK),
    backend: "lexical",
  };
}

async function geminiRerank<T extends Rerankable>(options: {
  query: string;
  pool: T[];
  apiKey: string;
  model: string;
}): Promise<T[]> {
  const passages = options.pool.map((candidate, index) => ({
    id: index,
    source: candidate.filename,
    page: candidate.page,
    heading: candidate.heading ?? undefined,
    text: candidate.text.slice(0, MAX_PASSAGE_CHARS),
  }));

  const prompt = `Score how useful each passage is for answering the QUESTION.

Scoring guide:
1.0  directly answers the question
0.7  contains most of the answer or a definition of the exact topic
0.4  related background, or a heading whose body is elsewhere
0.1  same document but a different topic
0.0  irrelevant

Return ONLY JSON: {"rankings":[{"id":0,"score":0.0}]}
Include every passage id exactly once.

QUESTION:
${options.query}

PASSAGES:
${JSON.stringify(passages, null, 2)}`;

  const parsed = await generateJson<{
    rankings?: Array<{ id: number; score: number }>;
  }>({ apiKey: options.apiKey, model: options.model, prompt });

  const rankings = parsed.rankings ?? [];
  if (!rankings.length) return [];

  const scoreById = new Map(
    rankings.map((r) => [Number(r.id), clamp01(Number(r.score))]),
  );

  // Reorder the original objects; never rebuild passages from model output.
  return [...options.pool]
    .map((candidate, index) => {
      const rerankScore = scoreById.get(index);
      return {
        ...candidate,
        rerankScore: rerankScore ?? 0,
        score: rerankScore ?? candidate.score ?? 0,
      };
    })
    .sort((a, b) => (b.rerankScore ?? 0) - (a.rerankScore ?? 0));
}

/** Deterministic fallback: query-term coverage weighted by term rarity in the pool. */
export function lexicalRerank<T extends Rerankable>(
  query: string,
  pool: T[],
): T[] {
  const queryTerms = [...new Set(tokenize(query))];
  if (!queryTerms.length) return [...pool];

  const documentFrequency = new Map<string, number>();
  const tokenizedPool = pool.map((candidate) => {
    const tokens = new Set(tokenize(`${candidate.heading ?? ""} ${candidate.text}`));
    for (const term of tokens) {
      documentFrequency.set(term, (documentFrequency.get(term) ?? 0) + 1);
    }
    return tokens;
  });

  return pool
    .map((candidate, index) => {
      const tokens = tokenizedPool[index];
      let score = 0;
      for (const term of queryTerms) {
        if (!tokens.has(term)) continue;
        const df = documentFrequency.get(term) ?? 1;
        score += Math.log(1 + pool.length / df);
      }
      const normalized = clamp01(score / (queryTerms.length * Math.log(1 + pool.length)));
      return { ...candidate, rerankScore: normalized, score: normalized };
    })
    .sort((a, b) => (b.rerankScore ?? 0) - (a.rerankScore ?? 0));
}

function clamp01(value: number) {
  if (!Number.isFinite(value)) return 0;
  return Math.min(1, Math.max(0, value));
}
