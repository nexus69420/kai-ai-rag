"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { AnswerMarkdown } from "@/components/answer-markdown";
import { ConfidencePanel } from "@/components/confidence-panel";
import { RetrievalCompare } from "@/components/retrieval-compare";
import { SourcesPanel } from "@/components/sources-panel";
import { CHUNK_STRATEGIES } from "@/lib/chunking";
import type { ChunkStrategy } from "@/lib/chunking/types";
import type {
  CitationReport,
  ConfidenceReport,
  RetrievalStats,
  SourcePayload,
} from "@/lib/db/schema";
import { formatGeminiError } from "@/lib/gemini-errors";
import { SUPPORTED_EXTENSIONS } from "@/lib/formats";
import { saveSettings } from "@/lib/settings";
import { useKaiSettings } from "@/lib/use-kai-settings";

type DocItem = {
  id: string;
  filename: string;
  sourceType?: string;
  chunkStrategy?: string;
  chunkCount: number;
  duplicateChunks?: number;
  pageCount?: number;
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
  stats?: RetrievalStats;
  citations?: CitationReport;
  confidence?: ConfidenceReport;
  abstained?: boolean;
};

const SUGGESTIONS = [
  "Summarize the key points of this document",
  "What are the main definitions or claims?",
  "List important numbers, dates, or metrics",
];

const ACCEPT = SUPPORTED_EXTENSIONS.join(",");

