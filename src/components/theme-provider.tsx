"use client";

import { createContext, useContext, useEffect, useMemo, useSyncExternalStore, type ReactNode } from "react";
import {
  APPEARANCE_STORAGE_KEY,
  applyAppearanceConfig,
  DEFAULT_APPEARANCE,
  DEFAULT_APPEARANCE_SNAPSHOT,
  normalizeAppearanceConfig,
  readAppearanceSnapshot,
  readThemeMode,
  serializeAppearanceConfig,
  THEME_STORAGE_KEY,
  type AppearanceColorKey,
  type AppearanceConfig,
  type AppearancePalette,
  type SurfaceMode,
  type ThemeMode,
} from "@/lib/theme-init";

export type { AppearanceColorKey, AppearanceConfig, AppearancePalette, SurfaceMode, ThemeMode };

type ThemeContextValue = {
  theme: ThemeMode;
  appearance: AppearanceConfig;
  setTheme: (theme: ThemeMode) => void;
  toggleTheme: () => void;
  setSurfaceMode: (mode: SurfaceMode) => void;
  setPaletteColor: (theme: ThemeMode, color: AppearanceColorKey, value: string) => void;
  applyThemePreset: (theme: ThemeMode, palette: AppearancePalette) => void;
  resetPalette: (theme: ThemeMode) => void;
  resetAppearance: () => void;
};

const ThemeContext = createContext<ThemeContextValue | null>(null);

function subscribeToAppearance(onStoreChange: () => void) {
  const observer = new MutationObserver(onStoreChange);

  observer.observe(document.documentElement, {
    attributes: true,
    attributeFilter: ["data-theme", "data-surface-mode", "data-appearance"],
  });

  window.addEventListener("storage", onStoreChange);

  return () => {
    observer.disconnect();
    window.removeEventListener("storage", onStoreChange);
  };
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const theme = useSyncExternalStore<ThemeMode>(subscribeToAppearance, readThemeMode, () => "light");
  const appearanceSnapshot = useSyncExternalStore(
    subscribeToAppearance,
    readAppearanceSnapshot,
    () => DEFAULT_APPEARANCE_SNAPSHOT,
  );
  const appearance = useMemo(
    () => normalizeAppearanceConfig(JSON.parse(appearanceSnapshot)),
    [appearanceSnapshot],
  );

  useEffect(() => {
    applyAppearanceConfig(appearance, theme);
  }, [appearance, theme]);

  function setTheme(next: ThemeMode) {
    document.documentElement.setAttribute("data-theme", next);
    applyAppearanceConfig(appearance, next);

    try {
      window.localStorage.setItem(THEME_STORAGE_KEY, next);
    } catch {
      // Ignore storage failures in private browsing.
    }
  }

  function commitAppearance(next: AppearanceConfig) {
    const normalized = applyAppearanceConfig(next, theme);
    try {
      window.localStorage.setItem(APPEARANCE_STORAGE_KEY, serializeAppearanceConfig(normalized));
    } catch {
      // Ignore storage failures in private browsing.
    }
  }

  function toggleTheme() {
    setTheme(theme === "light" ? "dark" : "light");
  }

  function setSurfaceMode(surfaceMode: SurfaceMode) {
    commitAppearance({ ...appearance, surfaceMode });
  }

  function setPaletteColor(targetTheme: ThemeMode, color: AppearanceColorKey, value: string) {
    commitAppearance({
      ...appearance,
      palettes: {
        ...appearance.palettes,
        [targetTheme]: {
          ...appearance.palettes[targetTheme],
          [color]: value,
        },
      },
    });
  }

  function applyThemePreset(targetTheme: ThemeMode, palette: AppearancePalette) {
    const next = normalizeAppearanceConfig({
      ...appearance,
      palettes: {
        ...appearance.palettes,
        [targetTheme]: { ...palette },
      },
    });

    document.documentElement.setAttribute("data-theme", targetTheme);
    applyAppearanceConfig(next, targetTheme);

    try {
      window.localStorage.setItem(THEME_STORAGE_KEY, targetTheme);
      window.localStorage.setItem(APPEARANCE_STORAGE_KEY, serializeAppearanceConfig(next));
    } catch {
      // Ignore storage failures in private browsing.
    }
  }

  function resetPalette(targetTheme: ThemeMode) {
    commitAppearance({
      ...appearance,
      palettes: {
        ...appearance.palettes,
        [targetTheme]: { ...DEFAULT_APPEARANCE.palettes[targetTheme] },
      },
    });
  }

  function resetAppearance() {
    commitAppearance({
      surfaceMode: DEFAULT_APPEARANCE.surfaceMode,
      palettes: {
        light: { ...DEFAULT_APPEARANCE.palettes.light },
        dark: { ...DEFAULT_APPEARANCE.palettes.dark },
      },
    });
  }

  return (
    <ThemeContext.Provider
      value={{
        theme,
        appearance,
        setTheme,
        toggleTheme,
        setSurfaceMode,
        setPaletteColor,
        applyThemePreset,
        resetPalette,
        resetAppearance,
      }}
    >
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme() {
  const context = useContext(ThemeContext);
  if (!context) throw new Error("useTheme must be used within ThemeProvider");
  return context;
}
