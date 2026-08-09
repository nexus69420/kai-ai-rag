"use client";

import ReactMarkdown from "react-markdown";
import rehypeKatex from "rehype-katex";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";

const CITATION_HREF = "#kai-source-";
const CITATION_RE = /\[(\d+(?:\s*,\s*\d+)*)\]/g;
const CODE_SPLIT_RE = /(```[\s\S]*?```|`[^`\n]*`)/g;

/**
 * Rewrites `[n]` markers into markdown links so they can render as interactive
 * chips. Code spans and fences are skipped, since `[0]` inside a snippet is
 * array indexing, not a citation.
 */
export function linkifyCitations(markdown: string): string {
  return markdown
    .split(CODE_SPLIT_RE)
    .map((segment) => {
      if (segment.startsWith("`")) return segment;
      return segment.replace(CITATION_RE, (_match, group: string) =>
        group
          .split(",")
          .map((part) => part.trim())
          .filter(Boolean)
          .map((n) => `[${n}](${CITATION_HREF}${n})`)
          .join(""),
      );
    })
    .join("");
}

export function AnswerMarkdown({
  content,
  sourceCount = 0,
  onCitationClick,
}: {
  content: string;
  sourceCount?: number;
  onCitationClick?: (citation: number) => void;
}) {
  return (
    <div className="answer-markdown">
      <ReactMarkdown
        remarkPlugins={[remarkGfm, remarkMath]}
        rehypePlugins={[rehypeKatex]}
        components={{
          a({ href, children, ...props }) {
            if (typeof href === "string" && href.startsWith(CITATION_HREF)) {
              const citation = Number(href.slice(CITATION_HREF.length));
              const invalid =
                !Number.isInteger(citation) ||
                citation < 1 ||
                (sourceCount > 0 && citation > sourceCount);

              return (
                <button
                  type="button"
                  className="citation-chip"
                  data-invalid={invalid ? "true" : undefined}
                  title={
                    invalid
                      ? `Source [${citation}] was not retrieved for this answer`
                      : `Jump to source [${citation}]`
                  }
                  onClick={() => onCitationClick?.(citation)}
                >
                  {citation}
                </button>
              );
            }

            return (
              <a href={href} target="_blank" rel="noreferrer" {...props}>
                {children}
              </a>
            );
          },
        }}
      >
        {linkifyCitations(content)}
      </ReactMarkdown>
    </div>
  );
}
