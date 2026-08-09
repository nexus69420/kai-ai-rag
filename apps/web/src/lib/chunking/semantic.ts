import type { ProcessedSection } from "../db/schema";
import { chunkStructural } from "./structural";
import {
  makeChunk,
  mergeTinyChunks,
  recursiveSplit,
  splitSentences,
  withHeadingContext,
} from "./text";
import type { Chunk, ChunkOptions } from "./types";

type Unit = {
  text: string;
  page: number;
  heading: string | null;
  sectionIndex: number;
};

/**
 * Semantic strategy: embed sentence windows and cut where consecutive windows
 * diverge, so a chunk boundary lands on a topic change instead of a character
 * count. Falls back to the structural splitter when embeddings are unavailable
 * or the document is too large to embed sentence-by-sentence.
 */
export async function chunkSemantic(
  sections: ProcessedSection[],
  options: ChunkOptions,
): Promise<Chunk[]> {
  const units = toUnits(sections);

  if (!options.embed || units.length < 4) {
    return chunkStructural(sections, options);
  }
  if (units.length > options.semanticMaxSentences) {
    return chunkStructural(sections, options);
  }

  let vectors: number[][];
  try {
    vectors = await options.embed(buildWindows(units));
  } catch (error) {
    console.warn("Semantic chunking embed failed, using structural:", error);
    return chunkStructural(sections, options);
  }

  if (vectors.length !== units.length) {
    return chunkStructural(sections, options);
  }

  const distances: number[] = [];
  for (let i = 0; i < units.length - 1; i++) {
    distances.push(1 - cosine(vectors[i], vectors[i + 1]));
  }

  const threshold = percentile(distances, options.semanticBreakpointPercentile);
  const chunks: Chunk[] = [];
  let buffer: Unit[] = [];

  const flush = () => {
    if (!buffer.length) return;
    const heading = buffer[0].heading;
    const body = withHeadingContext(
      buffer.map((u) => u.text).join("\n"),
      heading,
    );
    // A single topical run can still exceed the model budget.
    for (const piece of recursiveSplit(body, options.chunkSize, options.overlap)) {
      chunks.push(makeChunk(piece, buffer[0].page, heading, "semantic"));
    }
    buffer = [];
  };

  for (let i = 0; i < units.length; i++) {
    const unit = units[i];
    const pending = [...buffer, unit];
    const pendingLength = pending.reduce((acc, u) => acc + u.text.length + 1, 0);

    if (buffer.length && pendingLength > options.chunkSize) {
      flush();
    }

    buffer.push(unit);

    const nextUnit = units[i + 1];
    if (!nextUnit) break;

    const crossesSection = nextUnit.sectionIndex !== unit.sectionIndex;
    const topicShift = distances[i] > threshold;
    if (crossesSection || topicShift) flush();
  }

  flush();
  return mergeTinyChunks(chunks, options.minChunkChars);
}

function toUnits(sections: ProcessedSection[]): Unit[] {
  const units: Unit[] = [];
  sections.forEach((section, sectionIndex) => {
    for (const text of splitSentences(section.text)) {
      units.push({
        text,
        page: section.page,
        heading: section.heading,
        sectionIndex,
      });
    }
  });
  return units;
}

/** Neighbour context makes single-sentence embeddings far less noisy. */
function buildWindows(units: Unit[]): string[] {
  return units.map((unit, index) => {
    const prev = units[index - 1]?.text ?? "";
    const next = units[index + 1]?.text ?? "";
    return [prev, unit.text, next].filter(Boolean).join(" ");
  });
}

export function cosine(a: number[], b: number[]) {
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

export function percentile(values: number[], p: number) {
  if (!values.length) return Number.POSITIVE_INFINITY;
  const sorted = [...values].sort((a, b) => a - b);
  const rank = Math.ceil((p / 100) * sorted.length);
  const index = Math.min(sorted.length - 1, Math.max(0, rank - 1));
  return sorted[index];
}
