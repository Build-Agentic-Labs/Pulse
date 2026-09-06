import { describe, expect, it } from "vitest";
import { EXPLODED_VIEWS_FIELD } from "./step-exploded-views";
import { STEP_PHOTO_ATTACHMENTS_FIELD } from "./step-photos";
import { TASK_VIDEOS_FIELD } from "./task-videos";
import { mergeTaskPrivateMedia } from "./task-private-media";
import type { Task } from "./types";

function task(overrides: Partial<Task> = {}): Task {
  return {
    id: "task-1",
    scenarioId: "scenario-1",
    stationId: "station-1",
    rowType: "task",
    wbs: "1",
    name: "Local procedure",
    description: "Keep the local description",
    plannedStart: "2026-08-19T00:00:00.000Z",
    plannedFinish: "2026-08-19T01:00:00.000Z",
    plannedDurationMinutes: 60,
    plannedOperators: 1,
    plannedManHours: 1,
    status: "not_started",
    percentComplete: 0,
    ownerName: "",
    dependencyIds: [],
    criticalPath: false,
    bottleneckFlag: false,
    qualityGate: false,
    travelerSignoffRequired: false,
    customFields: {},
    ...overrides,
  };
}

describe("mergeTaskPrivateMedia", () => {
  it("updates only private media fields and preserves live procedure edits", () => {
    const localTask = task({
      manufacturingSteps: [{
        id: "step-1",
        sequence: 1,
        instruction: "Unsaved local instruction",
        durationMinutes: 15,
        qualityCheck: "",
      }],
      customFields: {
        operatorIds: ["A"],
        [STEP_PHOTO_ATTACHMENTS_FIELD]: { "step-1": [{ id: "stale-photo" }] },
        [EXPLODED_VIEWS_FIELD]: [{ id: "stale-view" }],
        [TASK_VIDEOS_FIELD]: [{ id: "stale-video" }],
      },
    });
    const hydratedTask = task({
      name: "Older server procedure",
      description: "Older server description",
      manufacturingSteps: [{
        id: "step-1",
        sequence: 1,
        instruction: "Older server instruction",
        durationMinutes: 10,
        qualityCheck: "",
      }],
      customFields: {
        serverOnlyField: true,
        [STEP_PHOTO_ATTACHMENTS_FIELD]: { "step-1": [{ id: "fresh-photo" }] },
        [TASK_VIDEOS_FIELD]: [{ id: "fresh-video" }],
      },
    });

    const merged = mergeTaskPrivateMedia(localTask, hydratedTask);

    expect(merged.name).toBe("Local procedure");
    expect(merged.description).toBe("Keep the local description");
    expect(merged.manufacturingSteps?.[0]?.instruction).toBe("Unsaved local instruction");
    expect(merged.customFields).toMatchObject({
      operatorIds: ["A"],
      [STEP_PHOTO_ATTACHMENTS_FIELD]: { "step-1": [{ id: "fresh-photo" }] },
      [TASK_VIDEOS_FIELD]: [{ id: "fresh-video" }],
    });
    expect(merged.customFields).not.toHaveProperty("serverOnlyField");
    expect(merged.customFields).not.toHaveProperty(EXPLODED_VIEWS_FIELD);
  });
});

it("retains local markup when a stale photo hydration finishes", () => {
  const mark={version:2,items:[{id:"a",type:"arrow",color:"red",strokeWidth:3,x1:0,y1:0,x2:1,y2:1}]};
  const local=task({customFields:{stepPhotoAnnotations:{p:mark}}});
  const remote=task({customFields:{stepPhotoAttachments:{s:[{id:"p",dataUrl:"https://example.test/new",annotations:{version:2,items:[]}}]}}});
  expect(mergeTaskPrivateMedia(local,remote).customFields.stepPhotoAttachments).toMatchObject({s:[{annotations:mark}]});
});
