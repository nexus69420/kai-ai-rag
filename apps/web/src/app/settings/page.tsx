"use client";

import Link from "next/link";
import { useState } from "react";

import { CHUNK_STRATEGIES, STRATEGY_DESCRIPTIONS } from "@/lib/chunking";
import type { ChunkStrategy } from "@/lib/chunking/types";
import { CHAT_MODELS, EMBEDDING_MODELS } from "@/lib/models";
import {
  RETRIEVAL_MODE_DESCRIPTIONS,
  RETRIEVAL_MODES,
  type RetrievalMode,
} from "@/lib/retrieval-modes";
import {
  clearSettingsKeys,
  saveSettings,
  type KaiSettings,
} from "@/lib/settings";
import { useKaiSettings } from "@/lib/use-kai-settings";

export default function SettingsPage() {
  const stored = useKaiSettings();
  /** Unsaved edits layered over what is in storage; null means untouched. */
  const [draft, setDraft] = useState<Partial<KaiSettings> | null>(null);
  const [saved, setSaved] = useState(false);
  const settings: KaiSettings = { ...stored, ...draft };

  function update<K extends keyof KaiSettings>(key: K, value: KaiSettings[K]) {
    setDraft((prev) => ({ ...prev, [key]: value }));
    setSaved(false);
  }

  function onSave() {
    saveSettings(settings);
    setDraft(null);
    setSaved(true);
  }

  const densePercent = Math.round(settings.denseWeight * 100);

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
            Required for indexing and chat unless a server `GOOGLE_API_KEY`
            fallback is configured.
          </p>
        </div>

        <h2 className="settings-section">Models</h2>

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
          <label htmlFor="temperature">
            Temperature ({settings.temperature})
          </label>
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

        <h2 className="settings-section">Retrieval</h2>

        <div className="field">
          <label htmlFor="retrievalMode">Retrieval mode</label>
          <select
            id="retrievalMode"
            value={settings.retrievalMode}
            onChange={(e) =>
              update("retrievalMode", e.target.value as RetrievalMode)
            }
          >
            {RETRIEVAL_MODES.map((mode) => (
              <option key={mode} value={mode}>
                {mode}
              </option>
            ))}
          </select>
          <p className="hint">
            {RETRIEVAL_MODE_DESCRIPTIONS[settings.retrievalMode]}
          </p>
        </div>

        <div className="field">
          <label htmlFor="denseWeight">
            Fusion weighting — {densePercent}% dense / {100 - densePercent}%
            sparse
          </label>
          <input
            id="denseWeight"
            type="range"
            min={0}
            max={1}
            step={0.05}
            disabled={settings.retrievalMode !== "hybrid"}
            value={settings.denseWeight}
            onChange={(e) => {
              const dense = Number(e.target.value);
              update("denseWeight", dense);
              update("sparseWeight", Math.round((1 - dense) * 100) / 100);
            }}
          />
          <p className="hint">
            Raise sparse for technical corpora full of exact identifiers; raise
            dense for prose where wording varies.
          </p>
        </div>

        <div className="field">
          <label htmlFor="topK">Passages sent to the model ({settings.topK})</label>
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
            <option value="on">On (LLM-as-judge scores the shortlist)</option>
            <option value="off">Off (fusion order only)</option>
          </select>
          <p className="hint">
            A second pass scores each (question, passage) pair, which removes
            candidates that fused highly on vocabulary overlap alone.
          </p>
        </div>

        <h2 className="settings-section">Answer quality</h2>

        <div className="field">
          <label htmlFor="verifyCitations">Verify citations</label>
          <select
            id="verifyCitations"
            value={settings.verifyCitations ? "on" : "off"}
            onChange={(e) => update("verifyCitations", e.target.value === "on")}
          >
            <option value="on">On (audit every claim after generation)</option>
            <option value="off">Off (faster, unverified)</option>
          </select>
          <p className="hint">
            Each claim is re-checked against the passages it cites. Unsupported
            and miscited claims are flagged in the answer.
          </p>
        </div>

        <div className="field">
          <label htmlFor="abstainThreshold">
            Abstain below {Math.round(settings.abstainThreshold * 100)}%
            retrieval confidence
          </label>
          <input
            id="abstainThreshold"
            type="range"
            min={0}
            max={0.9}
            step={0.05}
            value={settings.abstainThreshold}
            onChange={(e) =>
              update("abstainThreshold", Number(e.target.value))
            }
          />
          <p className="hint">
            Below the threshold KAI reports what it found and what is missing
            instead of generating an answer. Set to 0 to always answer.
          </p>
        </div>

        <h2 className="settings-section">Indexing</h2>

        <div className="field">
          <label htmlFor="chunkStrategy">Chunking strategy</label>
          <select
            id="chunkStrategy"
            value={settings.chunkStrategy}
            onChange={(e) =>
              update("chunkStrategy", e.target.value as ChunkStrategy)
            }
          >
            {CHUNK_STRATEGIES.map((strategy) => (
              <option key={strategy} value={strategy}>
                {strategy}
              </option>
            ))}
          </select>
          <p className="hint">{STRATEGY_DESCRIPTIONS[settings.chunkStrategy]}</p>
        </div>

        <div className="field">
          <label htmlFor="dedupe">Skip near-duplicate chunks</label>
          <select
            id="dedupe"
            value={settings.dedupe ? "on" : "off"}
            onChange={(e) => update("dedupe", e.target.value === "on")}
          >
            <option value="on">On (cosine &gt; 0.95 is skipped)</option>
            <option value="off">Off (index everything)</option>
          </select>
          <p className="hint">
            Stops repeated boilerplate across documents from crowding out the
            passages that answer the question.
          </p>
        </div>

        <h2 className="settings-section">Appearance</h2>

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
              setDraft(null);
              setSaved(false);
            }}
          >
            Clear API key
          </button>
          <Link href="/chat">Back to chat</Link>
          <Link href="/api-docs">API docs</Link>
        </div>
      </div>
    </main>
  );
}
