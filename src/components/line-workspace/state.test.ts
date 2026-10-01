import { describe, expect, it } from "vitest";

import { buildWorkspaceUrl, readWorkspaceUrlSnapshot, rebaseProcedureTaskVersions } from "./state";

describe("planner workspace URL history", () => {
  it("reads supported module and selection state from a history URL", () => {
    expect(readWorkspaceUrlSnapshot("?view=pfmea&task=task-1&station=station-1&zone=zone-1")).toEqual({
      activeModule: "pfmea",
      selectedTaskId: "task-1",
      selectedStationId: "station-1",
      activeZoneId: "zone-1",
    });
    expect(readWorkspaceUrlSnapshot("?view=unknown").activeModule).toBeUndefined();
  });

  it("builds a shareable module entry while preserving unrelated query parameters", () => {
    expect(buildWorkspaceUrl(
      "/projects/project-flexboost/planner",
      "?view=dashboard&autosaveHarness=1&task=old-task",
      {
        activeModule: "checklist",
        selectedTaskId: "task-2",
        selectedStationId: "station-2",
        activeZoneId: undefined,
      },
    )).toBe(
      "/projects/project-flexboost/planner?view=checklist&autosaveHarness=1&task=task-2&station=station-2",
    );
  });
});


describe("queued procedure save versions", () => {
  it("uses the preceding save's versions while preserving newer edits and added steps", () => {
    const pending = {
      id: "task-1", version: 4, description: "newer task text",
      manufacturingSteps: [
        { id: "step-1", sequence: 1, version: 8, instruction: "newer instruction", qualityCheck: "newer torque range" },
        { id: "step-new", sequence: 2, instruction: "new step" },
      ],
      partReferences: [{ id: "new-part" }],
    } as unknown as import("@/domain/types").Task;
    const saved = {
      ...pending, version: 5, description: "older text",
      manufacturingSteps: [{ id: "step-1", sequence: 1, version: 9, instruction: "older instruction" }],
    } as import("@/domain/types").Task;
    const rebased = rebaseProcedureTaskVersions(pending, saved);
    expect(rebased).toEqual({
      ...pending, version: 5,
      manufacturingSteps: [{ ...pending.manufacturingSteps![0], version: 9 }, pending.manufacturingSteps![1]],
    });
    expect(pending.version).toBe(4);
    expect(pending.manufacturingSteps![0].version).toBe(8);
  });
});
