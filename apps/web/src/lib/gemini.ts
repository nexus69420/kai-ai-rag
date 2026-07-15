import { GoogleGenAI } from "@google/genai";

import { EMBEDDING_DIM } from "./qdrant";

export { formatGeminiError } from "./gemini-errors";

export function resolveApiKey(clientKey?: string | null) {
  const key = clientKey?.trim() || process.env.GOOGLE_API_KEY?.trim();
  if (!key) {
    throw new Error(
      "No API key configured. Add a Gemini API key in Settings or set GOOGLE_API_KEY.",
    );
  }
  return key;
}

export function getGenAI(apiKey: string) {
  return new GoogleGenAI({ apiKey });
}

function padOrTrim(vector: number[], size = EMBEDDING_DIM) {
  if (vector.length === size) return vector;
  if (vector.length > size) return vector.slice(0, size);
  return [...vector, ...Array(size - vector.length).fill(0)];
}

export async function embedTexts(
  texts: string[],
  options: { apiKey: string; model?: string },
) {
  const ai = getGenAI(options.apiKey);
  const model = options.model ?? "gemini-embedding-001";
  const vectors: number[][] = [];

  for (const text of texts) {
    const response = await ai.models.embedContent({
      model,
      contents: text,
      config: {
        taskType: "RETRIEVAL_DOCUMENT",
        outputDimensionality: EMBEDDING_DIM,
      },
    });

    const values =
      response.embeddings?.[0]?.values ??
      (response as { embedding?: { values?: number[] } }).embedding?.values;

    if (!values?.length) {
      throw new Error("Embedding API returned an empty vector.");
    }
    vectors.push(padOrTrim(values));
  }

  return vectors;
}

export async function embedQuery(
  query: string,
  options: { apiKey: string; model?: string },
) {
  const ai = getGenAI(options.apiKey);
  const model = options.model ?? "gemini-embedding-001";
  const response = await ai.models.embedContent({
    model,
    contents: query,
    config: {
      taskType: "QUESTION_ANSWERING",
      outputDimensionality: EMBEDDING_DIM,
    },
  });

  const values =
    response.embeddings?.[0]?.values ??
    (response as { embedding?: { values?: number[] } }).embedding?.values;

  if (!values?.length) {
    throw new Error("Query embedding returned an empty vector.");
  }
  return padOrTrim(values);
}

export async function* streamChatAnswer(options: {
  apiKey: string;
  model: string;
  temperature: number;
  system: string;
  user: string;
  history: Array<{ role: "user" | "assistant"; content: string }>;
}) {
  const ai = getGenAI(options.apiKey);
  const contents = [
    ...options.history.map((turn) => ({
      role: turn.role === "assistant" ? "model" : "user",
      parts: [{ text: turn.content }],
    })),
    { role: "user", parts: [{ text: options.user }] },
  ];

  const stream = await ai.models.generateContentStream({
    model: options.model,
    contents,
    config: {
      systemInstruction: options.system,
      temperature: options.temperature,
    },
  });

  for await (const chunk of stream) {
    const text = chunk.text;
    if (text) yield text;
  }
}
