import { getGenAI } from "./gemini";
import type { SourcePayload } from "./db/schema";

type Candidate = SourcePayload & { id?: string };

/**
 * Gemini LLM reranker: scores (query, passage) pairs and reorders candidates.
 * Falls back to lexical overlap scoring if the model call fails.
 */
export async function rerankCandidates(options: {
  query: string;
  candidates: Candidate[];
  apiKey: string;
  topK: number;
  model?: string;
}): Promise<Candidate[]> {
  const { query, candidates, apiKey, topK } = options;
  if (candidates.length <= 1) return candidates.slice(0, topK);

  const model = options.model ?? "gemini-2.5-flash";
  const pool = candidates.slice(0, Math.min(candidates.length, 16));

  try {
    const ranked = await geminiRerank({
      query,
      pool,
      apiKey,
      model,
    });
    if (ranked.length) {
      return ranked.slice(0, topK);
    }
  } catch (error) {
    console.warn("Gemini rerank failed, using lexical fallback:", error);
  }

  return lexicalRerank(query, pool).slice(0, topK);
}

async function geminiRerank(options: {
  query: string;
  pool: Candidate[];
  apiKey: string;
  model: string;
}): Promise<Candidate[]> {
  const ai = getGenAI(options.apiKey);
  const passages = options.pool.map((c, index) => ({
    id: index,
    page: c.page,
    filename: c.filename,
    text: c.text.slice(0, 900),
  }));

  const prompt = `You are a relevance reranker for a document Q&A system.

Score how useful each passage is for answering the QUESTION.
- Prefer passages that define, explain, or directly discuss the topic.
- Short titles about the topic can still be relevant, but detailed explanations score higher.
- Irrelevant passages get low scores.

Return ONLY valid JSON:
{"rankings":[{"id":0,"score":0.0}, ...]}

scores must be numbers from 0 to 1.
Include every passage id exactly once, sorted by score descending.

QUESTION:
${options.query}

PASSAGES:
${JSON.stringify(passages, null, 2)}`;

  const response = await ai.models.generateContent({
    model: options.model,
    contents: prompt,
    config: {
      temperature: 0,
      responseMimeType: "application/json",
    },
  });

  const raw = response.text?.trim() ?? "";
  const parsed = JSON.parse(raw) as {
    rankings?: Array<{ id: number; score: number }>;
  };

  const rankings = parsed.rankings ?? [];
  if (!rankings.length) return [];

  const byId = new Map(rankings.map((r) => [Number(r.id), Number(r.score)]));
  return [...options.pool]
    .map((item, index) => ({
      ...item,
      score: byId.has(index) ? byId.get(index)! : item.score ?? 0,
    }))
    .sort((a, b) => (b.score ?? 0) - (a.score ?? 0));
}

function lexicalRerank(query: string, pool: Candidate[]): Candidate[] {
  const terms = query
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length > 2);

  return [...pool]
    .map((item) => {
      const hay = item.text.toLowerCase();
      let score = 0;
      for (const term of terms) {
        if (hay.includes(term)) score += 1;
        // Bonus for title-like short hits that still match
        if (hay.startsWith(term) || hay.includes(`\n${term}`)) score += 0.5;
      }
      if (terms.length) score /= terms.length;
      return { ...item, score };
    })
    .sort((a, b) => (b.score ?? 0) - (a.score ?? 0));
}
