import { getDb } from "../../src/lib/db";
import { evalRuns } from "../../src/lib/db/schema";
import { runRagPipeline } from "../../src/lib/pipeline";
import { checkMustInclude, judgeCorrectness, scoreRetrieval } from "./judge";
import type {
  Aggregate,
  CaseResult,
  GoldenCase,
  RunConfig,
  RunReport,
} from "./types";
import { ensureCorpusIndexed, loadFilenameMapFor } from "./workspace";

export type RunOptions = {
  apiKey: string;
  cases: GoldenCase[];
  limit?: number;
  force?: boolean;
  persist?: boolean;
  onProgress?: (message: string) => void;
};

export async function runEval(
  config: RunConfig,
  options: RunOptions,
): Promise<RunReport> {
  const report = options.onProgress ?? (() => {});
  const startedAt = new Date().toISOString();

  const index = await ensureCorpusIndexed({
    strategy: config.strategy,
    apiKey: options.apiKey,
    embeddingModel: config.embeddingModel,
    force: options.force,
    onProgress: report,
  });

  const filenameByDoc = await loadFilenameMapFor(index.workspaceId);
  const cases = options.limit
    ? options.cases.slice(0, options.limit)
    : options.cases;

  report(
    `Running ${cases.length} cases · ${config.strategy} chunking · ${config.mode} retrieval · topK ${config.topK}`,
  );

  const results = await mapWithConcurrency(
    cases,
    config.concurrency,
    async (goldenCase, position) => {
      const result = await runCase({
        goldenCase,
        config,
        apiKey: options.apiKey,
        workspaceId: index.workspaceId,
        filenameByDoc,
      });
      report(
        `  [${position + 1}/${cases.length}] ${goldenCase.id} ${goldenCase.type} · correctness ${result.correctness} · ${result.durationMs}ms`,
      );
      return result;
    },
  );

  const aggregate = aggregateResults(results);
  const finishedAt = new Date().toISOString();
  const runReport: RunReport = {
    startedAt,
    finishedAt,
    config,
    index: {
      workspaceId: index.workspaceId,
      documents: index.documents,
      chunks: index.chunks,
      reused: index.reused,
    },
    aggregate,
    results,
  };

  if (options.persist !== false) {
    await persistRun(runReport);
  }

  return runReport;
}

async function runCase(options: {
  goldenCase: GoldenCase;
  config: RunConfig;
  apiKey: string;
  workspaceId: string;
  filenameByDoc: Map<string, string>;
}): Promise<CaseResult> {
  const { goldenCase, config } = options;
  const startedAt = Date.now();

  const base: CaseResult = {
    id: goldenCase.id,
    type: goldenCase.type,
    question: goldenCase.question,
    answer: "",
    abstained: false,
    correctness: 0,
    correctnessReason: "",
    faithfulness: null,
    citationAccuracy: null,
    retrievalHit: null,
    reciprocalRank: null,
    mustIncludeHit: null,
    abstainCorrect: false,
    confidence: 0,
    confidenceBand: "low",
    retrievedSources: [],
    totalClaims: 0,
    unsupportedClaims: 0,
    miscitedClaims: 0,
    invalidCitations: [],
    durationMs: 0,
  };

  try {
    const result = await runRagPipeline({
      question: goldenCase.question,
      guestId: options.workspaceId,
      apiKey: options.apiKey,
      filenameByDoc: options.filenameByDoc,
      documentIds: null,
      chatModel: config.chatModel,
      embeddingModel: config.embeddingModel,
      temperature: 0,
      topK: config.topK,
      rerank: config.rerank,
      retrievalMode: config.mode,
      denseWeight: config.denseWeight,
      sparseWeight: config.sparseWeight,
      verifyCitations: config.verifyCitations,
      abstainThreshold: config.abstainThreshold,
    });

    const retrievedSources = [
      ...new Set(result.sources.map((source) => source.filename)),
    ];

    const judged = await judgeCorrectness({
      goldenCase,
      answer: result.answer,
      abstained: result.abstained,
      apiKey: options.apiKey,
      model: config.judgeModel,
    });

    const { hit, reciprocalRank } = scoreRetrieval(
      result.sources.map((source) => source.filename),
      goldenCase.expectedSources,
    );

    const citations = result.citations;
    const faithfulness =
      citations.verified && citations.totalClaims
        ? citations.groundedClaims / citations.totalClaims
        : null;
    const citationAccuracy =
      citations.verified && citations.citedClaims
        ? citations.supportedClaims / citations.citedClaims
        : null;

    return {
      ...base,
      answer: result.answer,
      abstained: result.abstained,
      correctness: judged.score,
      correctnessReason: judged.reason,
      faithfulness: result.abstained ? null : faithfulness,
      citationAccuracy: result.abstained ? null : citationAccuracy,
      retrievalHit: hit,
      reciprocalRank,
      mustIncludeHit: result.abstained
        ? null
        : checkMustInclude(result.answer, goldenCase.mustInclude),
      abstainCorrect: scoreAbstain(goldenCase, result.abstained),
      confidence: result.confidence.score,
      confidenceBand: result.confidence.band,
      retrievedSources,
      totalClaims: citations.totalClaims,
      unsupportedClaims: citations.unsupportedClaims,
      miscitedClaims: citations.miscitedClaims,
      invalidCitations: citations.invalidCitations,
      durationMs: Date.now() - startedAt,
    };
  } catch (error) {
    return {
      ...base,
      durationMs: Date.now() - startedAt,
      error: error instanceof Error ? error.message : "Unknown failure",
    };
  }
}

