"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

import { CHAT_MODELS, EMBEDDING_MODELS } from "@/lib/models";
import {
  clearSettingsKeys,
  defaultSettings,
  loadSettings,
  saveSettings,
  type KaiSettings,
} from "@/lib/settings";

export default function SettingsPage() {
  const [settings, setSettings] = useState<KaiSettings>(defaultSettings);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    setSettings(loadSettings());
  }, []);

  function update<K extends keyof KaiSettings>(key: K, value: KaiSettings[K]) {
    setSettings((prev) => ({ ...prev, [key]: value }));
    setSaved(false);
  }

  function onSave() {
    saveSettings(settings);
    setSaved(true);
  }

  return (
    <main className="settings-page" data-theme={settings.theme}>
      <div className="settings-card">
        <div className="eyebrow">Configuration</div>
        <h1>Settings</h1>
        <p className="lead">
          Keys stay in this browser (`localStorage`). They are sent only to KAI
          API routes for your requests and are never written to the database.
        </p>

        <div className="field">
          <label htmlFor="apiKey">Gemini API key</label>
          <input
            id="apiKey"
            type="password"
            value={settings.apiKey}
            placeholder="AIza…"
            onChange={(e) => update("apiKey", e.target.value)}
          />
          <p className="hint">
            Required for uploads and chat unless a server `GOOGLE_API_KEY`
            fallback is configured.
          </p>
        </div>

        <div className="field">
          <label htmlFor="chatModel">Chat model</label>
          <select
            id="chatModel"
            value={settings.chatModel}
            onChange={(e) => update("chatModel", e.target.value)}
          >
            {CHAT_MODELS.map((model) => (
              <option key={model.id} value={model.id}>
                {model.label}
              </option>
            ))}
          </select>
        </div>

        <div className="field">
          <label htmlFor="embeddingModel">Embedding model</label>
          <select
            id="embeddingModel"
            value={settings.embeddingModel}
            onChange={(e) => update("embeddingModel", e.target.value)}
          >
            {EMBEDDING_MODELS.map((model) => (
              <option key={model.id} value={model.id}>
                {model.label}
              </option>
            ))}
          </select>
        </div>

        <div className="field">
          <label htmlFor="temperature">Temperature ({settings.temperature})</label>
          <input
            id="temperature"
            type="range"
            min={0}
            max={1}
            step={0.1}
            value={settings.temperature}
            onChange={(e) => update("temperature", Number(e.target.value))}
          />
        </div>

        <div className="field">
          <label htmlFor="topK">Retrieval topK ({settings.topK})</label>
          <input
            id="topK"
            type="range"
            min={1}
            max={12}
            step={1}
            value={settings.topK}
            onChange={(e) => update("topK", Number(e.target.value))}
          />
        </div>

        <div className="field">
          <label htmlFor="rerank">Rerank retrieved passages</label>
          <select
            id="rerank"
            value={settings.rerank ? "on" : "off"}
            onChange={(e) => update("rerank", e.target.value === "on")}
          >
            <option value="on">On (Gemini scores hybrid hits)</option>
            <option value="off">Off (hybrid RRF only)</option>
          </select>
          <p className="hint">
            After dense + keyword fusion, Gemini reorders the shortlist so the
            most answerable passages reach the chat model first.
          </p>
        </div>

        <div className="field">
          <label htmlFor="theme">Theme</label>
          <select
            id="theme"
            value={settings.theme}
            onChange={(e) =>
              update("theme", e.target.value as "light" | "dark")
            }
          >
            <option value="light">Light</option>
            <option value="dark">Dark</option>
          </select>
        </div>

        <div className="settings-actions">
          <button type="button" className="primary" onClick={onSave}>
            {saved ? "Saved" : "Save settings"}
          </button>
          <button
            type="button"
            className="danger"
            onClick={() => {
              clearSettingsKeys();
              setSettings(loadSettings());
              setSaved(false);
            }}
          >
            Clear API key
          </button>
          <Link href="/chat">Back to chat</Link>
        </div>
      </div>
    </main>
  );
}
