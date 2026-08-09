import {
  integer,
  jsonb,
  pgTable,
  real,
  text,
  timestamp,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";
import { randomUUID } from "crypto";

export const documents = pgTable("documents", {
  id: uuid("id")
    .primaryKey()
    .$defaultFn(() => randomUUID()),
  guestId: varchar("guest_id", { length: 64 }).notNull(),
  filename: text("filename").notNull(),
  chunkCount: integer("chunk_count").notNull().default(0),
  status: varchar("status", { length: 32 }).notNull().default("processing"),
  storagePath: text("storage_path"),
  /** Base64 original bytes for serverless (Vercel has no durable local disk). */
  fileBytes: text("file_bytes"),
  /** pdf | markdown | html | text */
  sourceType: varchar("source_type", { length: 16 }).notNull().default("pdf"),
  /** Chunking strategy used for the current index of this document. */
  chunkStrategy: varchar("chunk_strategy", { length: 24 })
    .notNull()
    .default("structural"),
  embeddingModel: varchar("embedding_model", { length: 64 }),
  pageCount: integer("page_count").notNull().default(0),
  /** Near-duplicate chunks skipped at ingest. */
  duplicateChunks: integer("duplicate_chunks").notNull().default(0),
  /** Normalized sections, kept so the doc can be re-chunked without re-upload. */
  processedSections: jsonb("processed_sections").$type<ProcessedSection[]>(),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .$defaultFn(() => new Date()),
});

export const chunks = pgTable("chunks", {
  id: uuid("id")
    .primaryKey()
    .$defaultFn(() => randomUUID()),
  documentId: uuid("document_id")
    .notNull()
    .references(() => documents.id, { onDelete: "cascade" }),
  guestId: varchar("guest_id", { length: 64 }).notNull(),
  chunkIndex: integer("chunk_index").notNull(),
  page: integer("page").notNull().default(1),
  text: text("text").notNull(),
  /** Nearest enclosing section heading, when the source exposes structure. */
  heading: text("heading"),
  chunkStrategy: varchar("chunk_strategy", { length: 24 })
    .notNull()
    .default("structural"),
  charCount: integer("char_count").notNull().default(0),
  /** sha256 of normalized text — exact-duplicate fast path. */
  contentHash: varchar("content_hash", { length: 64 }),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .$defaultFn(() => new Date()),
});

export const chats = pgTable("chats", {
  id: uuid("id")
    .primaryKey()
    .$defaultFn(() => randomUUID()),
  guestId: varchar("guest_id", { length: 64 }).notNull(),
  title: text("title").notNull().default("New chat"),
  documentId: uuid("document_id").references(() => documents.id, {
    onDelete: "set null",
  }),
  /** Selected document IDs for this chat; empty/null means all guest docs. */
  documentIds: jsonb("document_ids").$type<string[]>().default([]),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .$defaultFn(() => new Date()),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .$defaultFn(() => new Date()),
});

export const messages = pgTable("messages", {
  id: uuid("id")
    .primaryKey()
    .$defaultFn(() => randomUUID()),
  chatId: uuid("chat_id")
    .notNull()
    .references(() => chats.id, { onDelete: "cascade" }),
  role: varchar("role", { length: 16 }).notNull(),
  content: text("content").notNull(),
  sources: jsonb("sources").$type<SourcePayload[]>().default([]),
  /** hybrid | dense | sparse */
  retrievalMode: varchar("retrieval_mode", { length: 16 }),
  retrievalStats: jsonb("retrieval_stats").$type<RetrievalStats>(),
  citations: jsonb("citations").$type<CitationReport>(),
  confidence: jsonb("confidence").$type<ConfidenceReport>(),
  /** Set when the pipeline declined to answer on low retrieval confidence. */
  abstained: varchar("abstained", { length: 8 }),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .$defaultFn(() => new Date()),
});

/** Latency + score telemetry per eval run, used by the reporting scripts. */
export const evalRuns = pgTable("eval_runs", {
  id: uuid("id")
    .primaryKey()
    .$defaultFn(() => randomUUID()),
  label: text("label").notNull(),
  chunkStrategy: varchar("chunk_strategy", { length: 24 }).notNull(),
  retrievalMode: varchar("retrieval_mode", { length: 16 }).notNull(),
  caseCount: integer("case_count").notNull().default(0),
  correctness: real("correctness").notNull().default(0),
  faithfulness: real("faithfulness").notNull().default(0),
  retrievalRecall: real("retrieval_recall").notNull().default(0),
  citationAccuracy: real("citation_accuracy").notNull().default(0),
  report: jsonb("report"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .$defaultFn(() => new Date()),
});

export type ProcessedSection = {
  page: number;
  heading: string | null;
  text: string;
};

export type SourcePayload = {
  text: string;
  page: number;
  filename: string;
  documentId: string;
  /** 1-based number the model must cite as [n]. */
  citation?: number;
  chunkId?: string;
  heading?: string | null;
  score?: number;
  denseScore?: number;
  sparseScore?: number;
  rerankScore?: number;
  retrievedBy?: Array<"dense" | "sparse" | "neighbor">;
};

export type RetrievalStats = {
  mode: "hybrid" | "dense" | "sparse";
  denseWeight: number;
  sparseWeight: number;
  denseHits: number;
  sparseHits: number;
  fusedCandidates: number;
  rerankUsed: boolean;
  rerankBackend?: "gemini" | "lexical" | "none";
  /** Highest dense cosine similarity in the candidate pool. */
  topDenseScore: number;
  /** Mean rerank score across selected passages, when reranking ran. */
  meanRerankScore: number | null;
  keywordCoverage: number;
  documentsSearched: number;
  passagesReturned: number;
  durationMs: number;
};

export type CitationVerdict = {
  claim: string;
  citations: number[];
  /** Sources the judge found supporting, which may differ from `citations`. */
  supportedBy: number[];
  status: "supported" | "partial" | "unsupported" | "unverified";
  reason?: string;
};

export type CitationReport = {
  verified: boolean;
  totalClaims: number;
  citedClaims: number;
  /** Cited claims whose cited sources actually support them. */
  supportedClaims: number;
  unsupportedClaims: number;
  /** Claims supported by some source, cited correctly or not. */
  groundedClaims: number;
  /** Claims supported by a different source than the one cited. */
  miscitedClaims: number;
  invalidCitations: number[];
  unusedSources: number[];
  verdicts: CitationVerdict[];
};

export type ConfidenceReport = {
  /** 0–1 composite. */
  score: number;
  band: "high" | "medium" | "low";
  retrieval: number;
  citationCoverage: number;
  completeness: number;
  reasons: string[];
};
