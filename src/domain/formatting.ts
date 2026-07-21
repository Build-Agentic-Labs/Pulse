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

/** Up to two uppercase initials for reviewer avatar chips ("Rosendo Lopez" → "RL"). */
export function reviewerInitials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return "?";
  return parts.slice(0, 2).map((part) => part[0]?.toUpperCase()).join("");
}

/**
 * Locale-aware date for UI surfaces (lists, tables, settings). Empty or invalid
 * input renders as "" — call sites wanting a placeholder use `formatDate(x) || "—"`.
 * Consolidates 7 previously divergent per-component copies that rendered the same
 * date differently on different screens.
 */
export function formatDate(iso: string | null | undefined): string {
  if (!iso) return "";
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? "" : date.toLocaleDateString();
}

/** Locale-aware date + time (2-digit date, hh:mm) for UI surfaces. */
export function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return "";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleString([], {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/**
 * Fixed MM/DD/YYYY for controlled documents (SOP print sheets, DOCX exports).
 * Deliberately locale-INDEPENDENT: a controlled document must render identically
 * on every machine. Do not "simplify" this into formatDate.
 */
export function formatDateControlled(iso: string): string {
  if (!iso) return "";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  const mm = String(date.getMonth() + 1).padStart(2, "0");
  const dd = String(date.getDate()).padStart(2, "0");
  return `${mm}/${dd}/${date.getFullYear()}`;
}
