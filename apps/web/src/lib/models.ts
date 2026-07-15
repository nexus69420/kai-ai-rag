export const CHAT_MODELS = [
  { id: "gemini-2.5-flash", label: "Gemini 2.5 Flash" },
  { id: "gemini-2.5-pro", label: "Gemini 2.5 Pro" },
  { id: "gemma-3-27b-it", label: "Gemma 3 27B" },
] as const;

export const EMBEDDING_MODELS = [
  { id: "gemini-embedding-001", label: "Gemini Embedding 001 (768)" },
] as const;

export type ChatModelId = (typeof CHAT_MODELS)[number]["id"];
export type EmbeddingModelId = (typeof EMBEDDING_MODELS)[number]["id"];
