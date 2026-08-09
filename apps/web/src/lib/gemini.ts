import { GoogleGenAI } from "@google/genai";

import { envApiKeys, keyPool, markKeyExhausted } from "./api-keys";
import { isQuotaError, quotaRetryAfterMs } from "./gemini-errors";
import { EMBEDDING_DIM } from "./qdrant";

export { formatGeminiError } from "./gemini-errors";

/** Gemini caps batch embedding requests; keep well under the limit. */
const EMBED_BATCH_SIZE = 32;

export function resolveApiKey(clientKey?: string | null) {
  const key = clientKey?.trim() || envApiKeys()[0];
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

/**
 * Runs `attempt` against the first key with quota left, advancing through the
 * pool on rate-limit errors only. Any other failure (bad key, malformed
 * request) is thrown immediately — retrying it on four more keys would just
 * multiply the same error.
 */
async function withKeyFailover<T>(
  preferred: string,
  attempt: (apiKey: string) => Promise<T>,
): Promise<T> {
  const pool = keyPool(preferred);
  let lastError: unknown;

  for (const key of pool) {
    try {
      return await attempt(key);
    } catch (error) {
      if (!isQuotaError(error)) throw error;
      markKeyExhausted(key, quotaRetryAfterMs(error));
      lastError = error;
    }
  }

  throw lastError ?? new Error("No Gemini API key available.");
}

function padOrTrim(vector: number[], size = EMBEDDING_DIM) {
  if (vector.length === size) return vector;
  if (vector.length > size) return vector.slice(0, size);
  return [...vector, ...Array(size - vector.length).fill(0)];
}

type EmbedTask = "RETRIEVAL_DOCUMENT" | "QUESTION_ANSWERING" | "SEMANTIC_SIMILARITY";

async function embedBatch(options: {
  texts: string[];
  apiKey: string;
  model: string;
  taskType: EmbedTask;
}) {
  const ai = getGenAI(options.apiKey);
  const response = await ai.models.embedContent({
    model: options.model,
    contents: options.texts,
    config: {
      taskType: options.taskType,
      outputDimensionality: EMBEDDING_DIM,
    },
  });

  const embeddings = response.embeddings ?? [];
  if (embeddings.length !== options.texts.length) {
    throw new Error("Embedding API returned a mismatched batch size.");
  }

  return embeddings.map((embedding) => {
    const values = embedding?.values;
    if (!values?.length) {
      throw new Error("Embedding API returned an empty vector.");
    }
    return padOrTrim(values);
  });
}

async function embedOne(options: {
  text: string;
  apiKey: string;
  model: string;
  taskType: EmbedTask;
}) {
  const ai = getGenAI(options.apiKey);
  const response = await ai.models.embedContent({
    model: options.model,
    contents: options.text,
    config: {
      taskType: options.taskType,
      outputDimensionality: EMBEDDING_DIM,
    },
  });

  const values =
    response.embeddings?.[0]?.values ??
    (response as { embedding?: { values?: number[] } }).embedding?.values;

  if (!values?.length) {
    throw new Error("Embedding API returned an empty vector.");
  }
  return padOrTrim(values);
}

export async function embedTexts(
  texts: string[],
  options: { apiKey: string; model?: string; taskType?: EmbedTask },
) {
  const model = options.model ?? "gemini-embedding-001";
  const taskType = options.taskType ?? "RETRIEVAL_DOCUMENT";
  const vectors: number[][] = [];

  for (let i = 0; i < texts.length; i += EMBED_BATCH_SIZE) {
    const batch = texts.slice(i, i + EMBED_BATCH_SIZE);
    vectors.push(
      ...(await withKeyFailover(options.apiKey, async (apiKey) => {
        try {
          return await embedBatch({ texts: batch, apiKey, model, taskType });
        } catch (error) {
          // Older models and some quota tiers reject batched contents. Fanning
          // out on a rate limit would multiply the offending requests, so let
          // those propagate to the key failover instead.
          if (isQuotaError(error)) throw error;
          const single: number[][] = [];
          for (const text of batch) {
            single.push(await embedOne({ text, apiKey, model, taskType }));
          }
          return single;
        }
      })),
    );
  }

  return vectors;
}

export async function embedQuery(
  query: string,
  options: { apiKey: string; model?: string },
) {
  return withKeyFailover(options.apiKey, (apiKey) =>
    embedOne({
      text: query,
      apiKey,
      model: options.model ?? "gemini-embedding-001",
      taskType: "QUESTION_ANSWERING",
    }),
  );
}

/**
 * Single-shot JSON generation used by the reranker, the citation verifier, and
 * the eval judges. Strips code fences that models occasionally add anyway.
 */
export async function generateJson<T>(options: {
  apiKey: string;
  model: string;
  prompt: string;
  system?: string;
  temperature?: number;
}): Promise<T> {
  return withKeyFailover(options.apiKey, async (apiKey) => {
    const ai = getGenAI(apiKey);
    const response = await ai.models.generateContent({
      model: options.model,
      contents: options.prompt,
      config: {
        temperature: options.temperature ?? 0,
        responseMimeType: "application/json",
        ...(options.system ? { systemInstruction: options.system } : {}),
      },
    });

    const raw = (response.text ?? "").trim();
    if (!raw) throw new Error("Model returned an empty JSON response.");
    return JSON.parse(stripFences(raw)) as T;
  });
}

function stripFences(raw: string) {
  const fenced = /^```(?:json)?\s*([\s\S]*?)\s*```$/i.exec(raw);
  return (fenced ? fenced[1] : raw).trim();
}

export async function* streamChatAnswer(options: {
  apiKey: string;
  model: string;
  temperature: number;
  system: string;
  user: string;
  history: Array<{ role: "user" | "assistant"; content: string }>;
}) {
  const contents = [
    ...options.history.map((turn) => ({
      role: turn.role === "assistant" ? "model" : "user",
      parts: [{ text: turn.content }],
    })),
    { role: "user", parts: [{ text: options.user }] },
  ];

  const openStream = (apiKey: string) =>
    getGenAI(apiKey).models.generateContentStream({
      model: options.model,
      contents,
      config: {
        systemInstruction: options.system,
        temperature: options.temperature,
      },
    });

  // Failover has a deadline here: once a chunk has been yielded the caller may
  // have already flushed it to the browser, and restarting on another key would
  // emit the answer twice. So the retry window closes after the first chunk
  // arrives — quota errors mid-stream surface to the user like any other.
  let lastError: unknown;

  for (const key of keyPool(options.apiKey)) {
    let iterator: AsyncIterator<{ text?: string }>;
    let first: IteratorResult<{ text?: string }>;

    try {
      const stream = await openStream(key);
      iterator = stream[Symbol.asyncIterator]();
      first = await iterator.next();
    } catch (error) {
      if (!isQuotaError(error)) throw error;
      markKeyExhausted(key, quotaRetryAfterMs(error));
      lastError = error;
      continue;
    }

    for (let step = first; !step.done; step = await iterator.next()) {
      const text = step.value?.text;
      if (text) yield text;
    }
    return;
  }

  throw lastError ?? new Error("No Gemini API key available.");
}

export async function generateText(options: {
  apiKey: string;
  model: string;
  prompt: string;
  system?: string;
  temperature?: number;
}) {
  return withKeyFailover(options.apiKey, async (apiKey) => {
    const ai = getGenAI(apiKey);
    const response = await ai.models.generateContent({
      model: options.model,
      contents: options.prompt,
      config: {
        temperature: options.temperature ?? 0.2,
        ...(options.system ? { systemInstruction: options.system } : {}),
      },
    });
    return (response.text ?? "").trim();
  });
}
