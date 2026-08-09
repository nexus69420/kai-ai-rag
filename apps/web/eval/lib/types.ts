import type { ChunkStrategy } from "../../src/lib/chunking";
import type { RetrievalMode } from "../../src/lib/retrieve";

export type CaseType = "lookup" | "multihop" | "no-answer" | "ambiguous";

export type GoldenCase = {
  id: string;
  type: CaseType;
  question: string;
  answer: string;
  expectedSources: string[];
  mustInclude?: string[];
  expectAbstain?: boolean;
  expectClarification?: boolean;
};

export type GoldenSet = {
  version: number;
  corpus: string;
  notes?: string;
  cases: GoldenCase[];
};

export type CaseResult = {
  id: string;
  type: CaseType;
  question: string;
  answer: string;
  abstained: boolean;
  /** LLM-as-judge score against the golden answer: 1, 0.5, or 0. */
  correctness: number;
  correctnessReason: string;
  faithfulness: number | null;
  citationAccuracy: number | null;
  retrievalHit: boolean | null;
  reciprocalRank: number | null;
  mustIncludeHit: boolean | null;
  abstainCorrect: boolean;
  confidence: number;
  confidenceBand: string;
  retrievedSources: string[];
  totalClaims: number;
  unsupportedClaims: number;
  miscitedClaims: number;
  invalidCitations: number[];
  durationMs: number;
  error?: string;
};

export type RunConfig = {
  label: string;
  strategy: ChunkStrategy;
  mode: RetrievalMode;
  topK: number;
  rerank: boolean;
  verifyCitations: boolean;
  denseWeight: number;
  sparseWeight: number;
  abstainThreshold: number;
  chatModel: string;
  embeddingModel: string;
  judgeModel: string;
  concurrency: number;
};

export type Aggregate = {
  cases: number;
  correctness: number;
  faithfulness: number;
  citationAccuracy: number;
  retrievalRecall: number;
  retrievalMrr: number;
  mustIncludeRate: number;
  abstainAccuracy: number;
  meanConfidence: number;
  meanLatencyMs: number;
  byType: Record<
    string,
    { cases: number; correctness: number; retrievalRecall: number }
  >;
};

export type RunReport = {
  startedAt: string;
  finishedAt: string;
  config: RunConfig;
  index: {
    workspaceId: string;
    documents: number;
    chunks: number;
    reused: boolean;
  };
  aggregate: Aggregate;
  results: CaseResult[];
};
