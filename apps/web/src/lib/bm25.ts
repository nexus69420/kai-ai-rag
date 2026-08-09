import { and, eq } from "drizzle-orm";

import { getDb } from "./db";
import { chunks } from "./db/schema";

const K1 = 1.5;
const B = 0.75;
/** Safety valve so a huge workspace cannot exhaust memory on a cold start. */
const MAX_INDEXED_CHUNKS = 20_000;
const INDEX_TTL_MS = 5 * 60 * 1000;

const STOPWORDS = new Set([
  "a", "an", "and", "are", "as", "at", "be", "but", "by", "can", "did", "do",
  "does", "for", "from", "had", "has", "have", "how", "i", "if", "in", "into",
  "is", "it", "its", "of", "on", "or", "our", "that", "the", "their",
  "then", "there", "these", "they", "this", "to", "was", "were", "what", "when",
  "where", "which", "who", "why", "will", "with", "you", "your",
]);

export type SparseDoc = {
  id: string;
  documentId: string;
  page: number;
  chunkIndex: number;
  heading: string | null;
  text: string;
};

export type SparseHit = {
  id: string;
  score: number;
  doc: SparseDoc;
  matchedTerms: string[];
};

/**
 * Splits on non-identifier characters but keeps dotted/underscored/hyphenated
 * identifiers whole, then also emits their parts. Technical docs live and die
 * on exact matches for things like `KAI_PDF_STORAGE`, `db.apply`, or `E1042`.
 *
 * Set `expand: false` to get only the whole tokens. Sub-token expansion helps
 * recall during search, but it would inflate any measure of how much of a
 * query the corpus actually covers.
 */
export function tokenize(text: string, options = { expand: true }): string[] {
  const lowered = String(text ?? "").toLowerCase();
  const raw = lowered.match(/[a-z0-9][a-z0-9_./-]*[a-z0-9]|[a-z0-9]+/g) ?? [];
  const out: string[] = [];

  for (const token of raw) {
    const normalized = normalizeToken(token);
    if (normalized) out.push(normalized);

    if (options.expand && /[._/-]/.test(token)) {
      for (const part of token.split(/[._/-]+/)) {
        const sub = normalizeToken(part);
        if (sub && sub !== normalized) out.push(sub);
      }
    }
  }

  return out;
}

function normalizeToken(token: string): string | null {
  if (!token) return null;
  if (token.length === 1 && !/[0-9]/.test(token)) return null;
  if (STOPWORDS.has(token)) return null;
  return conservativeStem(token);
}

/** Plural-only stemming: aggressive stemmers wreck identifiers. */
export function conservativeStem(token: string): string {
  if (token.length <= 3) return token;
  if (/[._/-]/.test(token)) return token;
  if (/(ss|us|is|as|os)$/.test(token)) return token;
  if (/ies$/.test(token)) return `${token.slice(0, -3)}y`;
  if (/(ches|shes|xes|ses|zes)$/.test(token)) return token.slice(0, -2);
  if (/s$/.test(token)) return token.slice(0, -1);
  return token;
}

export class Bm25Index {
  private readonly docs = new Map<string, SparseDoc>();
  private readonly lengths = new Map<string, number>();
  private readonly postings = new Map<string, Map<string, number>>();
  private averageLength = 0;

  constructor(docs: SparseDoc[]) {
    let totalLength = 0;

    for (const doc of docs) {
      const tokens = tokenize(`${doc.heading ? `${doc.heading} ` : ""}${doc.text}`);
      if (!tokens.length) continue;

      this.docs.set(doc.id, doc);
      this.lengths.set(doc.id, tokens.length);
      totalLength += tokens.length;

      const seen = new Map<string, number>();
      for (const token of tokens) {
        seen.set(token, (seen.get(token) ?? 0) + 1);
      }
      for (const [token, frequency] of seen) {
        let posting = this.postings.get(token);
        if (!posting) {
          posting = new Map();
          this.postings.set(token, posting);
        }
        posting.set(doc.id, frequency);
      }
    }

    this.averageLength = this.docs.size ? totalLength / this.docs.size : 0;
  }

