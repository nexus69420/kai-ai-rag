"use client";

import { useEffect, useState, type ReactNode } from "react";

import { loadSettings, type KaiSettings } from "@/lib/settings";

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setTheme] = useState<"light" | "dark">("light");

  useEffect(() => {
    const apply = () => {
      const settings = loadSettings();
      setTheme(settings.theme);
      document.documentElement.dataset.theme = settings.theme;
    };
    apply();
    window.addEventListener("kai-settings", apply);
    return () => window.removeEventListener("kai-settings", apply);
  }, []);

  return <div data-theme={theme}>{children}</div>;
}

export function useKaiSettings() {
  const [settings, setSettings] = useState<KaiSettings | null>(null);

  useEffect(() => {
    const sync = () => setSettings(loadSettings());
    sync();
    window.addEventListener("kai-settings", sync);
    return () => window.removeEventListener("kai-settings", sync);
  }, []);

  return settings;
}
