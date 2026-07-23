import { describe, expect, it } from "vitest";
import { createEmptySop } from "./schema";
import { initialDraftChangeEntry, lifecycleChangeEntry } from "./change-history";

const ACTOR = { name: "Alex Morgan", position: "Process Engineer" };

describe("SOP change-history generation", () => {
  it("stamps the initial draft with the department author's collected information", () => {
    expect(initialDraftChangeEntry("1.0", ACTOR, "2026-07-22")).toEqual({
      version: "1.0",
      changes: "Initial draft created.",
      createdByName: "Alex Morgan",
      createdByPosition: "Process Engineer",
      createdByDate: "2026-07-22",
    });
  });

  it("stamps lifecycle entries with the actor instead of leaving author fields blank", () => {
    const sop = { ...createEmptySop("sop-1", "2026-07-22T00:00:00.000Z"), status: "in_review" as const };
    expect(lifecycleChangeEntry(sop, "draft", ACTOR, "2026-07-22")).toMatchObject({
      changes: "Status changed from Draft to In review.",
      createdByName: "Alex Morgan",
      createdByPosition: "Process Engineer",
    });
  });
});