  get size() {
    return this.docs.size;
  }

  search(
    query: string,
    options: { limit: number; documentIds?: string[] | null } = { limit: 10 },
  ): SparseHit[] {
    if (!this.docs.size) return [];

    const queryTokens = [...new Set(tokenize(query))];
    if (!queryTokens.length) return [];

    const scope = options.documentIds?.length
      ? new Set(options.documentIds)
      : null;
    const totalDocs = this.docs.size;
    const scores = new Map<string, { score: number; terms: Set<string> }>();

    for (const token of queryTokens) {
      const posting = this.postings.get(token);
      if (!posting) continue;

      const df = posting.size;
      const idf = Math.log(1 + (totalDocs - df + 0.5) / (df + 0.5));

      for (const [docId, frequency] of posting) {
        const doc = this.docs.get(docId);
        if (!doc) continue;
        if (scope && !scope.has(doc.documentId)) continue;

        const length = this.lengths.get(docId) ?? 0;
        const norm = this.averageLength
          ? 1 - B + B * (length / this.averageLength)
          : 1;
        const contribution =
          idf * ((frequency * (K1 + 1)) / (frequency + K1 * norm));

        const entry = scores.get(docId) ?? { score: 0, terms: new Set<string>() };
        entry.score += contribution;
        entry.terms.add(token);
        scores.set(docId, entry);
      }
    }

    return [...scores.entries()]
      .map(([id, entry]) => ({
        id,
        score: entry.score,
        doc: this.docs.get(id)!,
        matchedTerms: [...entry.terms],
      }))
      .sort((a, b) => b.score - a.score)
      .slice(0, options.limit);
  }

  /**
   * Share of the query's whole terms that appear anywhere in the scoped corpus.
   * Sub-token expansions are excluded: a query for `HALOGEN_BATCH_SIZE` against
   * a corpus that only mentions `size` has not been covered.
   */
  termCoverage(query: string, documentIds?: string[] | null): number {
    const queryTokens = [...new Set(tokenize(query, { expand: false }))];
    if (!queryTokens.length) return 0;
    const scope = scopeSet(documentIds);

    let found = 0;
    for (const token of queryTokens) {
      const posting = this.postings.get(token);
      if (!posting) continue;
      if (!scope) {
        found += 1;
        continue;
      }
      for (const docId of posting.keys()) {
        const doc = this.docs.get(docId);
        if (doc && scope.has(doc.documentId)) {
          found += 1;
          break;
        }
      }
    }

    return found / queryTokens.length;
  }
}

function scopeSet(documentIds?: string[] | null) {
  return documentIds?.length ? new Set(documentIds) : null;
}

type CacheEntry = { index: Bm25Index; builtAt: number };

const globalForSparse = globalThis as unknown as {
  kaiSparseCache?: Map<string, CacheEntry>;
};

function cache() {
  if (!globalForSparse.kaiSparseCache) {
    globalForSparse.kaiSparseCache = new Map();
  }
  return globalForSparse.kaiSparseCache;
}

/** Call after any ingest, reindex, or delete so sparse stays in sync with dense. */
export function invalidateSparseIndex(guestId: string) {
  cache().delete(guestId);
}

export async function getSparseIndex(guestId: string): Promise<Bm25Index> {
  const cached = cache().get(guestId);
  if (cached && Date.now() - cached.builtAt < INDEX_TTL_MS) {
    return cached.index;
  }

  const db = getDb();
  const rows = await db
    .select({
      id: chunks.id,
      documentId: chunks.documentId,
      page: chunks.page,
      chunkIndex: chunks.chunkIndex,
      heading: chunks.heading,
      text: chunks.text,
    })
    .from(chunks)
    .where(and(eq(chunks.guestId, guestId)))
    .limit(MAX_INDEXED_CHUNKS);

  const index = new Bm25Index(rows);
  cache().set(guestId, { index, builtAt: Date.now() });
  return index;
}