export function ChatWorkspace() {
  const settings = useKaiSettings();
  const [documents, setDocuments] = useState<DocItem[]>([]);
  const [chats, setChats] = useState<ChatItem[]>([]);
  const [selectedChatId, setSelectedChatId] = useState<string | null>(null);
  /** Empty array = ask across all indexed docs. */
  const [selectedDocIds, setSelectedDocIds] = useState<string[]>([]);
  const [messages, setMessages] = useState<UiMessage[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [status, setStatus] = useState("");
  const [toast, setToast] = useState<{
    id: number;
    message: string;
    actionLabel?: string;
  } | null>(null);
  const [renaming, setRenaming] = useState(false);
  const [renameValue, setRenameValue] = useState("");
  const [focusedCitation, setFocusedCitation] = useState<{
    messageId: string;
    citation: number;
    /** Distinguishes repeat clicks on the same chip. */
    seq: number;
  } | null>(null);
  const [openSources, setOpenSources] = useState<Record<string, boolean>>({});
  const [comparing, setComparing] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const renameInputRef = useRef<HTMLInputElement>(null);
  const toastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const scopeAll = selectedDocIds.length === 0;

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

  useEffect(() => {
    return () => {
      if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    };
  }, []);

  function showToast(message: string, actionLabel?: string) {
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    setToast({ id: Date.now(), message, actionLabel });
    toastTimerRef.current = setTimeout(() => setToast(null), 4200);
  }

  function dismissToast() {
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    setToast(null);
  }

  const activeTitle = useMemo(() => {
    const chat = chats.find((c) => c.id === selectedChatId);
    return chat?.title ?? "Document chat";
  }, [chats, selectedChatId]);

  const scopeLabel = useMemo(() => {
    if (scopeAll) return "All indexed documents";
    if (selectedDocIds.length === 1) {
      return (
        documents.find((d) => d.id === selectedDocIds[0])?.filename ??
        "1 document"
      );
    }
    return `${selectedDocIds.length} documents selected`;
  }, [scopeAll, selectedDocIds, documents]);

  const lastQuestion = useMemo(
    () => [...messages].reverse().find((m) => m.role === "user")?.content ?? "",
    [messages],
  );

  function toggleDoc(docId: string) {
    setSelectedDocIds((prev) =>
      prev.includes(docId)
        ? prev.filter((id) => id !== docId)
        : [...prev, docId],
    );
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
          retrievalStats?: RetrievalStats;
          citations?: CitationReport;
          confidence?: ConfidenceReport;
          abstained?: string | null;
        }) => ({
          id: m.id,
          role: m.role === "assistant" ? "assistant" : "user",
          content: m.content,
          sources: m.sources ?? [],
          stats: m.retrievalStats ?? undefined,
          citations: m.citations ?? undefined,
          confidence: m.confidence ?? undefined,
          abstained: m.abstained === "yes",
        }),
      ),
    );
  }

  async function createChat() {
    const res = await fetch("/api/chats", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ title: "New chat", documentIds: selectedDocIds }),
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
          body: JSON.stringify({ title, documentIds: selectedDocIds }),
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
        if (!res.ok) throw new Error(data.error || "Rename failed.");
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

  async function deleteAllDocuments() {
    if (!documents.length) return;
    if (
      !window.confirm(
        `Delete all ${documents.length} document${documents.length === 1 ? "" : "s"}? This cannot be undone.`,
      )
    ) {
      return;
    }
    await Promise.all(
      documents.map((doc) =>
        fetch(`/api/documents/${doc.id}`, { method: "DELETE" }),
      ),
    );
    setSelectedDocIds([]);
    await refreshDocs();
    setStatus("All documents deleted.");
  }

  async function reindexDocument(docId: string, strategy: ChunkStrategy) {
    setStatus(`Re-indexing with ${strategy} chunking…`);
    try {
      const res = await fetch(`/api/documents/${docId}/reindex`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          ...(settings.apiKey ? { "x-api-key": settings.apiKey } : {}),
        },
        body: JSON.stringify({
          chunkStrategy: strategy,
          embeddingModel: settings.embeddingModel,
          dedupe: settings.dedupe,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Re-index failed");
      setStatus(`${data.message} · ${data.total_chunks} chunks`);
      await refreshDocs();
    } catch (error) {
      setStatus(formatGeminiError(error));
    }
  }

  async function onUpload(file: File) {
    setUploading(true);
    setStatus(`Indexing ${file.name}…`);
    try {
      const form = new FormData();
      form.append("file", file);
      form.append("chunkStrategy", settings.chunkStrategy);
      form.append("dedupe", settings.dedupe ? "true" : "false");

      const res = await fetch("/api/upload", {
        method: "POST",
        headers: {
          ...(settings.apiKey ? { "x-api-key": settings.apiKey } : {}),
          "x-embedding-model": settings.embeddingModel,
        },
        body: form,
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Indexing failed");

      setSelectedDocIds((prev) =>
        prev.includes(data.document_id) ? prev : [...prev, data.document_id],
      );
      setStatus(`${data.message} · ${data.chunk_strategy} chunking`);
      await refreshDocs();
    } catch (error) {
      setStatus(formatGeminiError(error));
    } finally {
      setUploading(false);
    }
  }

  /** Clicking a [n] chip expands that message's passage list and jumps to it. */
  function focusSource(messageId: string, citation: number) {
    setFocusedCitation((prev) => ({
      messageId,
      citation,
      seq: (prev?.seq ?? 0) + 1,
    }));
    setOpenSources((prev) => ({ ...prev, [messageId]: true }));
  }

  function toggleTheme() {
    // saveSettings fires `kai-settings`, which flows back through useKaiSettings.
    saveSettings({
      ...settings,
      theme: settings.theme === "dark" ? "light" : "dark",
    });
  }

  async function sendMessage(text: string) {
    const question = text.trim();
    if (!question || busy) return;
    if (!documents.length) {
      showToast("Upload a document first to start asking.", "Upload");
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

    const patch = (updater: (message: UiMessage) => UiMessage) =>
      setMessages((prev) =>
        prev.map((m) => (m.id === assistantId ? updater(m) : m)),
      );

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
          retrievalMode: settings.retrievalMode,
          denseWeight: settings.denseWeight,
          sparseWeight: settings.sparseWeight,
          verifyCitations: settings.verifyCitations,
          abstainThreshold: settings.abstainThreshold,
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
            stats?: RetrievalStats;
            citations?: CitationReport;
            confidence?: ConfidenceReport;
            abstained?: boolean;
            text?: string;
            error?: string;
          };

          if (event.type === "meta") {
            if (event.chatId) {
              setSelectedChatId(event.chatId);
              await refreshChats();
            }
            setStatus("");
            patch((m) => ({
              ...m,
              sources: event.sources ?? [],
              stats: event.stats,
            }));
          } else if (event.type === "delta" && event.text) {
            patch((m) => ({ ...m, content: m.content + event.text }));
          } else if (event.type === "verification") {
            setStatus("Verifying citations…");
            patch((m) => ({ ...m, citations: event.citations }));
          } else if (event.type === "confidence") {
            setStatus("");
            patch((m) => ({
              ...m,
              confidence: event.confidence,
              abstained: event.abstained,
            }));
          } else if (event.type === "error") {
            throw new Error(event.error || "Stream error");
          }
        }
      }
    } catch (error) {
      patch((m) => ({
        id: m.id,
        role: "error",
        content: formatGeminiError(error),
      }));
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
          accept={ACCEPT}
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
          {uploading ? "Indexing…" : "Index a document"}
        </button>
        <p className="sidebar-hint">PDF, Markdown, HTML, or text.</p>

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
          <span>Corpus</span>
          <div className="sidebar-label-actions">
            {!!documents.length && (
              <button
                type="button"
                className="sidebar-mini danger"
                onClick={() => void deleteAllDocuments()}
                title="Delete all indexed documents"
              >
                Delete all
              </button>
            )}
            <button
              type="button"
              className="sidebar-mini"
              onClick={selectAllDocs}
              title="Clear selection = search everything"
            >
              {scopeAll ? "All" : "Use all"}
            </button>
          </div>
        </div>
        <p className="sidebar-hint">Click to multi-select. Empty = all docs.</p>

        <div className="library">
          {documents.map((doc) => {
            const selected = selectedDocIds.includes(doc.id);
            return (
              <div
                key={doc.id}
                className={`doc-card ${selected ? "selected" : ""} ${scopeAll ? "all-scope" : ""}`}
              >
                <button
                  type="button"
                  className="doc-card-main"
                  onClick={() => toggleDoc(doc.id)}
                >
                  <span className="doc-check">
                    {selected ? "✓" : scopeAll ? "•" : ""}
                  </span>
                  <span className="doc-card-copy">
                    <strong>{doc.filename}</strong>
                    <small>
                      {doc.status} · {doc.chunkCount} chunks
                      {doc.duplicateChunks
                        ? ` · ${doc.duplicateChunks} dupes skipped`
                        : ""}
                    </small>
                    <small>
                      {doc.sourceType ?? "pdf"} · {doc.chunkStrategy ?? "structural"}
                    </small>
                  </span>
                </button>
                <select
                  className="doc-strategy"
                  value={doc.chunkStrategy ?? "structural"}
                  title="Re-chunk this document"
                  onChange={(e) =>
                    void reindexDocument(doc.id, e.target.value as ChunkStrategy)
                  }
                >
                  {CHUNK_STRATEGIES.map((strategy) => (
                    <option key={strategy} value={strategy}>
                      {strategy}
                    </option>
                  ))}
                </select>
                <button
                  type="button"
                  className="doc-delete"
                  title={`Delete ${doc.filename}`}
                  aria-label={`Delete ${doc.filename}`}
                  onClick={() => {
                    if (window.confirm(`Delete ${doc.filename}?`)) {
                      void deleteDocument(doc.id);
                    }
                  }}
                >
                  <svg viewBox="0 0 24 24" fill="none" aria-hidden>
                    <path
                      d="M9 3h6m-9 4h12m-1.5 0-.7 12.1a2 2 0 0 1-2 1.9H9.2a2 2 0 0 1-2-1.9L6.5 7"
                      stroke="currentColor"
                      strokeWidth="1.8"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                    <path
                      d="M10 11v6M14 11v6"
                      stroke="currentColor"
                      strokeWidth="1.8"
                      strokeLinecap="round"
                    />
                  </svg>
                </button>
              </div>
            );
          })}
          {!documents.length && (
            <small className="library-empty">
              Nothing indexed yet. Add a document to start.
            </small>
          )}
        </div>

        <div className="guest-card">
          <strong>Guest workspace</strong>
          <span>Chats and corpus are kept for this browser session cookie.</span>
          <Link href="/settings">Settings / API keys →</Link>
          <Link href="/api-docs">API reference →</Link>
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
            <button
              type="button"
              className="rename"
              onClick={() => setComparing(true)}
              disabled={!documents.length}
            >
              Compare retrieval
            </button>
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
              <h2>Index your docs. Ask anything inside them.</h2>
              <p>
                Answers cite the exact passages they came from, every citation is
                audited, and low-confidence questions get an honest report
                instead of a guess.
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
                    <AnswerMarkdown
                      content={message.content}
                      sourceCount={message.sources?.length ?? 0}
                      onCitationClick={(citation) => focusSource(message.id, citation)}
                    />
                  ) : (
                    busy && (
                      <div className="thinking">
                        <i />
                        <i />
                        <i />
                      </div>
                    )
                  )}

                  <ConfidencePanel
                    confidence={message.confidence}
                    citations={message.citations}
                    stats={message.stats}
                    abstained={message.abstained}
                  />

                  <SourcesPanel
                    sources={message.sources ?? []}
                    citations={message.citations}
                    focused={
                      focusedCitation?.messageId === message.id
                        ? focusedCitation.citation
                        : null
                    }
                    focusSeq={
                      focusedCitation?.messageId === message.id
                        ? focusedCitation.seq
                        : 0
                    }
                    open={Boolean(openSources[message.id])}
                    onToggle={() =>
                      setOpenSources((prev) => ({
                        ...prev,
                        [message.id]: !prev[message.id],
                      }))
                    }
                  />
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
          {toast && (
            <div
              key={toast.id}
              className="kai-toast"
              role="status"
              aria-live="polite"
            >
              <span className="kai-toast-dot" aria-hidden />
              <p>{toast.message}</p>
              {toast.actionLabel && (
                <button
                  type="button"
                  className="kai-toast-action"
                  onClick={() => {
                    dismissToast();
                    fileRef.current?.click();
                  }}
                >
                  {toast.actionLabel}
                </button>
              )}
              <button
                type="button"
                className="kai-toast-close"
                aria-label="Dismiss"
                onClick={dismissToast}
              >
                ×
              </button>
            </div>
          )}
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
              {settings.chatModel} · {settings.retrievalMode} · topK{" "}
              {settings.topK}
              {settings.rerank ? " · rerank" : ""}
              {settings.verifyCitations ? " · verified" : ""}
            </span>
            <button type="submit" disabled={busy || !input.trim()}>
              {busy ? "Thinking…" : "Ask"}
            </button>
          </div>
        </form>
      </section>

      {comparing && (
        <RetrievalCompare
          settings={settings}
          documentIds={selectedDocIds}
          initialQuestion={lastQuestion || input}
          onClose={() => setComparing(false)}
        />
      )}
    </div>
  );
}
