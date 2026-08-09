import { DEFAULT_ABSTAIN_THRESHOLD, scoreAnswer, scoreRetrievalConfidence } from "./confidence";
import type {
  ConfidenceReport,
  CitationReport,
  RetrievalStats,
  SourcePayload,
} from "./db/schema";
import { streamChatAnswer } from "./gemini";
import { buildAbstainAnswer, buildUserPrompt, RAG_SYSTEM_PROMPT } from "./prompt";
import { hybridRetrieve, type RetrievalMode } from "./retrieve";
import { verifyAnswer, type CompletenessReport } from "./verify";

export type PipelineEvent =
  | {
      type: "meta";
      sources: SourcePayload[];
      stats: RetrievalStats;
      retrievalConfidence: number;
    }
  | { type: "delta"; text: string }
  | {
      type: "verification";
      citations: CitationReport;
      completeness: CompletenessReport;
    }
  | { type: "confidence"; confidence: ConfidenceReport; abstained: boolean };

export type PipelineOptions = {
  question: string;
  guestId: string;
  apiKey: string;
  filenameByDoc: Map<string, string>;
  documentIds?: string[] | null;
  history?: Array<{ role: "user" | "assistant"; content: string }>;
  chatModel?: string;
  embeddingModel?: string;
  temperature?: number;
  topK?: number;
  rerank?: boolean;
  retrievalMode?: RetrievalMode;
  denseWeight?: number;
  sparseWeight?: number;
  verifyCitations?: boolean;
  abstainThreshold?: number;
  onEvent?: (event: PipelineEvent) => void;
};

export type PipelineResult = {
  answer: string;
  sources: SourcePayload[];
  candidates: SourcePayload[];
  stats: RetrievalStats;
  citations: CitationReport;
  completeness: CompletenessReport;
  confidence: ConfidenceReport;
  abstained: boolean;
};

/**
 * Retrieve → gate → generate → verify → score.
 *
 * Shared by the streaming chat route and the JSON `/api/v1/ask` endpoint so
 * both surfaces answer with identical retrieval, citation, and confidence
 * behaviour. Callers stream by supplying `onEvent`.
 */
export async function runRagPipeline(
  options: PipelineOptions,
): Promise<PipelineResult> {
  const emit = options.onEvent ?? (() => {});
  const abstainThreshold = options.abstainThreshold ?? DEFAULT_ABSTAIN_THRESHOLD;
  const chatModel = options.chatModel ?? "gemini-2.5-flash";

  const retrieval = await hybridRetrieve({
    query: options.question,
    guestId: options.guestId,
    documentIds: options.documentIds ?? null,
    apiKey: options.apiKey,
    embeddingModel: options.embeddingModel,
    topK: options.topK ?? 5,
    filenameByDoc: options.filenameByDoc,
    mode: options.retrievalMode ?? "hybrid",
    denseWeight: options.denseWeight,
    sparseWeight: options.sparseWeight,
    rerank: options.rerank,
  });

  const { sources, candidates, stats } = retrieval;
  const retrievalConfidence = scoreRetrievalConfidence(stats);
  emit({ type: "meta", sources, stats, retrievalConfidence });

  if (!sources.length || retrievalConfidence < abstainThreshold) {
    const answer = buildAbstainAnswer({
      sources,
      stats,
      threshold: abstainThreshold,
      retrievalConfidence,
    });

    const confidence: ConfidenceReport = {
      score: retrievalConfidence,
      band: "low",
      retrieval: retrievalConfidence,
      citationCoverage: 0,
      completeness: 0,
      reasons: [
        `Retrieval confidence ${percent(retrievalConfidence)} is below the ${percent(abstainThreshold)} threshold.`,
        stats.keywordCoverage < 0.5
          ? `Only ${percent(stats.keywordCoverage)} of the question's terms appear in the indexed text.`
          : "No passage tied the question's terms together well enough to answer.",
      ],
    };

    emit({ type: "delta", text: answer });
    emit({ type: "confidence", confidence, abstained: true });

    return {
      answer,
      sources,
      candidates,
      stats,
      citations: emptyCitationReport(),
      completeness: { score: 0, subQuestions: [] },
      confidence,
      abstained: true,
    };
  }

  let answer = "";
  for await (const delta of streamChatAnswer({
    apiKey: options.apiKey,
    model: chatModel,
    temperature: options.temperature ?? 0.4,
    system: RAG_SYSTEM_PROMPT,
    user: buildUserPrompt(options.question, sources),
    history: options.history ?? [],
  })) {
    answer += delta;
    emit({ type: "delta", text: delta });
  }

  const verification = await verifyAnswer({
    question: options.question,
    answer,
    sources,
    apiKey: options.apiKey,
    model: chatModel,
    enabled: options.verifyCitations,
  });

  const confidence = scoreAnswer({
    stats,
    citations: verification.citations,
    completeness: verification.completeness.score,
  });

  emit({
    type: "verification",
    citations: verification.citations,
    completeness: verification.completeness,
  });
  emit({ type: "confidence", confidence, abstained: false });

  return {
    answer,
    sources,
    candidates,
    stats,
    citations: verification.citations,
    completeness: verification.completeness,
    confidence,
    abstained: false,
  };
}

function emptyCitationReport(): CitationReport {
  return {
    verified: false,
    totalClaims: 0,
    citedClaims: 0,
    supportedClaims: 0,
    unsupportedClaims: 0,
    groundedClaims: 0,
    miscitedClaims: 0,
    invalidCitations: [],
    unusedSources: [],
    verdicts: [],
  };
}

function percent(value: number) {
  return `${Math.round(value * 100)}%`;
}
