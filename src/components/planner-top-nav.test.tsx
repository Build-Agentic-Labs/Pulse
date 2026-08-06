import { describe, expect, it } from "vitest";

import { plannerSaveStatus } from "./planner-top-nav";

describe("plannerSaveStatus", () => {
  it("keeps generic save errors out of the planner header", () => {
    expect(plannerSaveStatus("error")).toBeNull();
  });

  it("keeps actionable conflicts visible", () => {
    expect(plannerSaveStatus("conflict")).toEqual({ message: "Save conflict", error: true });
  });
});
