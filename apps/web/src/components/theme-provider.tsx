"use client";

import { useEffect, type ReactNode } from "react";

import { useKaiSettings } from "@/lib/use-kai-settings";

export function ThemeProvider({ children }: { children: ReactNode }) {
  const { theme } = useKaiSettings();

  // Mirrored onto <html> so full-bleed surfaces (scrollbars, overscroll) match.
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
  }, [theme]);

  return <div data-theme={theme}>{children}</div>;
}
