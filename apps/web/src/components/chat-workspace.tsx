"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { AnswerMarkdown } from "@/components/answer-markdown";
import { SourcesPanel } from "@/components/sources-panel";
import type { SourcePayload } from "@/lib/db/schema";
import { formatGeminiError } from "@/lib/gemini-errors";
import {
  defaultSettings,
  loadSettings,
  saveSettings,
  type KaiSettings,
} from "@/lib/settings";

type DocItem = {
  id: string;
  filename: string;
  chunkCount: number;
  status: string;
};

type ChatItem = {
  id: string;
  title: string;
  documentId: string | null;
  documentIds?: string[] | null;
};

type UiMessage = {
  id: string;
  role: "user" | "assistant" | "error";
  content: string;
  sources?: SourcePayload[];
};

const SUGGESTIONS = [
  "Summarize the key points of this document",
  "What are the main definitions or claims?",
  "List important numbers, dates, or metrics",
];

export function ChatWorkspace() {
  const [settings, setSettings] = useState<KaiSettings>(defaultSettings);
  const [documents, setDocuments] = useState<DocItem[]>([]);
  const [chats, setChats] = useState<ChatItem[]>([]);
  const [selectedChatId, setSelectedChatId] = useState<string | null>(null);
  /** Empty array = ask across all uploaded docs. */
  const [selectedDocIds, setSelectedDocIds] = useState<string[]>([]);
  const [messages, setMessages] = useState<UiMessage[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [status, setStatus] = useState("");
  const [renaming, setRenaming] = useState(false);
  const [renameValue, setRenameValue] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const renameInputRef = useRef<HTMLInputElement>(null);

  const scopeAll = selectedDocIds.length === 0;

  useEffect(() => {
    const sync = () => setSettings(loadSettings());
    sync();
    window.addEventListener("kai-settings", sync);
    return () => window.removeEventListener("kai-settings", sync);
  }, []);

  const refreshDocs = useCallback(async () => {
    const res = await fetch("/api/documents");
    const data = await res.json();
    setDocuments(data.documents ?? []);
  }, []);

  const refreshChats = useCallback(async () => {
    const res = await fetch("/api/chats");
    const data = await res.json();
    setChats(data.chats ?? []);
  }, []);

  useEffect(() => {
    void refreshDocs();
    void refreshChats();
  }, [refreshDocs, refreshChats]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, busy]);

  useEffect(() => {
    if (renaming) {
      renameInputRef.current?.focus();
      renameInputRef.current?.select();
    }
  }, [renaming]);

  const activeTitle = useMemo(() => {
    const chat = chats.find((c) => c.id === selectedChatId);
    return chat?.title ?? "Document chat";
  }, [chats, selectedChatId]);

  const scopeLabel = useMemo(() => {
    if (scopeAll) return "All uploaded documents";
    if (selectedDocIds.length === 1) {
      return (
        documents.find((d) => d.id === selectedDocIds[0])?.filename ??
        "1 document"
      );
    }
    return `${selectedDocIds.length} documents selected`;
  }, [scopeAll, selectedDocIds, documents]);

  function toggleDoc(docId: string) {
    setSelectedDocIds((prev) => {
      if (prev.includes(docId)) {
        return prev.filter((id) => id !== docId);
      }
      return [...prev, docId];
    });
  }

  function selectAllDocs() {
    setSelectedDocIds([]);
  }

  async function loadChat(chatId: string) {
    setSelectedChatId(chatId);
    setRenaming(false);
    const res = await fetch(`/api/chats/${chatId}`);
    const data = await res.json();
    if (!res.ok) return;
    const ids: string[] = Array.isArray(data.chat.documentIds)
      ? data.chat.documentIds
      : data.chat.documentId
        ? [data.chat.documentId]
        : [];
    setSelectedDocIds(ids);
    setMessages(
      (data.messages ?? []).map(
        (m: {
          id: string;
          role: string;
          content: string;
          sources?: SourcePayload[];
        }) => ({
          id: m.id,
          role: m.role === "assistant" ? "assistant" : "user",
          content: m.content,
          sources: m.sources ?? [],
        }),
      ),
    );
  }

  async function createChat() {
    const res = await fetch("/api/chats", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        title: "New chat",
        documentIds: selectedDocIds,
      }),
    });
    const data = await res.json();
    await refreshChats();
    if (data.chat?.id) {
      setSelectedChatId(data.chat.id);
      setMessages([]);
      setRenaming(false);
    }
  }

  async function deleteChat(chatId: string) {
    await fetch(`/api/chats/${chatId}`, { method: "DELETE" });
    if (selectedChatId === chatId) {
      setSelectedChatId(null);
      setMessages([]);
      setRenaming(false);
    }
    await refreshChats();
  }

  function startRename() {
    setRenameValue(activeTitle === "Document chat" ? "New chat" : activeTitle);
    setRenaming(true);
  }

  async function commitRename() {
    const title = renameValue.trim();
    if (!title) {
      setRenaming(false);
      return;
    }

    try {
      let chatId = selectedChatId;
      if (!chatId) {
        const res = await fetch("/api/chats", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            title,
            documentIds: selectedDocIds,
          }),
        });
        const data = await res.json();
        if (!res.ok || !data.chat?.id) {
          throw new Error(data.error || "Could not create chat to rename.");
        }
        chatId = data.chat.id as string;
        setSelectedChatId(chatId);
      } else {
        const res = await fetch(`/api/chats/${chatId}`, {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ title }),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
          throw new Error(data.error || "Rename failed.");
        }
      }
      setStatus(`Renamed to “${title}”`);
      await refreshChats();
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Rename failed.");
    } finally {
      setRenaming(false);
    }
  }

  async function deleteDocument(docId: string) {
    await fetch(`/api/documents/${docId}`, { method: "DELETE" });
    setSelectedDocIds((prev) => prev.filter((id) => id !== docId));
    await refreshDocs();
  }

  async function onUpload(file: File) {
    setUploading(true);
    setStatus(`Indexing ${file.name}…`);
    try {
      const form = new FormData();
      form.append("file", file);
      const res = await fetch("/api/upload", {
        method: "POST",
        headers: {
          ...(settings.apiKey ? { "x-api-key": settings.apiKey } : {}),
          "x-embedding-model": settings.embeddingModel,
        },
        body: form,
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Upload failed");
      setSelectedDocIds((prev) =>
        prev.includes(data.document_id) ? prev : [...prev, data.document_id],
      );
      setStatus(`Indexed ${data.total_chunks} chunks`);
      await refreshDocs();
    } catch (error) {
      setStatus(formatGeminiError(error));
    } finally {
      setUploading(false);
    }
  }

  function toggleTheme() {
    const next = {
      ...settings,
      theme: settings.theme === "dark" ? "light" : "dark",
    } as KaiSettings;
    saveSettings(next);
    setSettings(next);
  }

  async function sendMessage(text: string) {
    const question = text.trim();
    if (!question || busy) return;
    if (!documents.length) {
      setStatus("Upload a PDF first.");
      return;
    }

    setBusy(true);
    setInput("");
    setStatus(
      scopeAll
        ? "Searching all documents…"
        : `Searching ${selectedDocIds.length} selected document(s)…`,
    );
    const userMsg: UiMessage = {
      id: `u-${Date.now()}`,
      role: "user",
      content: question,
    };
    const assistantId = `a-${Date.now()}`;
    setMessages((prev) => [
      ...prev,
      userMsg,
      { id: assistantId, role: "assistant", content: "", sources: [] },
    ]);

    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          ...(settings.apiKey ? { "x-api-key": settings.apiKey } : {}),
        },
        body: JSON.stringify({
          question,
          chatId: selectedChatId,
          documentIds: selectedDocIds,
          scopeAll,
          chatModel: settings.chatModel,
          embeddingModel: settings.embeddingModel,
          temperature: settings.temperature,
          topK: settings.topK,
          rerank: settings.rerank,
          apiKey: settings.apiKey || undefined,
        }),
      });

      if (!res.ok || !res.body) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || "Chat request failed");
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";

        for (const line of lines) {
          if (!line.trim()) continue;
          const event = JSON.parse(line) as {
            type: string;
            chatId?: string;
            sources?: SourcePayload[];
            text?: string;
            error?: string;
          };

          if (event.type === "meta") {
            if (event.chatId) {
              setSelectedChatId(event.chatId);
              await refreshChats();
            }
            setStatus("");
            setMessages((prev) =>
              prev.map((m) =>
                m.id === assistantId
                  ? { ...m, sources: event.sources ?? [] }
                  : m,
              ),
            );
          } else if (event.type === "delta" && event.text) {
            setMessages((prev) =>
              prev.map((m) =>
                m.id === assistantId
                  ? { ...m, content: m.content + event.text }
                  : m,
              ),
            );
          } else if (event.type === "error") {
            throw new Error(event.error || "Stream error");
          }
        }
      }
    } catch (error) {
      setMessages((prev) =>
        prev.map((m) =>
          m.id === assistantId
            ? {
                id: m.id,
                role: "error",
                content: formatGeminiError(error),
              }
            : m,
        ),
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="app-shell" data-theme={settings.theme}>
      <aside className="sidebar">
        <div className="brand-row">
          <div className="brand-mark">K</div>
          KAI
        </div>

        <button type="button" className="new-chat" onClick={() => void createChat()}>
          + New chat
        </button>

        <input
          ref={fileRef}
          type="file"
          accept="application/pdf,.pdf"
          hidden
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) void onUpload(file);
            e.target.value = "";
          }}
        />
        <button
          type="button"
          className="upload-btn"
          disabled={uploading}
          onClick={() => fileRef.current?.click()}
        >
          {uploading ? "Indexing…" : "Upload PDF"}
        </button>

        <div className="sidebar-label">
          <span>Chats</span>
        </div>
        <div className="chat-list">
          {chats.map((chat) => (
            <div
              className={`chat-row ${selectedChatId === chat.id ? "active" : ""}`}
              key={chat.id}
            >
              <button type="button" onClick={() => void loadChat(chat.id)}>
                {chat.title}
              </button>
              <button
                type="button"
                className="delete-chat"
                onClick={() => void deleteChat(chat.id)}
              >
                ×
              </button>
            </div>
          ))}
        </div>

        <div className="sidebar-label">
          <span>Documents</span>
          <button
            type="button"
            className="sidebar-mini"
            onClick={selectAllDocs}
            title="Clear selection = search all docs"
          >
            {scopeAll ? "All" : "Use all"}
          </button>
        </div>
        <p className="sidebar-hint">Click to multi-select. Empty = all docs.</p>
        <div className="library">
          {documents.map((doc) => {
            const selected = selectedDocIds.includes(doc.id);
            return (
              <button
                type="button"
                key={doc.id}
                className={`doc-card ${selected ? "selected" : ""} ${scopeAll ? "all-scope" : ""}`}
                onClick={() => toggleDoc(doc.id)}
                onContextMenu={(e) => {
                  e.preventDefault();
                  if (window.confirm(`Delete ${doc.filename}?`)) {
                    void deleteDocument(doc.id);
                  }
                }}
              >
                <span className="doc-check">{selected ? "✓" : scopeAll ? "•" : ""}</span>
                <span className="doc-card-copy">
                  <strong>{doc.filename}</strong>
                  <small>
                    {doc.status} · {doc.chunkCount} chunks
                  </small>
                </span>
              </button>
            );
          })}
          {!documents.length && (
            <small style={{ color: "#9fb1ba", padding: "0 8px" }}>
              No PDFs yet. Upload to start.
            </small>
          )}
        </div>

        <div className="guest-card">
          <strong>Guest workspace</strong>
          <span>Chats & docs are kept for this browser session cookie.</span>
          <Link href="/settings">Settings / API keys →</Link>
        </div>
      </aside>

      <section className="conversation">
        <header className="conversation-header">
          <div>
            <div className="eyebrow">Knowledge Augmented Intelligence</div>
            {renaming ? (
              <form
                className="rename-form"
                onSubmit={(e) => {
                  e.preventDefault();
                  void commitRename();
                }}
              >
                <input
                  ref={renameInputRef}
                  value={renameValue}
                  onChange={(e) => setRenameValue(e.target.value)}
                  onBlur={() => void commitRename()}
                  onKeyDown={(e) => {
                    if (e.key === "Escape") setRenaming(false);
                  }}
                  placeholder="Chat title"
                />
              </form>
            ) : (
              <h1>{activeTitle}</h1>
            )}
          </div>
          <div className="header-actions">
            <button type="button" className="rename" onClick={startRename}>
              Rename
            </button>
            <Link className="settings-link" href="/settings">
              Settings
            </Link>
            <button type="button" className="theme-toggle" onClick={toggleTheme}>
              {settings.theme === "dark" ? "☀" : "☾"}
            </button>
          </div>
        </header>

        <div className="scope-bar">
          <span>Asking across</span>
          <strong className="scope-label">{scopeLabel}</strong>
          <button type="button" className="scope-chip" onClick={selectAllDocs}>
            All docs
          </button>
          {selectedDocIds.length > 0 && (
            <button
              type="button"
              className="scope-chip"
              onClick={() => setSelectedDocIds([])}
            >
              Clear selection
            </button>
          )}
          {status && <span>· {status}</span>}
        </div>

        {!!selectedDocIds.length && (
          <div className="scope-chips">
            {selectedDocIds.map((id) => {
              const doc = documents.find((d) => d.id === id);
              return (
                <button
                  type="button"
                  key={id}
                  className="scope-chip active"
                  onClick={() => toggleDoc(id)}
                  title="Remove from selection"
                >
                  {doc?.filename ?? id.slice(0, 8)} ×
                </button>
              );
            })}
          </div>
        )}

        <div className="messages">
          {!messages.length && (
            <div className="welcome">
              <p className="welcome-kicker">Your research desk</p>
              <h2>Upload a PDF. Ask anything inside it.</h2>
              <p>
                Select one or more documents in the sidebar, or leave none
                selected to search all uploads.
              </p>
              <div className="suggestions">
                {SUGGESTIONS.map((s) => (
                  <button key={s} type="button" onClick={() => void sendMessage(s)}>
                    {s}
                  </button>
                ))}
              </div>
            </div>
          )}

          {messages.map((message) => (
            <div className={`message ${message.role}`} key={message.id}>
              <div className="message-label">
                {message.role === "user"
                  ? "You"
                  : message.role === "error"
                    ? "Error"
                    : "KAI"}
              </div>
              {message.role === "user" ? (
                <p>{message.content}</p>
              ) : message.role === "error" ? (
                <div className="answer-markdown">{message.content}</div>
              ) : (
                <>
                  {message.content ? (
                    <AnswerMarkdown content={message.content} />
                  ) : (
                    busy && (
                      <div className="thinking">
                        <i />
                        <i />
                        <i />
                      </div>
                    )
                  )}
                  <SourcesPanel sources={message.sources ?? []} />
                </>
              )}
            </div>
          ))}
          <div ref={bottomRef} />
        </div>

        <form
          className="composer"
          onSubmit={(e) => {
            e.preventDefault();
            void sendMessage(input);
          }}
        >
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Ask about your documents…"
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                void sendMessage(input);
              }
            }}
          />
          <div>
            <span>
              {settings.chatModel} · topK {settings.topK}
              {settings.rerank ? " · rerank on" : " · rerank off"}
              {!settings.apiKey ? " · using server key fallback if set" : ""}
            </span>
            <button type="submit" disabled={busy || !input.trim()}>
              {busy ? "Thinking…" : "Ask"}
            </button>
          </div>
        </form>
      </section>
    </div>
  );
}
