import { describe, expect, it } from "vitest";

import { buildWorkspaceUrl, readWorkspaceUrlSnapshot } from "./state";

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
