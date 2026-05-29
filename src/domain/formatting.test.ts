import { describe, expect, it } from "vitest";

import {
  formatManHours,
  formatRelativeFromBounds,
  formatSignedMinutes,
  markdownCell,
  periodLabel,
  safeNumber,
  statusLabel,
} from "./formatting";

describe("safeNumber", () => {
  it("parses numeric strings", () => {
    expect(safeNumber("42")).toBe(42);
    expect(safeNumber("3.5")).toBe(3.5);
  });
  it("falls back for non-numeric input", () => {
    expect(safeNumber("abc")).toBe(0);
    expect(safeNumber("abc", 7)).toBe(7);
    expect(safeNumber("")).toBe(0); // Number("") === 0, finite
  });
});

describe("statusLabel", () => {
  it("replaces all underscores with spaces", () => {
    expect(statusLabel("in_progress")).toBe("in progress");
    expect(statusLabel("qc_hold_now")).toBe("qc hold now");
  });
});

describe("formatManHours", () => {
  it("rounds to one decimal and appends MH", () => {
    expect(formatManHours(12.34)).toBe("12.3 MH");
    expect(formatManHours(10)).toBe("10 MH");
  });
});

describe("periodLabel", () => {
  it("maps known demand periods", () => {
    expect(periodLabel("week")).toBe("week");
    expect(periodLabel("month")).toBe("month");
    expect(periodLabel("year")).toBe("year");
    expect(periodLabel("day")).toBe("day");
    expect(periodLabel("shift")).toBe("shift");
  });
  it("falls back to 'period' for custom", () => {
    expect(periodLabel("custom")).toBe("period");
  });
});

describe("markdownCell", () => {
  it("escapes pipes and flattens newlines", () => {
    expect(markdownCell("a | b\nc")).toBe("a \\| b c");
  });
  it("stringifies nullish to empty", () => {
    expect(markdownCell(null)).toBe("");
    expect(markdownCell(undefined)).toBe("");
    expect(markdownCell(0)).toBe("0");
  });
});

describe("formatSignedMinutes", () => {
  it("renders 0m within +/- 1 minute", () => {
    expect(formatSignedMinutes(0)).toBe("0m");
    expect(formatSignedMinutes(0.4)).toBe("0m");
  });
  it("prefixes sign for positive and negative", () => {
    expect(formatSignedMinutes(90)).toBe("+1h 30m");
    expect(formatSignedMinutes(-45)).toBe("-45m");
  });
});

describe("formatRelativeFromBounds", () => {
  it("formats minutes elapsed from the start bound", () => {
    const start = Date.parse("2026-01-01T08:00:00.000Z");
    expect(formatRelativeFromBounds("2026-01-01T09:30:00.000Z", start)).toBe("1h 30m");
  });
  it("returns n/a for unparseable input", () => {
    expect(formatRelativeFromBounds("not-a-date", 0)).toBe("n/a");
  });
});