/**
 * The gate should fire on unanswerable questions and stay quiet on answerable
 * ones. Both directions are failures worth measuring.
 */
function scoreAbstain(goldenCase: GoldenCase, abstained: boolean) {
  if (goldenCase.expectAbstain) return abstained;
  return !abstained;
}

export function aggregateResults(results: CaseResult[]): Aggregate {
  const mean = (values: Array<number | null>) => {
    const present = values.filter((v): v is number => typeof v === "number");
    if (!present.length) return 0;
    return round(present.reduce((a, b) => a + b, 0) / present.length);
  };

  const byType: Aggregate["byType"] = {};
  for (const result of results) {
    const bucket = (byType[result.type] ??= {
      cases: 0,
      correctness: 0,
      retrievalRecall: 0,
    });
    bucket.cases += 1;
  }
  for (const type of Object.keys(byType)) {
    const subset = results.filter((r) => r.type === type);
    byType[type].correctness = mean(subset.map((r) => r.correctness));
    byType[type].retrievalRecall = mean(
      subset.map((r) => (r.retrievalHit === null ? null : r.retrievalHit ? 1 : 0)),
    );
  }

  return {
    cases: results.length,
    correctness: mean(results.map((r) => r.correctness)),
    faithfulness: mean(results.map((r) => r.faithfulness)),
    citationAccuracy: mean(results.map((r) => r.citationAccuracy)),
    retrievalRecall: mean(
      results.map((r) => (r.retrievalHit === null ? null : r.retrievalHit ? 1 : 0)),
    ),
    retrievalMrr: mean(results.map((r) => r.reciprocalRank)),
    mustIncludeRate: mean(
      results.map((r) =>
        r.mustIncludeHit === null ? null : r.mustIncludeHit ? 1 : 0,
      ),
    ),
    abstainAccuracy: mean(results.map((r) => (r.abstainCorrect ? 1 : 0))),
    meanConfidence: mean(results.map((r) => r.confidence)),
    meanLatencyMs: Math.round(mean(results.map((r) => r.durationMs))),
    byType,
  };
}

async function persistRun(report: RunReport) {
  try {
    const db = getDb();
    await db.insert(evalRuns).values({
      label: report.config.label,
      chunkStrategy: report.config.strategy,
      retrievalMode: report.config.mode,
      caseCount: report.aggregate.cases,
      correctness: report.aggregate.correctness,
      faithfulness: report.aggregate.faithfulness,
      retrievalRecall: report.aggregate.retrievalRecall,
      citationAccuracy: report.aggregate.citationAccuracy,
      report: report.aggregate,
    });
  } catch (error) {
    console.warn("Could not persist eval run:", error);
  }
}

async function mapWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  worker: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let cursor = 0;

  const runners = Array.from(
    { length: Math.max(1, Math.min(concurrency, items.length)) },
    async () => {
      while (cursor < items.length) {
        const index = cursor++;
        results[index] = await worker(items[index], index);
      }
    },
  );

  await Promise.all(runners);
  return results;
}

function round(value: number) {
  return Math.round(value * 1000) / 1000;
}
