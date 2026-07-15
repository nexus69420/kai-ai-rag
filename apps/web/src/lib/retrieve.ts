import MiniSearch from "minisearch";
import { and, asc, eq, inArray } from "drizzle-orm";

import { getDb } from "./db";
import { chunks } from "./db/schema";
import type { SourcePayload } from "./db/schema";
import { denseSearch } from "./qdrant";
import { embedQuery } from "./gemini";
import { rerankCandidates } from "./rerank";

type Retrieved = SourcePayload & { id: string; chunkIndex?: number };

function reciprocalRankFusion(
  rankedLists: Retrieved[][],
  limit: number,
): Retrieved[] {
  const scores = new Map<string, { item: Retrieved; score: number }>();
  const k = 60;

  rankedLists.forEach((list) => {
    list.forEach((item, index) => {
      const add = 1 / (k + index + 1);
      const existing = scores.get(item.id);
      if (existing) {
        existing.score += add;
      } else {
        scores.set(item.id, { item, score: add });
      }
    });
  });

  return [...scores.values()]
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map(({ item, score }) => ({ ...item, score }));
}

async function keywordSearch(options: {
  query: string;
  guestId: string;
  documentId?: string | null;
  documentIds?: string[] | null;
  limit: number;
}): Promise<Retrieved[]> {
  const db = getDb();
  const ids =
    options.documentIds?.filter(Boolean) ??
    (options.documentId ? [options.documentId] : []);
  const conditions = [eq(chunks.guestId, options.guestId)];
  if (ids.length === 1) {
    conditions.push(eq(chunks.documentId, ids[0]));
  } else if (ids.length > 1) {
    conditions.push(inArray(chunks.documentId, ids));
  }

  const rows = await db
    .select()
    .from(chunks)
    .where(and(...conditions))
    .limit(500);

  if (!rows.length) return [];

  const mini = new MiniSearch({
    fields: ["text"],
    storeFields: ["text", "page", "documentId", "filename", "id"],
    searchOptions: { boost: { text: 2 }, fuzzy: 0.15 },
  });

  const docs = rows.map((row) => ({
    id: row.id,
    text: row.text,
    page: row.page,
    documentId: row.documentId,
    filename: "",
  }));

  // Attach filenames via a second lightweight query map if needed — filled by caller maps
  mini.addAll(docs);
  const hits = mini.search(options.query, { prefix: true }).slice(0, options.limit);

  const idSet = hits.map((h) => String(h.id));
  if (!idSet.length) {
    // fallback: naive includes
    const terms = options.query.toLowerCase().split(/\s+/).filter(Boolean);
    return rows
      .map((row) => {
        const hay = row.text.toLowerCase();
        const score = terms.reduce((acc, t) => acc + (hay.includes(t) ? 1 : 0), 0);
        return { row, score };
      })
      .filter((x) => x.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, options.limit)
      .map(({ row, score }) => ({
        id: row.id,
        text: row.text,
        page: row.page,
        documentId: row.documentId,
        filename: "",
        score,
      }));
  }

  const byId = new Map(rows.map((r) => [r.id, r]));
  return hits
    .map((hit) => {
      const row = byId.get(String(hit.id));
      if (!row) return null;
      return {
        id: row.id,
        text: row.text,
        page: row.page,
        documentId: row.documentId,
        filename: "",
        score: hit.score,
      } satisfies Retrieved;
    })
    .filter(Boolean) as Retrieved[];
}

