/** Shared chart / Gantt colors — keep in sync with CSS --chart-* variables in globals.css */

export const chartPalette = {
  accent: "#ffffff",
  accentStroke: "#e8e8e8",
  accentHover: "#cccccc",
  accentLight: "#999999",
  accentMuted: "#333333",
  accentSubtle: "#1a1a1a",
  highlight: "#ffffff",
  highlightStroke: "#e8e8e8",
  warn: "#d4a843",
  warnStroke: "#b8923a",
  warnFill: "#1a1a1a",
  warnText: "#d4a843",
  danger: "#d71921",
  dangerStroke: "#b9151c",
  dangerFill: "rgba(215, 25, 33, 0.15)",
  dangerText: "#d71921",
  ink: "#e8e8e8",
  graphite: "#ffffff",
  steel: "#999999",
  idle: "#666666",
  neutral: "#222222",
  neutralStroke: "#333333",
  grid: "#222222",
  canvas: "#000000",
  canvasRaised: "#111111",
  band: "#1a1a1a",
  bandAlt: "#111111",
  chartBg: "#000000",
  white: "#ffffff",
  success: "#4a9e5c",
} as const;

export type ChartTone = { fill: string; stroke: string; text: string };

export const UNZONED_COLOR = chartPalette.steel;

export const TAKT_EXCEEDED_TONE: ChartTone = {
  fill: chartPalette.danger,
  stroke: chartPalette.dangerStroke,
  text: chartPalette.white,
};

export const TAKT_FLAG_INPUT_CLASS =
  "border-danger bg-danger-muted text-danger";

export function taskTone(state: string, task: { rowType?: string }): ChartTone {
  if (state === "complete") {
    return { fill: chartPalette.accent, stroke: chartPalette.accentStroke, text: chartPalette.canvas };
  }

  if (state === "in_progress") {
    return { fill: chartPalette.accentLight, stroke: chartPalette.accentStroke, text: chartPalette.white };
  }

  if (state === "blocked") {
    return { fill: chartPalette.dangerFill, stroke: chartPalette.danger, text: chartPalette.dangerText };
  }

  if (state === "ready") {
    return { fill: chartPalette.accentSubtle, stroke: chartPalette.accentMuted, text: chartPalette.accent };
  }

  if (task.rowType === "milestone") {
    return { fill: chartPalette.steel, stroke: chartPalette.neutralStroke, text: chartPalette.white };
  }

  return { fill: chartPalette.neutral, stroke: chartPalette.neutralStroke, text: chartPalette.ink };
}

export function groupTone(state: string): ChartTone {
  if (state === "complete") {
    return { fill: chartPalette.accent, stroke: chartPalette.accentStroke, text: chartPalette.canvas };
  }

  if (state === "in_progress") {
    return { fill: chartPalette.accent, stroke: chartPalette.accentStroke, text: chartPalette.canvas };
  }

  if (state === "ready") {
    return { fill: chartPalette.accentSubtle, stroke: chartPalette.accentMuted, text: chartPalette.accent };
  }

  return { fill: chartPalette.idle, stroke: chartPalette.neutralStroke, text: chartPalette.white };
}

export const zoneDefaultFill = chartPalette.bandAlt;
