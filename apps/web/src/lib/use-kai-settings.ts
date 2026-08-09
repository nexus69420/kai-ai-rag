"use client";

import { useEffect, useState } from "react";

import { defaultSettings, loadSettings, type KaiSettings } from "./settings";

/**
 * Reads BYOK settings from `localStorage` and keeps them current.
 *
 * Storage is only readable after mount, so the first render returns the
 * defaults and hydration stays in sync with the server-rendered markup. The
 * `kai-settings` event (fired by `saveSettings`) propagates later edits made
 * anywhere in the app, which is what keeps the theme and the chat workspace
 * from drifting out of step with the settings page.
 */
export function useKaiSettings(): KaiSettings {
  const [settings, setSettings] = useState<KaiSettings>(defaultSettings);

  useEffect(() => {
    const sync = () => setSettings(loadSettings());
    sync();
    window.addEventListener("kai-settings", sync);
    return () => window.removeEventListener("kai-settings", sync);
  }, []);

  return settings;
}
