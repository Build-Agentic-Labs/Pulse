import { describe, expect, it } from "vitest";

import {
  addTaskExplodedViews,
  countTaskExplodedViews,
  EXPLODED_VIEWS_FIELD,
  getTaskExplodedViews,
  normalizeComponents,
  removeTaskExplodedView,
  updateTaskExplodedView,
  upsertTaskExplodedViews,
  type ExplodedView,
} from "./step-exploded-views";
import type { Task } from "./types";

function makeTask(overrides: Partial<Task> = {}): Task {
  return {
    id: "t1",
    scenarioId: "sc1",
    stationId: "s1",
    rowType: "task",
    wbs: "1",
    name: "Task",
    plannedStart: "2026-01-01T08:00:00.000Z",
    plannedFinish: "2026-01-01T09:00:00.000Z",
    plannedDurationMinutes: 60,
    plannedOperators: 1,
    plannedManHours: 0,
    status: "not_started",
    percentComplete: 0,
    dependencyIds: [],
    criticalPath: false,
    bottleneckFlag: false,
    qualityGate: false,
    travelerSignoffRequired: false,
    customFields: {},
    ...overrides,
  };
}

function makeView(overrides: Partial<ExplodedView> = {}): ExplodedView {
  return {
    id: "v1",
    name: "Exploded view",
    dataUrl: "https://example.com/v1.png",
    capturedAt: "2026-06-17T10:00:00.000Z",
    ...overrides,
  };
}

describe("exploded-views (task level)", () => {
  it("returns an empty array when the field is missing or malformed", () => {
    expect(getTaskExplodedViews(makeTask())).toEqual([]);
    expect(getTaskExplodedViews(makeTask({ customFields: { [EXPLODED_VIEWS_FIELD]: "nope" } }))).toEqual([]);
    expect(countTaskExplodedViews(makeTask())).toBe(0);
  });

  it("adds views to a task and reads them back", () => {
    const task = addTaskExplodedViews(makeTask(), [makeView()]);
    expect(getTaskExplodedViews(task)).toHaveLength(1);
    expect(countTaskExplodedViews(task)).toBe(1);
  });

  it("preserves SolidWorks provenance and drops empty component entries", () => {
    const task = addTaskExplodedViews(
      makeTask(),
      [makeView({ solidworksFilePath: "C:/vault/ASM.SLDASM", explodeConfigName: "Cfg", frameNumber: 2, components: ["PN-1", "", "PN-2"] })],
    );
    const [stored] = getTaskExplodedViews(task);
    expect(stored.solidworksFilePath).toBe("C:/vault/ASM.SLDASM");
    expect(stored.explodeConfigName).toBe("Cfg");
    expect(stored.frameNumber).toBe(2);
    expect(stored.components).toEqual(["PN-1", "PN-2"]);
  });

  it("rejects entries without an id or valid image url", () => {
    const task = makeTask({
      customFields: {
        [EXPLODED_VIEWS_FIELD]: [
          { id: "", dataUrl: "https://example.com/a.png" },
          { id: "ok", dataUrl: "ftp://nope" },
          { id: "good", dataUrl: "data:image/png;base64,AAAA" },
        ],
      },
    });
    expect(getTaskExplodedViews(task).map((v) => v.id)).toEqual(["good"]);
  });

  it("upserts by id rather than duplicating", () => {
    let task = addTaskExplodedViews(makeTask(), [makeView({ id: "v1", caption: "first" })]);
    task = upsertTaskExplodedViews(task, [makeView({ id: "v1", caption: "second" })]);
    const views = getTaskExplodedViews(task);
    expect(views).toHaveLength(1);
    expect(views[0].caption).toBe("second");
  });

  it("removes and updates a single view, dropping the field when empty", () => {
    let task = addTaskExplodedViews(makeTask(), [makeView({ id: "v1" }), makeView({ id: "v2" })]);
    task = updateTaskExplodedView(task, "v2", { caption: "edited" });
    expect(getTaskExplodedViews(task).find((v) => v.id === "v2")?.caption).toBe("edited");

    task = removeTaskExplodedView(task, "v1");
    task = removeTaskExplodedView(task, "v2");
    expect(EXPLODED_VIEWS_FIELD in task.customFields).toBe(false);
  });

  it("normalizeComponents filters blanks and non-strings", () => {
    expect(normalizeComponents(["A", "", "  ", "B"])).toEqual(["A", "B"]);
    expect(normalizeComponents("x")).toBeUndefined();
    expect(normalizeComponents([])).toBeUndefined();
  });
});
