import { and, eq, gte, inArray, lte, or, type SQL } from "drizzle-orm";

import { getSparseIndex } from "./bm25";
import { getDb } from "./db";
import { chunks, documents } from "./db/schema";
import type { RetrievalStats, SourcePayload } from "./db/schema";
import { embedQuery } from "./gemini";
import { denseSearch } from "./qdrant";
import { rerankCandidates, type RerankOutcome } from "./rerank";
import type { RetrievalMode } from "./retrieval-modes";

export { RETRIEVAL_MODES, isRetrievalMode } from "./retrieval-modes";
export type { RetrievalMode } from "./retrieval-modes";

/** Rank-fusion constant from the original RRF paper. */
const RRF_K = 60;
const NEIGHBOR_RADIUS = 2;

export type Candidate = SourcePayload & {
  id: string;
  chunkIndex: number;
  denseRank?: number;
  sparseRank?: number;
  fusedScore?: number;
};

export type RetrieveResult = {
  /** Final passages, numbered for `[n]` citation. */
  sources: SourcePayload[];
  /** Full fused pool before rerank — powers the retrieval comparison view. */
  candidates: SourcePayload[];
  stats: RetrievalStats;
};

export type RetrieveOptions = {
  query: string;
  guestId: string;
  apiKey: string;
  topK: number;
  filenameByDoc: Map<string, string>;
  documentIds?: string[] | null;
  documentId?: string | null;
  embeddingModel?: string;
  mode?: RetrievalMode;
  /** Relative pull of dense vs sparse in the fusion step. Normalized to 1. */
  denseWeight?: number;
  sparseWeight?: number;
  /** Candidates fused before rerank. Defaults to 20 per the guide. */
  candidatePool?: number;
  rerank?: boolean;
  rerankModel?: string;
  /** Pull adjacent chunks around each hit so headings carry their body text. */
  expandNeighbors?: boolean;
};

export async function hybridRetrieve(
  options: RetrieveOptions,
): Promise<RetrieveResult> {
  const startedAt = Date.now();
  const mode = options.mode ?? "hybrid";
  const topK = options.topK;
  const poolSize = options.candidatePool ?? Math.max(20, topK * 3);
  const perListLimit = Math.max(poolSize, 10);

  const { denseWeight, sparseWeight } = normalizeWeights(
    mode,
    options.denseWeight,
    options.sparseWeight,
  );

  const scopeIds =
    options.documentIds?.filter(Boolean) ??
    (options.documentId ? [options.documentId] : null);

  const [dense, sparse] = await Promise.all([
    mode === "sparse"
      ? Promise.resolve([] as Candidate[])
      : denseCandidates(options, scopeIds, perListLimit),
    mode === "dense"
      ? Promise.resolve([] as Candidate[])
      : sparseCandidates(options, scopeIds, perListLimit),
  ]);

  const sparseIndex = await getSparseIndex(options.guestId);
  const keywordCoverage = sparseIndex.termCoverage(options.query, scopeIds);

  let fused =
    mode === "hybrid"
      ? weightedRrf(
          [
            { list: dense, weight: denseWeight, label: "dense" as const },
            { list: sparse, weight: sparseWeight, label: "sparse" as const },
          ],
          poolSize,
        )
      : (mode === "dense" ? dense : sparse).slice(0, poolSize);

  if (!fused.length && dense.length) fused = dense.slice(0, poolSize);

  let rerankOutcome: RerankOutcome<Candidate> = {
    candidates: fused.slice(0, topK),
    backend: "none",
  };

  if (options.rerank !== false && fused.length > 1) {
    rerankOutcome = await rerankCandidates({
      query: options.query,
      candidates: fused,
      apiKey: options.apiKey,
      topK,
      model: options.rerankModel,
    });
  }

  const primary = rerankOutcome.candidates.slice(0, topK);
  const neighbours =
    options.expandNeighbors === false
      ? []
      : await fetchNeighbours(primary, options.filenameByDoc, topK);

  const ordered = [...primary, ...neighbours];
  const sources = ordered.map((candidate, index) => toSource(candidate, index + 1));

  const rerankScores = primary
    .map((c) => c.rerankScore)
    .filter((s): s is number => typeof s === "number");

  const stats: RetrievalStats = {
    mode,
    denseWeight,
    sparseWeight,
    denseHits: dense.length,
    sparseHits: sparse.length,
    fusedCandidates: fused.length,
    rerankUsed: rerankOutcome.backend !== "none",
    rerankBackend: rerankOutcome.backend,
    topDenseScore: round(Math.max(0, ...dense.map((d) => d.denseScore ?? 0), 0)),
    meanRerankScore: rerankScores.length
      ? round(rerankScores.reduce((a, b) => a + b, 0) / rerankScores.length)
      : null,
    keywordCoverage: round(keywordCoverage),
    documentsSearched: scopeIds?.length ?? options.filenameByDoc.size,
    passagesReturned: sources.length,
    durationMs: Date.now() - startedAt,
  };

  return {
    sources,
    candidates: fused.map((candidate, index) => toSource(candidate, index + 1)),
    stats,
  };
}

