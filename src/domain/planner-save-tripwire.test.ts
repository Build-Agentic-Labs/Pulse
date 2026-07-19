import { describe, expect, it } from "vitest";

import { assertSaneStateDeletion } from "./supabase-planner";

// The data-loss tripwire (refactor plan §5): a truncated planner load followed by
// a save would silently hard-delete everything the load missed. These tests pin
// the guard's contract before the planner load moves server-side.

describe("assertSaneStateDeletion", () => {
  it("allows saves that delete nothing", () => {
    expect(() => assertSaneStateDeletion("tasks", 61, 0)).not.toThrow();
  });

  it("allows ordinary small deletions", () => {
    expect(() => assertSaneStateDeletion("tasks", 61, 5)).not.toThrow();
    expect(() => assertSaneStateDeletion("tasks", 10, 5)).not.toThrow(); // exactly half is allowed
  });

  it("refuses deleting more than half of an entity's rows", () => {
    expect(() => assertSaneStateDeletion("tasks", 61, 55)).toThrowError(/would delete 55 of 61 tasks/);
    expect(() => assertSaneStateDeletion("tasks", 10, 6)).toThrowError(/smaller batches/);
  });

  it("never fires on tiny row counts where fractions are meaningless", () => {
    // Deleting 3 of 4 zones is a normal edit, not a truncation signal.
    expect(() => assertSaneStateDeletion("zones", 4, 3)).not.toThrow();
    expect(() => assertSaneStateDeletion("zones", 1, 1)).not.toThrow();
    expect(() => assertSaneStateDeletion("zones", 0, 0)).not.toThrow();
  });

  it("fires at the minimum row count when the fraction is breached", () => {
    expect(() => assertSaneStateDeletion("stations", 5, 3)).toThrowError(/3 of 5 stations/);
  });
});
