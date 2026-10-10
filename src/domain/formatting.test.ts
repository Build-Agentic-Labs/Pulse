import { describe, expect, it } from "vitest";

import {
  formatDate,
  formatDateControlled,
  formatDateTime,
  formatManHours,
  formatRelativeFromBounds,
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

describe("formatRelativeFromBounds", () => {
  it("formats minutes elapsed from the start bound", () => {
    const start = Date.parse("2026-01-01T08:00:00.000Z");
    expect(formatRelativeFromBounds("2026-01-01T09:30:00.000Z", start)).toBe("1h 30m");
  });
  it("returns n/a for unparseable input", () => {
    expect(formatRelativeFromBounds("not-a-date", 0)).toBe("n/a");
  });
});

// A bare YYYY-MM-DD is a calendar day, not an instant. `new Date("2026-07-15")` parses as UTC
// midnight, which renders as 07/14 anywhere west of Greenwich. The expectations below are built
// from a LOCAL-constructed date. Vitest pins America/Los_Angeles so the old parse fails west of
// UTC on every machine, including CI, where UTC would otherwise hide this regression.
describe("date-only input parses as a local calendar day", () => {
  const localJuly15 = new Date(2026, 6, 15).toISOString();

  it("runs in the pinned timezone west of UTC", () => {
    expect(Intl.DateTimeFormat().resolvedOptions().timeZone).toBe("America/Los_Angeles");
    expect(new Date(2026, 6, 15).getTimezoneOffset()).toBe(420);
  });

  it("formatDateControlled renders the chosen day", () => {
    expect(formatDateControlled("2026-07-15")).toBe(formatDateControlled(localJuly15));
    expect(formatDateControlled("2026-07-15")).toBe("07/15/2026");
  });

  it("formatDate renders the chosen day", () => {
    expect(formatDate("2026-07-15")).toBe(formatDate(localJuly15));
    expect(formatDate("2026-07-15")).toBe(new Date(2026, 6, 15).toLocaleDateString());
  });

  it("formatDateTime renders the chosen day at local midnight", () => {
    expect(formatDateTime("2026-07-15")).toBe(formatDateTime(localJuly15));
  });
});

describe("timestamp input keeps instant semantics", () => {
  const instant = "2026-07-15T12:00:00Z";
  const local = new Date(instant);

  it("formatDateControlled renders the local day of the instant", () => {
    const mm = String(local.getMonth() + 1).padStart(2, "0");
    const dd = String(local.getDate()).padStart(2, "0");
    expect(formatDateControlled(instant)).toBe(`${mm}/${dd}/${local.getFullYear()}`);
  });

  it("formatDate renders the local day of the instant", () => {
    expect(formatDate(instant)).toBe(local.toLocaleDateString());
  });

  it("formatDateTime renders the local date and time of the instant", () => {
    expect(formatDateTime(instant)).toBe(
      local.toLocaleString([], { year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }),
    );
  });
});

describe("invalid date input", () => {
  it("keeps each formatter's existing fallback", () => {
    expect(formatDateControlled("not-a-date")).toBe("not-a-date");
    expect(formatDate("not-a-date")).toBe("");
    expect(formatDate(null)).toBe("");
    expect(formatDateTime("not-a-date")).toBe("not-a-date");
  });
});
