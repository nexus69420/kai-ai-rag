import { readFileSync } from "fs";
import path from "path";

import { envApiKeys } from "../../src/lib/api-keys";
import { DEFAULT_ABSTAIN_THRESHOLD } from "../../src/lib/confidence";
import { isChunkStrategy, type ChunkStrategy } from "../../src/lib/chunking";
import { RETRIEVAL_MODES, type RetrievalMode } from "../../src/lib/retrieve";
import type { GoldenSet, RunConfig } from "./types";

export const GOLDEN_PATH = path.join(
  process.cwd(),
  "eval",
  "golden",
  "questions.json",
);

export function loadGoldenSet(): GoldenSet {
  return JSON.parse(readFileSync(GOLDEN_PATH, "utf8")) as GoldenSet;
}

export type Flags = Record<string, string | boolean>;

export function parseFlags(argv: string[]): Flags {
  const flags: Flags = {};

  for (let i = 0; i < argv.length; i++) {
    const token = argv[i];
    if (!token.startsWith("--")) continue;

    const [rawKey, inlineValue] = token.slice(2).split("=");
    const key = rawKey.replace(/-([a-z])/g, (_, c: string) => c.toUpperCase());

    if (inlineValue !== undefined) {
      flags[key] = inlineValue;
      continue;
    }

    const next = argv[i + 1];
    if (next && !next.startsWith("--")) {
      flags[key] = next;
      i += 1;
    } else {
      flags[key] = true;
    }
  }

  return flags;
}

export function resolveApiKeyOrExit(): string {
  const keys = envApiKeys();
  if (!keys.length) {
    console.error(
      "GOOGLE_API_KEY is required. Set it in apps/web/.env.local or the environment.",
    );
    process.exit(1);
  }
  if (keys.length > 1) {
    console.log(
      `Using a pool of ${keys.length} API keys; requests fail over on quota errors.`,
    );
  }
  return keys[0];
}

export function buildRunConfig(flags: Flags, defaults?: Partial<RunConfig>): RunConfig {
  const strategy = readStrategy(flags.strategy ?? defaults?.strategy ?? "structural");
  const mode = readMode(flags.mode ?? defaults?.mode ?? "hybrid");
  const denseWeight = readNumber(flags.denseWeight, defaults?.denseWeight ?? 0.7);

  return {
    label:
      typeof flags.label === "string"
        ? flags.label
        : (defaults?.label ?? `${strategy}/${mode}`),
    strategy,
    mode,
    topK: Math.round(readNumber(flags.topK, defaults?.topK ?? 5)),
    rerank: readBoolean(flags.rerank, defaults?.rerank ?? true),
    verifyCitations: readBoolean(
      flags.verify,
      defaults?.verifyCitations ?? true,
    ),
    denseWeight,
    sparseWeight: readNumber(
      flags.sparseWeight,
      defaults?.sparseWeight ?? Math.round((1 - denseWeight) * 100) / 100,
    ),
    abstainThreshold: readNumber(
      flags.abstainThreshold,
      defaults?.abstainThreshold ?? DEFAULT_ABSTAIN_THRESHOLD,
    ),
    chatModel:
      typeof flags.chatModel === "string"
        ? flags.chatModel
        : (defaults?.chatModel ?? "gemini-2.5-flash"),
    embeddingModel:
      typeof flags.embeddingModel === "string"
        ? flags.embeddingModel
        : (defaults?.embeddingModel ?? "gemini-embedding-001"),
    judgeModel:
      typeof flags.judgeModel === "string"
        ? flags.judgeModel
        : (defaults?.judgeModel ?? "gemini-2.5-flash"),
    concurrency: Math.round(readNumber(flags.concurrency, defaults?.concurrency ?? 2)),
  };
}

export function readStrategy(value: unknown): ChunkStrategy {
  if (isChunkStrategy(value)) return value;
  throw new Error(
    `Unknown --strategy "${String(value)}". Use fixed, structural, or semantic.`,
  );
}

export function readMode(value: unknown): RetrievalMode {
  if (
    typeof value === "string" &&
    (RETRIEVAL_MODES as readonly string[]).includes(value)
  ) {
    return value as RetrievalMode;
  }
  throw new Error(
    `Unknown --mode "${String(value)}". Use ${RETRIEVAL_MODES.join(", ")}.`,
  );
}

export function readNumber(value: unknown, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export function readBoolean(value: unknown, fallback: boolean): boolean {
  if (value === undefined) return fallback;
  if (typeof value === "boolean") return value;
  if (value === "true" || value === "on" || value === "1") return true;
  if (value === "false" || value === "off" || value === "0") return false;
  return fallback;
}
