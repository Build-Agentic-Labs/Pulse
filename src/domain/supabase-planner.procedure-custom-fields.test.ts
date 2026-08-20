import { describe, expect, it } from "vitest";

import { STEP_PART_MENTIONS_FIELD } from "./step-part-mentions";
import { procedureTaskUpdateRow } from "./supabase-planner";
import type { Task } from "./types";

function makeTask(): Task {
  return {
    id: "task-1",
    scenarioId: "scenario-1",
    stationId: "station-1",
    rowType: "task",
    wbs: "1",
    name: "Install cooling hose",
    plannedStart: "2026-08-19T08:00:00.000Z",
    plannedFinish: "2026-08-19T09:00:00.000Z",
    plannedDurationMinutes: 60,
    plannedOperators: 1,
    plannedManHours: 1,
    status: "not_started",
    percentComplete: 0,
    dependencyIds: [],
    criticalPath: false,
    bottleneckFlag: false,
    qualityGate: false,
    travelerSignoffRequired: false,
    customFields: {
      keepMe: "preserved",
      [STEP_PART_MENTIONS_FIELD]: {
        "step-1": [
          { id: "mention-1", partReferenceId: "part-1", text: "cooling hose", start: 8, end: 20 },
        ],
      },
      stepPhotoAttachments: { "step-1": [{ id: "photo-1" }] },
      stepToolLists: { "step-1": ["Impact gun"] },
      taskExplodedViews: [{ id: "view-1" }],
      taskVideos: [{ id: "video-1" }],
    },
  };
}

describe("procedureTaskUpdateRow", () => {
  it("persists step part markers while excluding independently normalized assets", () => {
    const row = procedureTaskUpdateRow(makeTask());

    expect(row.custom_fields).toEqual({
      keepMe: "preserved",
      [STEP_PART_MENTIONS_FIELD]: {
        "step-1": [
          { id: "mention-1", partReferenceId: "part-1", text: "cooling hose", start: 8, end: 20 },
        ],
      },
    });
  });
});
