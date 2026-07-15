import type { Metadata } from "next";

import { ThemeProvider } from "@/components/theme-provider";
import "./globals.css";

export const metadata: Metadata = {
  title: "KAI | Knowledge Augmented Intelligence",
  description:
    "Upload PDFs and ask grounded questions with hybrid RAG, streaming answers, and bring-your-own Gemini key.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body>
        <ThemeProvider>{children}</ThemeProvider>
      </body>
    </html>
  );
}
