import { describe, expect, it } from "vitest";
import { nextReminderAllowedAt, reminderCoolingDown } from "./reviewer-reminder";

describe("reviewer reminder cooldown", () => {
  it("allows the next reminder 24 hours after the last one", () => {
    expect(nextReminderAllowedAt("2026-09-23T10:00:00.000Z")).toBe("2026-09-24T10:00:00.000Z");
  });

  it("cools down until the window ends, then frees the button", () => {
    const next = "2026-09-24T10:00:00.000Z";
    expect(reminderCoolingDown(next, new Date("2026-09-24T09:59:59Z"))).toBe(true);
    expect(reminderCoolingDown(next, new Date("2026-09-24T10:00:00Z"))).toBe(false);
  });

  it("treats a missing or unreadable time as no cooldown", () => {
    const now = new Date("2026-09-24T10:00:00Z");
    expect(reminderCoolingDown(null, now)).toBe(false);
    expect(reminderCoolingDown(undefined, now)).toBe(false);
    expect(reminderCoolingDown("not a date", now)).toBe(false);
  });
});
