"use client";

import { useState } from "react";

import type { SourcePayload } from "@/lib/db/schema";

export function SourcesPanel({ sources }: { sources: SourcePayload[] }) {
  const [open, setOpen] = useState(false);
  const [preview, setPreview] = useState<string | null>(null);

  if (!sources?.length) return null;

  return (
    <div className="sources">
      <button
        type="button"
        className="source-toggle"
        onClick={() => setOpen((v) => !v)}
      >
        <span>{sources.length}</span>
        Retrieved passages
        <b>{open ? "−" : "+"}</b>
      </button>
      {open && (
        <div className="source-list">
          {sources.map((source, index) => {
            const key = `${source.documentId}-${source.page}-${index}`;
            const fileUrl = `/api/documents/${source.documentId}/file#page=${source.page}`;
            const showPreview = preview === key;
            return (
              <div className="source" key={key}>
                <div>
                  <span>
                    {source.filename} · page {source.page}
                  </span>
                  <strong>Source {index + 1}</strong>
                  {typeof source.score === "number" && (
                    <small>score {source.score.toFixed(3)}</small>
                  )}
                </div>
                <p>{source.text}</p>
                <div style={{ marginTop: 8, display: "flex", gap: 8 }}>
                  <button
                    type="button"
                    className="rename"
                    onClick={() => setPreview(showPreview ? null : key)}
                  >
                    {showPreview ? "Hide PDF" : "Preview page"}
                  </button>
                </div>
                {showPreview && (
                  <div className="pdf-preview">
                    <iframe title={`PDF page ${source.page}`} src={fileUrl} />
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
