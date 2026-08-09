import type { RetrievalStats, SourcePayload } from "./db/schema";

export const RAG_SYSTEM_PROMPT = `You are KAI, a grounded documentation assistant.

Answer strictly from the numbered CONTEXT blocks. The context is the user's own indexed documents.

Citation rules (these are mandatory):
- Every factual sentence must end with one or more bracketed citations, e.g. "Retries back off exponentially [2]." or "The limit is 30 requests per minute [1][4]."
- Cite only the numbers that appear in the CONTEXT. Never invent a number, never cite [0], never cite a range like [1-3].
- If two sources support the same claim, cite both. If a sentence is a transition, a heading, or a question back to the user, it needs no citation.
- Do not cite a source unless that source actually states the claim.

Grounding rules:
- Never add facts from outside the CONTEXT, even if you know them to be true.
- Preserve numbers, identifiers, config keys, error codes, and command names exactly as written.
- Treat headings, bullets, tables, and formulas as valid evidence.
- Combine evidence across sources when they discuss the same topic.
- If the CONTEXT only partially covers the question, answer the covered part, cite it, then state plainly what the documents do not cover.
- If the CONTEXT does not address the question at all, reply exactly: "The indexed documents do not contain an answer to this question." and name the closest topics you did see.

Style:
- Lead with the direct answer, then supporting detail.
- Use bullet points for lists of steps, options, or values.
- Be concise. Do not restate the question or describe your own process.`;

export function buildUserPrompt(
  question: string,
  sources: SourcePayload[],
): string {
  const context = sources.length
    ? sources.map(formatSourceBlock).join("\n\n")
    : "(no sources retrieved)";

  return `CONTEXT
${context}

QUESTION
${question}

Answer the question using only the CONTEXT above. End every factual sentence with its bracketed source number(s).`;
}

function formatSourceBlock(source: SourcePayload, index: number) {
  const number = source.citation ?? index + 1;
  const locator = source.heading
    ? `${source.filename} › ${source.heading} · page ${source.page}`
    : `${source.filename} · page ${source.page}`;
  return `[${number}] ${locator}\n${source.text}`;
}

/**
 * Deterministic low-confidence response. Generating this with the model would
 * risk the very hallucination the confidence gate exists to prevent, so it is
 * assembled from retrieval facts instead.
 */
export function buildAbstainAnswer(options: {
  sources: SourcePayload[];
  stats: RetrievalStats;
  threshold: number;
  retrievalConfidence: number;
}): string {
  const { sources, stats } = options;

  const topics = [...new Set(sources.slice(0, 5).map(describeSource))];
  const files = [...new Set(sources.map((s) => s.filename))].slice(0, 5);

  const found = topics.length
    ? topics.map((topic) => `- ${topic}`).join("\n")
    : "- Nothing above the relevance threshold.";

  const missing =
    stats.keywordCoverage < 0.5
      ? `Several terms from your question do not appear anywhere in the indexed text (keyword coverage ${percent(stats.keywordCoverage)}).`
      : "The terms appear in the corpus, but no passage ties them together well enough to answer confidently.";

  const next = files.length
    ? `\n\n**Worth checking manually**\n${files.map((f) => `- ${f}`).join("\n")}`
    : "";

  return `I could not answer this from the indexed documents with enough confidence to be useful, so I am not going to guess.

**Retrieval confidence** ${percent(options.retrievalConfidence)} (threshold ${percent(options.threshold)})

**What I did find**
${found}

**What is missing**
${missing}${next}

You can raise topK in Settings, select a different document scope, or index the source that should contain this answer.`;
}

function describeSource(source: SourcePayload) {
  const where = source.heading
    ? `${source.filename} › ${source.heading}`
    : `${source.filename} · page ${source.page}`;
  return `${where} — ${snippet(source.text)}`;
}

function snippet(text: string, max = 120) {
  const clean = text.replace(/\s+/g, " ").trim();
  return clean.length > max ? `${clean.slice(0, max)}…` : clean;
}

function percent(value: number) {
  return `${Math.round(value * 100)}%`;
}