export function normalizeWeights(
  mode: RetrievalMode,
  dense?: number,
  sparse?: number,
) {
  if (mode === "dense") return { denseWeight: 1, sparseWeight: 0 };
  if (mode === "sparse") return { denseWeight: 0, sparseWeight: 1 };

  const d = Number.isFinite(dense) ? Math.max(0, dense!) : 0.7;
  const s = Number.isFinite(sparse) ? Math.max(0, sparse!) : 0.3;
  const total = d + s;
  if (!total) return { denseWeight: 0.5, sparseWeight: 0.5 };
  return { denseWeight: round(d / total), sparseWeight: round(s / total) };
}

/**
 * Weighted Reciprocal Rank Fusion. Each list contributes
 * `weight / (k + rank)`, so a document ranked highly by either retriever
 * surfaces, while documents ranked by both dominate.
 */
export function weightedRrf(
  lists: Array<{
    list: Candidate[];
    weight: number;
    label: "dense" | "sparse";
  }>,
  limit: number,
): Candidate[] {
  const merged = new Map<string, Candidate & { fusedScore: number }>();

  for (const { list, weight, label } of lists) {
    if (!weight) continue;

    list.forEach((item, index) => {
      const contribution = weight / (RRF_K + index + 1);
      const existing = merged.get(item.id);

      if (existing) {
        existing.fusedScore += contribution;
        existing.retrievedBy = [
          ...new Set([...(existing.retrievedBy ?? []), label]),
        ];
        if (label === "dense") {
          existing.denseScore = item.denseScore;
          existing.denseRank = index + 1;
        } else {
          existing.sparseScore = item.sparseScore;
          existing.sparseRank = index + 1;
        }
        return;
      }

      merged.set(item.id, {
        ...item,
        fusedScore: contribution,
        retrievedBy: [label],
        denseRank: label === "dense" ? index + 1 : undefined,
        sparseRank: label === "sparse" ? index + 1 : undefined,
      });
    });
  }

  return [...merged.values()]
    .sort((a, b) => b.fusedScore - a.fusedScore)
    .slice(0, limit)
    .map((item) => ({ ...item, score: round(item.fusedScore) }));
}

async function denseCandidates(
  options: RetrieveOptions,
  scopeIds: string[] | null,
  limit: number,
): Promise<Candidate[]> {
  const vector = await embedQuery(options.query, {
    apiKey: options.apiKey,
    model: options.embeddingModel,
  });

  const points = await denseSearch({
    vector,
    guestId: options.guestId,
    documentIds: scopeIds,
    limit,
  });

  return points.map((point) => {
    const payload = (point.payload ?? {}) as Record<string, unknown>;
    const documentId = String(payload.document_id ?? "");
    const score = Number(point.score ?? 0);
    return {
      id: String(point.id),
      chunkId: String(point.id),
      text: String(payload.text ?? ""),
      page: Number(payload.page ?? 1),
      chunkIndex: Number(payload.chunk_index ?? 0),
      heading: (payload.heading as string | null) ?? null,
      documentId,
      filename:
        String(payload.filename ?? "") ||
        options.filenameByDoc.get(documentId) ||
        "document",
      denseScore: round(score),
      score: round(score),
      retrievedBy: ["dense"],
    } satisfies Candidate;
  });
}

