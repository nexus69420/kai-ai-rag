import { CHUNK_STRATEGIES } from "./chunking";
import { RETRIEVAL_MODES } from "./retrieval-modes";

/**
 * Hand-maintained OpenAPI 3.1 description of the machine-facing surface.
 * Served at `/api/openapi` and rendered at `/api-docs`.
 */
export function buildOpenApiSpec() {
  return {
    openapi: "3.1.0",
    info: {
      title: "KAI RAG API",
      version: "1.0.0",
      description:
        "Hybrid-retrieval RAG over your indexed documents. Answers include " +
        "bracketed citations, per-claim verification verdicts, and a composite " +
        "confidence score. Requests are scoped to a workspace by the " +
        "`kai_guest_id` cookie.",
    },
    servers: [{ url: "/", description: "Current deployment" }],
    tags: [
      { name: "Ask", description: "Grounded question answering" },
      { name: "Documents", description: "Corpus management" },
      { name: "Retrieval", description: "Retrieval diagnostics" },
      { name: "System", description: "Health and metadata" },
    ],
    components: {
      securitySchemes: {
        ApiKeyHeader: {
          type: "apiKey",
          in: "header",
          name: "x-api-key",
          description:
            "Gemini API key. Optional when the server sets GOOGLE_API_KEY.",
        },
      },
      schemas: {
        Source: {
          type: "object",
          properties: {
            citation: { type: "integer", description: "Number used as [n]." },
            chunkId: { type: "string", format: "uuid" },
            documentId: { type: "string", format: "uuid" },
            filename: { type: "string" },
            page: { type: "integer" },
            heading: { type: ["string", "null"] },
            score: { type: "number" },
            denseScore: { type: "number" },
            sparseScore: { type: "number" },
            rerankScore: { type: "number" },
            retrievedBy: {
              type: "array",
              items: { type: "string", enum: ["dense", "sparse", "neighbor"] },
            },
            text: { type: "string" },
          },
        },
        RetrievalStats: {
          type: "object",
          properties: {
            mode: { type: "string", enum: [...RETRIEVAL_MODES] },
            denseWeight: { type: "number" },
            sparseWeight: { type: "number" },
            denseHits: { type: "integer" },
            sparseHits: { type: "integer" },
            fusedCandidates: { type: "integer" },
            rerankUsed: { type: "boolean" },
            rerankBackend: {
              type: "string",
              enum: ["gemini", "lexical", "none"],
            },
            topDenseScore: { type: "number" },
            meanRerankScore: { type: ["number", "null"] },
            keywordCoverage: { type: "number" },
            documentsSearched: { type: "integer" },
            passagesReturned: { type: "integer" },
            durationMs: { type: "integer" },
          },
        },
        CitationReport: {
          type: "object",
          properties: {
            verified: { type: "boolean" },
            totalClaims: { type: "integer" },
            citedClaims: { type: "integer" },
            supportedClaims: { type: "integer" },
            unsupportedClaims: { type: "integer" },
            groundedClaims: { type: "integer" },
            miscitedClaims: { type: "integer" },
            invalidCitations: { type: "array", items: { type: "integer" } },
            unusedSources: { type: "array", items: { type: "integer" } },
            verdicts: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  claim: { type: "string" },
                  citations: { type: "array", items: { type: "integer" } },
                  supportedBy: { type: "array", items: { type: "integer" } },
                  status: {
                    type: "string",
                    enum: ["supported", "partial", "unsupported", "unverified"],
                  },
                  reason: { type: "string" },
                },
              },
            },
          },
        },
        ConfidenceReport: {
          type: "object",
          properties: {
            score: { type: "number", minimum: 0, maximum: 1 },
            band: { type: "string", enum: ["high", "medium", "low"] },
            retrieval: { type: "number" },
            citationCoverage: { type: "number" },
            completeness: { type: "number" },
            reasons: { type: "array", items: { type: "string" } },
          },
        },
        Error: {
          type: "object",
          properties: { error: { type: "string" } },
          required: ["error"],
        },
      },
    },
    security: [{ ApiKeyHeader: [] }],
    paths: {
      "/api/v1/ask": {
        post: {
          tags: ["Ask"],
          summary: "Ask a grounded question",
          description:
            "Retrieves evidence, generates a cited answer, verifies each " +
            "citation, and returns a confidence breakdown. Declines to answer " +
            "when retrieval confidence falls below `abstainThreshold`.",
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  required: ["question"],
                  properties: {
                    question: { type: "string", maxLength: 4000 },
                    documentIds: {
                      type: "array",
                      items: { type: "string", format: "uuid" },
                      description: "Omit to search the whole workspace.",
                    },
                    chatModel: { type: "string", default: "gemini-2.5-flash" },
                    embeddingModel: {
                      type: "string",
                      default: "gemini-embedding-001",
                    },
                    temperature: { type: "number", default: 0.4 },
                    topK: { type: "integer", default: 5, minimum: 1, maximum: 12 },
                    rerank: { type: "boolean", default: true },
                    retrievalMode: {
                      type: "string",
                      enum: [...RETRIEVAL_MODES],
                      default: "hybrid",
                    },
                    denseWeight: { type: "number", default: 0.7 },
                    sparseWeight: { type: "number", default: 0.3 },
                    verifyCitations: { type: "boolean", default: true },
                    abstainThreshold: { type: "number", default: 0.35 },
                    includeSourceText: { type: "boolean", default: true },
                  },
                },
              },
            },
          },
          responses: {
            "200": {
              description: "Answer with citations and confidence",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    properties: {
                      question: { type: "string" },
                      answer: { type: "string" },
                      abstained: { type: "boolean" },
                      confidence: { $ref: "#/components/schemas/ConfidenceReport" },
                      citations: { $ref: "#/components/schemas/CitationReport" },
                      retrieval: { $ref: "#/components/schemas/RetrievalStats" },
                      sources: {
                        type: "array",
                        items: { $ref: "#/components/schemas/Source" },
                      },
                    },
                  },
                },
              },
            },
            "400": errorResponse("No indexed documents or invalid request"),
            "401": errorResponse("Missing or rejected API key"),
            "429": errorResponse("Rate limited"),
          },
        },
      },
      "/api/v1/ingest": {
        post: {
          tags: ["Documents"],
          summary: "Index a document",
          description:
            "Accepts multipart form data with a `file` field, or JSON with " +
            "`filename` and `content` for text formats. Near-duplicate chunks " +
            "are skipped unless `dedupe` is false.",
          requestBody: {
            required: true,
            content: {
              "multipart/form-data": {
                schema: {
                  type: "object",
                  properties: {
                    file: { type: "string", format: "binary" },
                    chunkStrategy: {
                      type: "string",
                      enum: [...CHUNK_STRATEGIES],
                    },
                    embeddingModel: { type: "string" },
                    dedupe: { type: "string", enum: ["true", "false"] },
                  },
                },
              },
              "application/json": {
                schema: {
                  type: "object",
                  required: ["filename", "content"],
                  properties: {
                    filename: { type: "string", example: "runbook.md" },
                    content: { type: "string" },
                    chunkStrategy: {
                      type: "string",
                      enum: [...CHUNK_STRATEGIES],
                    },
                    embeddingModel: { type: "string" },
                    dedupe: { type: "boolean" },
                  },
                },
              },
            },
          },
          responses: {
            "201": {
              description: "Indexed",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    properties: {
                      documentId: { type: "string", format: "uuid" },
                      filename: { type: "string" },
                      sourceType: {
                        type: "string",
                        enum: ["pdf", "markdown", "html", "text"],
                      },
                      chunkStrategy: {
                        type: "string",
                        enum: [...CHUNK_STRATEGIES],
                      },
                      totalChunks: { type: "integer" },
                      duplicateChunks: { type: "integer" },
                      pages: { type: "integer" },
                    },
                  },
                },
              },
            },
            "400": errorResponse("Unsupported file type or malformed body"),
            "413": errorResponse("File too large"),
          },
        },
      },
      "/api/v1/documents": {
        get: {
          tags: ["Documents"],
          summary: "List indexed documents",
          responses: {
            "200": {
              description: "Documents in this workspace",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    properties: {
                      documents: { type: "array", items: { type: "object" } },
                      totals: { type: "object" },
                    },
                  },
                },
              },
            },
          },
        },
      },
      "/api/documents/{id}/reindex": {
        post: {
          tags: ["Documents"],
          summary: "Re-chunk a document with another strategy",
          parameters: [
            {
              name: "id",
              in: "path",
              required: true,
              schema: { type: "string", format: "uuid" },
            },
          ],
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  required: ["chunkStrategy"],
                  properties: {
                    chunkStrategy: {
                      type: "string",
                      enum: [...CHUNK_STRATEGIES],
                    },
                    embeddingModel: { type: "string" },
                    dedupe: { type: "boolean", default: true },
                  },
                },
              },
            },
          },
          responses: {
            "200": { description: "Re-indexed" },
            "404": errorResponse("Document not found"),
            "409": errorResponse("No stored text or file to re-index"),
          },
        },
      },
      "/api/retrieval/compare": {
        post: {
          tags: ["Retrieval"],
          summary: "Compare hybrid, dense, and sparse retrieval",
          description:
            "Runs one question through each retrieval mode and reports ranked " +
            "passages, per-mode stats, and pairwise overlap. No generation.",
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  required: ["question"],
                  properties: {
                    question: { type: "string" },
                    documentIds: {
                      type: "array",
                      items: { type: "string", format: "uuid" },
                    },
                    topK: { type: "integer", default: 5 },
                    rerank: { type: "boolean", default: true },
                    modes: {
                      type: "array",
                      items: { type: "string", enum: [...RETRIEVAL_MODES] },
                    },
                  },
                },
              },
            },
          },
          responses: { "200": { description: "Per-mode retrieval results" } },
        },
      },
      "/api/health": {
        get: {
          tags: ["System"],
          summary: "Database and vector store health",
          security: [],
          responses: { "200": { description: "Component status" } },
        },
      },
    },
  } as const;
}

function errorResponse(description: string) {
  return {
    description,
    content: {
      "application/json": { schema: { $ref: "#/components/schemas/Error" } },
    },
  };
}
