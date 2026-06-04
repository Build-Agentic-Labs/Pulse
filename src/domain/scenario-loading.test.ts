import { describe, expect, it } from "vitest";

import { mapScenarioSummary } from "./supabase-planner";

// mapScenarioSummary is the pure row->summary mapper behind loadScenariosForProduct (the data that
// feeds the scenario switcher tabs). Pin its defaults and field mapping so a schema/column rename or
// a null target can't silently produce broken tabs.

describe("mapScenarioSummary", () => {
  it("maps snake_case columns to the summary shape", () => {
    const summary = mapScenarioSummary({
      id: "scenario-2",
      name: "500/yr Projection",
      target_output: 500,
      target_output_period: "year",
      notes: "Copied from Main Plan on June 3, 2026",
      created_at: "2026-06-03T00:00:00.000Z",
    });

    expect(summary).toEqual({
      id: "scenario-2",
      name: "500/yr Projection",
      targetOutput: 500,
      targetOutputPeriod: "year",
      notes: "Copied from Main Plan on June 3, 2026",
      createdAt: "2026-06-03T00:00:00.000Z",
    });
  });

  it("applies safe defaults for missing/empty fields", () => {
    const summary = mapScenarioSummary({
      id: "scenario-main",
      created_at: "2026-06-01T00:00:00.000Z",
    });

    expect(summary.name).toBe("");
    expect(summary.targetOutput).toBe(1); // num(..., 1) default
    expect(summary.targetOutputPeriod).toBe("day");
    expect(summary.notes).toBeUndefined();
    expect(summary.id).toBe("scenario-main");
  });

  it("coerces a numeric-string target_output to a number", () => {
    const summary = mapScenarioSummary({
      id: "s",
      name: "n",
      target_output: "250",
      target_output_period: "month",
      created_at: "2026-06-02T00:00:00.000Z",
    });

    expect(summary.targetOutput).toBe(250);
    expect(typeof summary.targetOutput).toBe("number");
  });
});
