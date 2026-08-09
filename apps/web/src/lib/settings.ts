import type { ChunkStrategy } from "./chunking/types";
import type { RetrievalMode } from "./retrieval-modes";

export const SETTINGS_KEY = "kai.settings.v2";
const LEGACY_SETTINGS_KEY = "kai.settings.v1";

export type KaiSettings = {
  apiKey: string;
  chatModel: string;
  embeddingModel: string;
  temperature: number;
  topK: number;
  theme: "light" | "dark";
  rerank: boolean;
  retrievalMode: RetrievalMode;
  /** Relative pull of dense vs sparse in RRF. Normalized server-side. */
  denseWeight: number;
  sparseWeight: number;
  chunkStrategy: ChunkStrategy;
  verifyCitations: boolean;
  /** Below this retrieval confidence KAI reports instead of answering. */
  abstainThreshold: number;
  dedupe: boolean;
};

export const defaultSettings: KaiSettings = {
  apiKey: "",
  chatModel: "gemini-2.5-flash",
  embeddingModel: "gemini-embedding-001",
  temperature: 0.4,
  topK: 5,
  theme: "light",
  rerank: true,
  retrievalMode: "hybrid",
  denseWeight: 0.7,
  sparseWeight: 0.3,
  chunkStrategy: "structural",
  verifyCitations: true,
  abstainThreshold: 0.35,
  dedupe: true,
};

export function loadSettings(): KaiSettings {
  if (typeof window === "undefined") return defaultSettings;
  try {
    const raw =
      window.localStorage.getItem(SETTINGS_KEY) ??
      window.localStorage.getItem(LEGACY_SETTINGS_KEY);
    if (!raw) return defaultSettings;
    return { ...defaultSettings, ...JSON.parse(raw) };
  } catch {
    return defaultSettings;
  }
}

export function saveSettings(settings: KaiSettings) {
  window.localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
  window.dispatchEvent(new Event("kai-settings"));
}

export function clearSettingsKeys() {
  const current = loadSettings();
  saveSettings({ ...current, apiKey: "" });
}
