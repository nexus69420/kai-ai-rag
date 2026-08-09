/**
 * Format vocabulary shared by the uploader UI and the server loaders. Kept
 * dependency-free so a client component can validate a filename without
 * bundling the PDF parser.
 */
export type SourceType = "pdf" | "markdown" | "html" | "text";

export const SUPPORTED_EXTENSIONS = [
  ".pdf",
  ".md",
  ".markdown",
  ".mdx",
  ".html",
  ".htm",
  ".txt",
  ".text",
  ".rst",
] as const;

export const CONTENT_TYPES: Record<SourceType, string> = {
  pdf: "application/pdf",
  markdown: "text/markdown; charset=utf-8",
  html: "text/html; charset=utf-8",
  text: "text/plain; charset=utf-8",
};

export const FILE_EXTENSIONS: Record<SourceType, string> = {
  pdf: "pdf",
  markdown: "md",
  html: "html",
  text: "txt",
};

export function detectSourceType(filename: string): SourceType | null {
  const lower = filename.toLowerCase();
  if (lower.endsWith(".pdf")) return "pdf";
  if (/\.(md|markdown|mdx)$/.test(lower)) return "markdown";
  if (/\.(html?|xhtml)$/.test(lower)) return "html";
  if (/\.(txt|text|rst|log)$/.test(lower)) return "text";
  return null;
}

export function isSupportedFilename(filename: string) {
  return detectSourceType(filename) !== null;
}
