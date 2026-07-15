import { mkdirSync, readFileSync, writeFileSync, existsSync } from "fs";
import path from "path";

import { QdrantClient } from "@qdrant/js-client-rest";

export const COLLECTION_NAME =
  process.env.QDRANT_COLLECTION ?? "kai_pdf_chunks_v1";

export const EMBEDDING_DIM = 768;

export type ChunkPayload = {
  text: string;
  document_id: string;
  guest_id: string;
  filename: string;
  page: number;
  chunk_index: number;
};

type StoredPoint = {
  id: string;
  vector: number[];
  payload: ChunkPayload;
};

const globalForQdrant = globalThis as unknown as {
  kaiQdrant?: QdrantClient;
  kaiLocalVectors?: Map<string, StoredPoint>;
};

function useLocalVectors() {
  const url = process.env.QDRANT_URL ?? "local";
  return url === "local" || url === "memory" || url.startsWith("local:");
}

function localPath() {
  const dir = path.join(process.cwd(), ".data");
  mkdirSync(dir, { recursive: true });
  return path.join(dir, "vectors.json");
}

function loadLocal(): Map<string, StoredPoint> {
  if (globalForQdrant.kaiLocalVectors) return globalForQdrant.kaiLocalVectors;
  const map = new Map<string, StoredPoint>();
  const file = localPath();
  if (existsSync(file)) {
    const raw = JSON.parse(readFileSync(file, "utf8")) as StoredPoint[];
    for (const point of raw) map.set(point.id, point);
  }
  globalForQdrant.kaiLocalVectors = map;
  return map;
}

function saveLocal(map: Map<string, StoredPoint>) {
  writeFileSync(localPath(), JSON.stringify([...map.values()]));
}

function cosine(a: number[], b: number[]) {
  let dot = 0;
  let na = 0;
  let nb = 0;
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  if (!na || !nb) return 0;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

export function getQdrant() {
  if (!globalForQdrant.kaiQdrant) {
    const url = process.env.QDRANT_URL ?? "http://localhost:6333";
    const apiKey = process.env.QDRANT_API_KEY || undefined;
    globalForQdrant.kaiQdrant = new QdrantClient({ url, apiKey });
  }
  return globalForQdrant.kaiQdrant;
}

export async function ensureCollection() {
  if (useLocalVectors()) {
    loadLocal();
    return;
  }
  const client = getQdrant();
  const exists = await client.collectionExists(COLLECTION_NAME);
  if (!exists.exists) {
    await client.createCollection(COLLECTION_NAME, {
      vectors: { size: EMBEDDING_DIM, distance: "Cosine" },
    });
    await client.createPayloadIndex(COLLECTION_NAME, {
      field_name: "document_id",
      field_schema: "keyword",
    });
    await client.createPayloadIndex(COLLECTION_NAME, {
      field_name: "guest_id",
      field_schema: "keyword",
    });
  }
}

export async function upsertChunkVectors(
  points: Array<{ id: string; vector: number[]; payload: ChunkPayload }>,
) {
  await ensureCollection();
  if (useLocalVectors()) {
    const map = loadLocal();
    for (const point of points) {
      map.set(point.id, point);
    }
    saveLocal(map);
    return;
  }

  const client = getQdrant();
  await client.upsert(COLLECTION_NAME, {
    wait: true,
    points: points.map((p) => ({
      id: p.id,
      vector: p.vector,
      payload: p.payload,
    })),
  });
}

export async function deleteDocumentVectors(documentId: string) {
  if (useLocalVectors()) {
    const map = loadLocal();
    for (const [id, point] of map) {
      if (point.payload.document_id === documentId) map.delete(id);
    }
    saveLocal(map);
    return;
  }

  const client = getQdrant();
  const exists = await client.collectionExists(COLLECTION_NAME);
  if (!exists.exists) return;
  await client.delete(COLLECTION_NAME, {
    wait: true,
    filter: {
      must: [{ key: "document_id", match: { value: documentId } }],
    },
  });
}

export async function denseSearch(options: {
  vector: number[];
  guestId: string;
  documentId?: string | null;
  documentIds?: string[] | null;
  limit: number;
}) {
  await ensureCollection();
  const ids =
    options.documentIds?.filter(Boolean) ??
    (options.documentId ? [options.documentId] : []);

  if (useLocalVectors()) {
    const map = loadLocal();
    const scored = [...map.values()]
      .filter((p) => p.payload.guest_id === options.guestId)
      .filter((p) =>
        ids.length ? ids.includes(p.payload.document_id) : true,
      )
      .map((p) => ({
        id: p.id,
        score: cosine(options.vector, p.vector),
        payload: p.payload,
      }))
      .sort((a, b) => b.score - a.score)
      .slice(0, options.limit);
    return scored;
  }

  const client = getQdrant();
  const must: Array<Record<string, unknown>> = [
    { key: "guest_id", match: { value: options.guestId } },
  ];
  if (ids.length === 1) {
    must.push({ key: "document_id", match: { value: ids[0] } });
  } else if (ids.length > 1) {
    must.push({ key: "document_id", match: { any: ids } });
  }

  const result = await client.query(COLLECTION_NAME, {
    query: options.vector,
    limit: options.limit,
    with_payload: true,
    filter: { must },
  });

  return result.points ?? [];
}

export async function checkQdrantHealth() {
  try {
    if (useLocalVectors()) {
      const map = loadLocal();
      return {
        ok: true as const,
        backend: "local" as const,
        collection: COLLECTION_NAME,
        points: map.size,
      };
    }
    const client = getQdrant();
    const collections = await client.getCollections();
    const match = collections.collections.find((c) => c.name === COLLECTION_NAME);
    let points = 0;
    if (match) {
      const info = await client.getCollection(COLLECTION_NAME);
      points = info.points_count ?? 0;
    }
    return {
      ok: true as const,
      backend: "qdrant" as const,
      collection: COLLECTION_NAME,
      points,
    };
  } catch (error) {
    return {
      ok: false as const,
      backend: useLocalVectors() ? ("local" as const) : ("qdrant" as const),
      collection: COLLECTION_NAME,
      error: error instanceof Error ? error.message : "Qdrant unreachable",
    };
  }
}
