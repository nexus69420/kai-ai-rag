import { extractText, getDocumentProxy } from "unpdf";

export type PageText = {
  page: number;
  text: string;
};

function normalizePageText(raw: string) {
  return String(raw ?? "")
    .replace(/\r/g, "")
    // Keep line breaks (slide bullets); collapse only spaces/tabs
    .replace(/[ \t]+\n/g, "\n")
    .replace(/[ \t]{2,}/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export async function extractPdfPages(buffer: Buffer): Promise<PageText[]> {
  const pdf = await getDocumentProxy(new Uint8Array(buffer));
  const result = await extractText(pdf, { mergePages: false });
  const text = result.text as string | string[];
  const totalPages = result.totalPages;

  const pages: PageText[] = [];
  if (Array.isArray(text)) {
    text.forEach((pageText, index) => {
      const cleaned = normalizePageText(String(pageText ?? ""));
      if (cleaned) {
        pages.push({ page: index + 1, text: cleaned });
      }
    });
  } else {
    const cleaned = normalizePageText(String(text ?? ""));
    if (cleaned) {
      pages.push({ page: 1, text: cleaned });
    }
  }

  if (!pages.length) {
    throw new Error(
      totalPages
        ? "Could not extract text from this PDF (it may be scanned/image-only)."
        : "Invalid or empty PDF.",
    );
  }

  return pages;
}
