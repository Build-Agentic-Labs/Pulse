import { formatMinutes, round } from "./calculations";
import type { DemandPeriod } from "./types";

/**
 * Pure display/formatting helpers extracted from line-workspace.tsx.
 * Each is a deterministic value-in/string-out function with no side effects.
 */

export function safeNumber(value: string, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export function statusLabel(value: string) {
  return value.replaceAll("_", " ");
}

export function formatManHours(value: number) {
  return `${round(value, 1)} MH`;
}

export function periodLabel(period: DemandPeriod) {
  return period === "week"
    ? "week"
    : period === "month"
      ? "month"
      : period === "year"
        ? "year"
        : period === "day"
          ? "day"
          : period === "shift"
            ? "shift"
            : "period";
}

export function markdownCell(value: unknown) {
  return String(value ?? "")
    .replaceAll("|", "\\|")
    .replaceAll("\n", " ")
    .trim();
}

export function formatSignedMinutes(minutes: number) {
  if (Math.abs(minutes) < 1) {
    return "0m";
  }

  const prefix = minutes > 0 ? "+" : "-";
  return `${prefix}${formatMinutes(Math.abs(minutes))}`;
}

export function formatRelativeFromBounds(iso: string, startMs: number) {
  const valueMs = Date.parse(iso);
  if (!Number.isFinite(valueMs)) {
    return "n/a";
  }

  return formatMinutes((valueMs - startMs) / 60000);
}
