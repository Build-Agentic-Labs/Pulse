import { describe, expect, it } from "vitest";
import { createEmptySop } from "@/domain/sop/schema";
import { searchSop } from "./search";

describe("searchSop", () => {
  it("finds matching content across hidden builder sections in document order", () => {
    const sop = createEmptySop("search", "2026-01-01T00:00:00.000Z");
    sop.meta.title = "Alpha control";
    sop.purpose = "Define the alpha review process.";
    sop.procedure.activities = [
      {
        id: "alpha-step",
        step: 1,
        description: "Approve alpha requests",
        assignments: {},
      },
    ];

    expect(searchSop(sop, "ALPHA").map(({ stepId, label }) => ({ stepId, label }))).toEqual([
      { stepId: "document", label: "Title" },
      { stepId: "overview", label: "Purpose" },
      { stepId: "procedure", label: "Activity 1" },
    ]);
  });

  it("ignores empty queries and whitespace-only values", () => {
    const sop = createEmptySop("search", "2026-01-01T00:00:00.000Z");
    sop.references = ["", "ISO 9001"];

    expect(searchSop(sop, " ")).toEqual([]);
    expect(searchSop(sop, "iso")).toHaveLength(1);
  });
});
