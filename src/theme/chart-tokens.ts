/** Shared chart / Gantt colors — resolved from CSS --chart-* variables in globals.css */

export const chartPalette = {
  accent: "var(--chart-accent)",
  accentStroke: "var(--chart-accent-stroke)",
  accentHover: "var(--chart-accent-hover)",
  accentLight: "var(--chart-accent-light)",
  accentMuted: "var(--chart-accent-muted)",
  accentSubtle: "var(--chart-accent-subtle)",
  highlight: "var(--chart-highlight)",
  highlightStroke: "var(--chart-highlight-stroke)",
  warn: "var(--chart-warn)",
  warnStroke: "var(--chart-warn-stroke)",
  warnFill: "var(--chart-warn-fill)",
  warnText: "var(--chart-warn-text)",
  danger: "var(--chart-danger)",
  dangerStroke: "var(--chart-danger-stroke)",
  dangerFill: "var(--chart-danger-fill)",
  dangerText: "var(--chart-danger-text)",
  ink: "var(--chart-ink)",
  graphite: "var(--chart-graphite)",
  steel: "var(--chart-steel)",
  idle: "var(--chart-idle)",
  neutral: "var(--chart-neutral)",
  neutralStroke: "var(--chart-neutral-stroke)",
  grid: "var(--chart-grid)",
  canvas: "var(--chart-canvas)",
  canvasRaised: "var(--chart-canvas-raised)",
  band: "var(--chart-band)",
  bandAlt: "var(--chart-band-alt)",
  chartBg: "var(--chart-bg)",
  white: "var(--chart-contrast)",
  success: "var(--chart-success)",
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