async function sparseCandidates(
  options: RetrieveOptions,
  scopeIds: string[] | null,
  limit: number,
): Promise<Candidate[]> {
  const index = await getSparseIndex(options.guestId);
  const hits = index.search(options.query, { limit, documentIds: scopeIds });

  return hits.map((hit) => ({
    id: hit.id,
    chunkId: hit.id,
    text: hit.doc.text,
    page: hit.doc.page,
    chunkIndex: hit.doc.chunkIndex,
    heading: hit.doc.heading,
    documentId: hit.doc.documentId,
    filename: options.filenameByDoc.get(hit.doc.documentId) ?? "document",
    sparseScore: round(hit.score),
    score: round(hit.score),
    retrievedBy: ["sparse"],
  }));
}

/**
 * Headings and slide titles frequently win retrieval while the actual answer
 * sits in the next chunk, so pull a small window of neighbours around each hit.
 */
async function fetchNeighbours(
  primary: Candidate[],
  filenameByDoc: Map<string, string>,
  topK: number,
): Promise<Candidate[]> {
  if (!primary.length) return [];

  const budget = Math.max(2, Math.ceil(topK / 2));
  const db = getDb();
  const seen = new Set(primary.map((p) => p.id));

  const ranges: SQL[] = [];
  for (const hit of primary) {
    ranges.push(
      and(
        eq(chunks.documentId, hit.documentId),
        gte(chunks.chunkIndex, hit.chunkIndex - NEIGHBOR_RADIUS),
        lte(chunks.chunkIndex, hit.chunkIndex + NEIGHBOR_RADIUS),
      )!,
    );
  }

  const rows = await db
    .select()
    .from(chunks)
    .where(ranges.length === 1 ? ranges[0] : or(...ranges))
    .limit(primary.length * (NEIGHBOR_RADIUS * 2 + 1));

  const rankById = new Map(primary.map((p, index) => [p.id, index]));
  const anchorFor = (row: (typeof rows)[number]) =>
    primary.find(
      (p) =>
        p.documentId === row.documentId &&
        Math.abs(p.chunkIndex - row.chunkIndex) <= NEIGHBOR_RADIUS,
    );

  // Neighbours inherit their anchor's rank so the best hit's context wins the
  // remaining budget before a weaker hit's context gets any.
  const UNRANKED = Number.MAX_SAFE_INTEGER;
  const rankOf = (row: (typeof rows)[number]) => {
    const anchor = anchorFor(row);
    return anchor ? (rankById.get(anchor.id) ?? UNRANKED) : UNRANKED;
  };

  return rows
    .filter((row) => !seen.has(row.id))
    .sort(
      (a, b) =>
        rankOf(a) - rankOf(b) || a.page - b.page || a.chunkIndex - b.chunkIndex,
    )
    .slice(0, budget)
    .map((row) => ({
      id: row.id,
      chunkId: row.id,
      text: row.text,
      page: row.page,
      chunkIndex: row.chunkIndex,
      heading: row.heading,
      documentId: row.documentId,
      filename: filenameByDoc.get(row.documentId) ?? "document",
      score: anchorFor(row)?.score,
      retrievedBy: ["neighbor"] as Array<"dense" | "sparse" | "neighbor">,
    }));
}

function toSource(candidate: Candidate, citation: number): SourcePayload {
  return {
    citation,
    chunkId: candidate.chunkId ?? candidate.id,
    text: candidate.text,
    page: candidate.page,
    heading: candidate.heading ?? null,
    filename: candidate.filename,
    documentId: candidate.documentId,
    score: candidate.score,
    denseScore: candidate.denseScore,
    sparseScore: candidate.sparseScore,
    rerankScore: candidate.rerankScore,
    retrievedBy: candidate.retrievedBy,
  };
}

function round(value: number) {
  return Math.round(value * 1000) / 1000;
}

export async function loadFilenameMap(guestId: string, documentIds: string[]) {
  const map = new Map<string, string>();
  if (!documentIds.length) return map;

  const db = getDb();
  const rows = await db
    .select()
    .from(documents)
    .where(
      and(eq(documents.guestId, guestId), inArray(documents.id, documentIds)),
    );

  for (const row of rows) map.set(row.id, row.filename);
  return map;
}
