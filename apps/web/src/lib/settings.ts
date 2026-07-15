export const SETTINGS_KEY = "kai.settings.v1";

export type KaiSettings = {
  apiKey: string;
  chatModel: string;
  embeddingModel: string;
  temperature: number;
  topK: number;
  theme: "light" | "dark";
  rerank: boolean;
};

export const defaultSettings: KaiSettings = {
  apiKey: "",
  chatModel: "gemini-2.5-flash",
  embeddingModel: "gemini-embedding-001",
  temperature: 0.4,
  topK: 5,
  theme: "light",
  rerank: true,
};

export function loadSettings(): KaiSettings {
  if (typeof window === "undefined") return defaultSettings;
  try {
    const raw = window.localStorage.getItem(SETTINGS_KEY);
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
