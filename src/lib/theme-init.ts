export const THEME_STORAGE_KEY = "pulse-theme";
export const APPEARANCE_STORAGE_KEY = "pulse-appearance-v1";

export type ThemeMode = "light" | "dark";
export type SurfaceMode = "standard" | "flipped";
export type AppearanceColorKey = "canvas" | "surface" | "raised" | "accent";
export type AppearancePalette = Record<AppearanceColorKey, string>;
export type AppearanceConfig = {
  surfaceMode: SurfaceMode;
  palettes: Record<ThemeMode, AppearancePalette>;
};

export const DEFAULT_APPEARANCE: AppearanceConfig = {
  surfaceMode: "flipped",
  palettes: {
    light: {
      canvas: "#f5f5f5",
      surface: "#ffffff",
      raised: "#f0f0f0",
      accent: "#000000",
    },
    dark: {
      canvas: "#000000",
      surface: "#111111",
      raised: "#1a1a1a",
      accent: "#ffffff",
    },
  },
};

const HEX_COLOR = /^#[0-9a-f]{6}$/i;
export const DEFAULT_APPEARANCE_SNAPSHOT = JSON.stringify(DEFAULT_APPEARANCE);

function normalizeColor(value: unknown, fallback: string): string {
  return typeof value === "string" && HEX_COLOR.test(value) ? value.toLowerCase() : fallback;
}

function normalizePalette(value: unknown, fallback: AppearancePalette): AppearancePalette {
  const palette = value && typeof value === "object" ? value as Partial<AppearancePalette> : {};
  return {
    canvas: normalizeColor(palette.canvas, fallback.canvas),
    surface: normalizeColor(palette.surface, fallback.surface),
    raised: normalizeColor(palette.raised, fallback.raised),
    accent: normalizeColor(palette.accent, fallback.accent),
  };
}

export function normalizeAppearanceConfig(value: unknown): AppearanceConfig {
  const config = value && typeof value === "object" ? value as Partial<AppearanceConfig> : {};
  const palettes: Partial<Record<ThemeMode, Partial<AppearancePalette>>> =
    config.palettes && typeof config.palettes === "object" ? config.palettes : {};
  return {
    surfaceMode: config.surfaceMode === "standard" ? "standard" : "flipped",
    palettes: {
      light: normalizePalette(palettes.light, DEFAULT_APPEARANCE.palettes.light),
      dark: normalizePalette(palettes.dark, DEFAULT_APPEARANCE.palettes.dark),
    },
  };
}

export function serializeAppearanceConfig(config: AppearanceConfig): string {
  return JSON.stringify(normalizeAppearanceConfig(config));
}

export function readThemeMode(): ThemeMode {
  if (typeof window === "undefined") return "light";

  try {
    const stored = window.localStorage.getItem(THEME_STORAGE_KEY);
    if (stored === "dark" || stored === "light") return stored;
  } catch {
    // Ignore storage failures in private browsing.
  }

  return document.documentElement.getAttribute("data-theme") === "dark" ? "dark" : "light";
}

export function readAppearanceConfig(): AppearanceConfig {
  if (typeof window === "undefined") return DEFAULT_APPEARANCE;

  try {
    const stored = window.localStorage.getItem(APPEARANCE_STORAGE_KEY);
    if (stored) return normalizeAppearanceConfig(JSON.parse(stored));
  } catch {
    // Ignore malformed or unavailable storage.
  }

  const attribute = document.documentElement.getAttribute("data-appearance");
  if (attribute) {
    try {
      return normalizeAppearanceConfig(JSON.parse(attribute));
    } catch {
      // Fall through to defaults.
    }
  }

  return DEFAULT_APPEARANCE;
}

export function readAppearanceSnapshot(): string {
  if (typeof window === "undefined") return DEFAULT_APPEARANCE_SNAPSHOT;
  return serializeAppearanceConfig(readAppearanceConfig());
}

export function applyAppearanceConfig(config: AppearanceConfig, theme: ThemeMode): AppearanceConfig {
  const normalized = normalizeAppearanceConfig(config);
  if (typeof document === "undefined") return normalized;

  const root = document.documentElement;
  const snapshot = serializeAppearanceConfig(normalized);
  const palette = normalized.palettes[theme];

  if (root.getAttribute("data-surface-mode") !== normalized.surfaceMode) {
    root.setAttribute("data-surface-mode", normalized.surfaceMode);
  }
  if (root.getAttribute("data-appearance") !== snapshot) {
    root.setAttribute("data-appearance", snapshot);
  }
  root.style.setProperty("--appearance-canvas", palette.canvas);
  root.style.setProperty("--appearance-surface", palette.surface);
  root.style.setProperty("--appearance-raised", palette.raised);
  root.style.setProperty("--appearance-accent", palette.accent);

  return normalized;
}

const inlineDefault = JSON.stringify(DEFAULT_APPEARANCE);

export const themeInitScript = `(function(){try{var r=document.documentElement,d=${inlineDefault},t=localStorage.getItem("${THEME_STORAGE_KEY}");if(t!=="dark"&&t!=="light")t="light";var raw=localStorage.getItem("${APPEARANCE_STORAGE_KEY}"),v=raw?JSON.parse(raw):d,h=function(x,f){return typeof x==="string"&&/^#[0-9a-f]{6}$/i.test(x)?x.toLowerCase():f},m=v&&v.surfaceMode==="standard"?"standard":"flipped",ps=v&&v.palettes||{},lp=ps.light||{},dp=ps.dark||{},a={surfaceMode:m,palettes:{light:{canvas:h(lp.canvas,d.palettes.light.canvas),surface:h(lp.surface,d.palettes.light.surface),raised:h(lp.raised,d.palettes.light.raised),accent:h(lp.accent,d.palettes.light.accent)},dark:{canvas:h(dp.canvas,d.palettes.dark.canvas),surface:h(dp.surface,d.palettes.dark.surface),raised:h(dp.raised,d.palettes.dark.raised),accent:h(dp.accent,d.palettes.dark.accent)}}},p=a.palettes[t];r.setAttribute("data-theme",t);r.setAttribute("data-surface-mode",m);r.setAttribute("data-appearance",JSON.stringify(a));r.style.setProperty("--appearance-canvas",p.canvas);r.style.setProperty("--appearance-surface",p.surface);r.style.setProperty("--appearance-raised",p.raised);r.style.setProperty("--appearance-accent",p.accent)}catch(e){}})();`;
