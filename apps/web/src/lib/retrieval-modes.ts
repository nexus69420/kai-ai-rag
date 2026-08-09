/**
 * Retrieval mode vocabulary, kept apart from `retrieve.ts` so client
 * components and the OpenAPI builder can name a mode without pulling the
 * database, vector store, and PDF parser into their bundle.
 */
export const RETRIEVAL_MODES = ["hybrid", "dense", "sparse"] as const;

export type RetrievalMode = (typeof RETRIEVAL_MODES)[number];

export const RETRIEVAL_MODE_DESCRIPTIONS: Record<RetrievalMode, string> = {
  hybrid: "Dense + BM25, fused with weighted RRF. Best general default.",
  dense: "Vector similarity only. Strong on paraphrase, weak on exact tokens.",
  sparse: "BM25 only. Strong on identifiers, config keys, and error codes.",
};

export function isRetrievalMode(value: unknown): value is RetrievalMode {
  return (
    typeof value === "string" &&
    (RETRIEVAL_MODES as readonly string[]).includes(value)
  );
}