export async function hybridRetrieve(options: {
  query: string;
  guestId: string;
  documentId?: string | null;
  documentIds?: string[] | null;
  apiKey: string;
  embeddingModel?: string;
  topK: number;
  filenameByDoc: Map<string, string>;
  /** Pull a wider pool before Gemini/lexical rerank (default topK * 3, min 12). */
  candidatePool?: number;
  /** Set false to skip LLM rerank (still uses RRF). Default true. */
  rerank?: boolean;
  rerankModel?: string;
}): Promise<SourcePayload[]> {
  const denseLimit = Math.max(options.topK * 3, 12);
  const poolSize = options.candidatePool ?? denseLimit;
  const scopeIds =
    options.documentIds?.filter(Boolean) ??
    (options.documentId ? [options.documentId] : null);
  const queryVector = await embedQuery(options.query, {
    apiKey: options.apiKey,
    model: options.embeddingModel,
  });

  const densePoints = await denseSearch({
    vector: queryVector,
    guestId: options.guestId,
    documentIds: scopeIds,
    limit: denseLimit,
  });

  const dense: Retrieved[] = densePoints.map((point) => {
    const payload = (point.payload ?? {}) as Record<string, unknown>;
    const documentId = String(payload.document_id ?? "");
    return {
      id: String(point.id),
      text: String(payload.text ?? ""),
      page: Number(payload.page ?? 1),
      documentId,
      filename:
        String(payload.filename ?? "") ||
        options.filenameByDoc.get(documentId) ||
        "document.pdf",
      score: point.score,
    };
  });

  const keyword = await keywordSearch({
    query: options.query,
    guestId: options.guestId,
    documentIds: scopeIds,
    limit: denseLimit,
  });

  const keywordWithNames = keyword.map((item) => ({
    ...item,
    filename:
      item.filename ||
      options.filenameByDoc.get(item.documentId) ||
      "document.pdf",
  }));

  let fused = reciprocalRankFusion([dense, keywordWithNames], poolSize);

  if (!fused.length && dense.length) {
    fused = dense.slice(0, poolSize);
  }

  // Rerank the hybrid shortlist, then expand neighbors around the best hits.
  let selected: Retrieved[];
  if (options.rerank !== false && fused.length > 1) {
    const reranked = await rerankCandidates({
      query: options.query,
      candidates: fused,
      apiKey: options.apiKey,
      topK: options.topK,
      model: options.rerankModel ?? "gemini-2.5-flash",
    });
    const byId = new Map(fused.map((f) => [f.id, f]));
    selected = reranked.map((item, index) => {
      const original =
        (item.id ? byId.get(item.id) : undefined) ??
        fused.find(
          (f) =>
            f.text === item.text &&
            f.page === item.page &&
            f.documentId === item.documentId,
        ) ??
        fused[index];
      return {
        id: original?.id ?? item.id ?? `rerank-${index}`,
        text: item.text,
        page: item.page,
        documentId: item.documentId,
        filename: item.filename,
        score: item.score,
        chunkIndex: original?.chunkIndex,
      };
    });
  } else {
    selected = fused.slice(0, options.topK);
  }

  const expanded = await expandWithNeighbors(selected, options.topK + 4);
  return expanded.map(({ id: _id, chunkIndex: _ci, ...rest }) => rest);
}

/**
 * Lecture slides often index as title-only hits. Pull ±2 neighbors by chunk_index
 * (and same-page siblings) so the LLM gets bullets/formulas around the heading.
 */
async function expandWithNeighbors(
  hits: Retrieved[],
  limit: number,
): Promise<Retrieved[]> {
  if (!hits.length) return hits;
  const db = getDb();
  const byKey = new Map<string, Retrieved>();
  const docIds = [...new Set(hits.map((h) => h.documentId))];

  const allRows =
    docIds.length === 0
      ? []
      : await db
          .select()
          .from(chunks)
          .where(inArray(chunks.documentId, docIds))
          .orderBy(asc(chunks.chunkIndex));

  const byDoc = new Map<string, typeof allRows>();
  for (const row of allRows) {
    const list = byDoc.get(row.documentId) ?? [];
    list.push(row);
    byDoc.set(row.documentId, list);
  }

  for (const hit of hits) {
    byKey.set(hit.id, hit);
    const neighbors = byDoc.get(hit.documentId) ?? [];
    const center =
      neighbors.find((row) => row.id === hit.id) ??
      neighbors.find((row) => row.page === hit.page);

    if (!center) continue;

    for (const row of neighbors) {
      const nearIndex = Math.abs(row.chunkIndex - center.chunkIndex) <= 2;
      const nearPage = Math.abs(row.page - center.page) <= 1;
      if (!nearIndex && !nearPage) continue;
      if (byKey.has(row.id)) continue;
      byKey.set(row.id, {
        id: row.id,
        text: row.text,
        page: row.page,
        documentId: row.documentId,
        filename: hit.filename,
        chunkIndex: row.chunkIndex,
        score: hit.score,
      });
    }
  }

  const hitIds = new Set(hits.map((h) => h.id));
  const originals = hits.filter((h) => byKey.has(h.id));
  const extras = [...byKey.values()]
    .filter((h) => !hitIds.has(h.id))
    .sort(
      (a, b) => a.page - b.page || (a.chunkIndex ?? 0) - (b.chunkIndex ?? 0),
    );

  const merged = [...originals, ...extras].slice(0, limit);

  return merged.map((item) => {
    if (item.text.length >= 200) return item;
    const sameDoc = merged
      .filter((m) => m.documentId === item.documentId)
      .filter((m) => Math.abs(m.page - item.page) <= 1)
      .sort(
        (a, b) => a.page - b.page || (a.chunkIndex ?? 0) - (b.chunkIndex ?? 0),
      );
    if (sameDoc.length <= 1) return item;
    const stitched = [...new Set(sameDoc.map((m) => m.text))].join("\n\n");
    return { ...item, text: stitched };
  });
}

export async function loadFilenameMap(
  guestId: string,
  documentIds: string[],
) {
  const map = new Map<string, string>();
  if (!documentIds.length) return map;
  const db = getDb();
  const { documents } = await import("./db/schema");
  const rows = await db
    .select()
    .from(documents)
    .where(
      and(
        eq(documents.guestId, guestId),
        inArray(documents.id, documentIds),
      ),
    );
  for (const row of rows) {
    map.set(row.id, row.filename);
  }
  return map;
}
