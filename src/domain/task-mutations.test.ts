import { describe, expect, it } from "vitest";

import {
  applyTaskCode,
  applyTaskCodes,
  enforceStepDerivedDuration,
  ensureNomenclatureCollections,
  isCustomFieldRecord,
  removeStepScopedCustomFields,
  taskPatchChangesSchedule,
} from "./task-mutations";
import { STEP_PHOTO_ATTACHMENTS_FIELD } from "./step-photos";
import { STEP_PART_MENTIONS_FIELD } from "./step-part-mentions";
import type { PlannerState, Task } from "./types";

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

describe("isCustomFieldRecord", () => {
  it("accepts plain objects only", () => {
    expect(isCustomFieldRecord({})).toBe(true);
    expect(isCustomFieldRecord({ a: 1 })).toBe(true);
    expect(isCustomFieldRecord(null)).toBe(false);
    expect(isCustomFieldRecord([])).toBe(false);
    expect(isCustomFieldRecord("x")).toBe(false);
  });
});

describe("removeStepScopedCustomFields", () => {
  it("removes only the given step's entry and prunes empty maps", () => {
    const task = makeTask({
      customFields: {
        [STEP_PHOTO_ATTACHMENTS_FIELD]: { step1: ["a"], step2: ["b"] },
      },
    });
    const next = removeStepScopedCustomFields(task, "step1");
    expect(next.customFields[STEP_PHOTO_ATTACHMENTS_FIELD]).toEqual({ step2: ["b"] });
    // original not mutated
    expect((task.customFields[STEP_PHOTO_ATTACHMENTS_FIELD] as Record<string, unknown>).step1).toEqual(["a"]);
  });
  it("drops the field entirely when it becomes empty", () => {
    const task = makeTask({ customFields: { [STEP_PHOTO_ATTACHMENTS_FIELD]: { step1: ["a"] } } });
    const next = removeStepScopedCustomFields(task, "step1");
    expect(STEP_PHOTO_ATTACHMENTS_FIELD in next.customFields).toBe(false);
  });
  it("removes part-text mappings owned by the deleted step", () => {
    const task = makeTask({
      customFields: {
        [STEP_PART_MENTIONS_FIELD]: {
          step1: [{ id: "mention-1", partReferenceId: "part-1", text: "bolt", start: 0, end: 4 }],
          step2: [{ id: "mention-2", partReferenceId: "part-2", text: "hose", start: 0, end: 4 }],
        },
      },
    });
    const next = removeStepScopedCustomFields(task, "step1");

    expect(next.customFields[STEP_PART_MENTIONS_FIELD]).toEqual({
      step2: [{ id: "mention-2", partReferenceId: "part-2", text: "hose", start: 0, end: 4 }],
    });
  });
});

describe("taskPatchChangesSchedule", () => {
  it("is true when any schedule field is present", () => {
    expect(taskPatchChangesSchedule({ plannedStart: "x" })).toBe(true);
    expect(taskPatchChangesSchedule({ plannedDurationMinutes: 5 })).toBe(true);
  });
  it("is false for non-schedule patches", () => {
    expect(taskPatchChangesSchedule({ name: "renamed" })).toBe(false);
  });
});

describe("enforceStepDerivedDuration", () => {
  it("passes the patch through when there are no manufacturing steps", () => {
    const task = makeTask({ manufacturingSteps: [] });
    const patch = { plannedDurationMinutes: 30 };
    expect(enforceStepDerivedDuration(task, patch)).toBe(patch);
  });
  it("strips duration (and finish when no start) when steps drive duration", () => {
    const task = makeTask({ manufacturingSteps: [{ id: "st1", sequence: 1, instruction: "do" }] });
    const stripped = enforceStepDerivedDuration(task, { plannedDurationMinutes: 30, plannedFinish: "x" });
    expect("plannedDurationMinutes" in stripped).toBe(false);
    expect("plannedFinish" in stripped).toBe(false);
  });
  it("keeps finish when a start is also provided", () => {
    const task = makeTask({ manufacturingSteps: [{ id: "st1", sequence: 1, instruction: "do" }] });
    const result = enforceStepDerivedDuration(task, {
      plannedDurationMinutes: 30,
      plannedStart: "s",
      plannedFinish: "f",
    });
    expect("plannedDurationMinutes" in result).toBe(false);
    expect("plannedFinish" in result).toBe(true);
  });
});

describe("applyTaskCode / applyTaskCodes", () => {
  it("respects codeLocked unless forced", () => {
    const locked = makeTask({ codeLocked: true, manufacturingCode: "ORIG" });
    expect(applyTaskCode(locked, [], [])).toBe(locked); // unchanged reference
    const forced = applyTaskCode(locked, [], [], true);
    expect(forced).not.toBe(locked); // recomputed
  });
  it("maps over a list", () => {
    const tasks = [makeTask({ id: "a" }), makeTask({ id: "b" })];
    expect(applyTaskCodes(tasks, [], [])).toHaveLength(2);
  });
});

describe("ensureNomenclatureCollections", () => {
  it("fills missing components and documentTypes collections", () => {
    const base = {
      product: { id: "p1", createdAt: "2026-01-01T00:00:00Z", updatedAt: "2026-01-01T00:00:00Z" },
    } as unknown as PlannerState;
    const next = ensureNomenclatureCollections(base);
    expect(Array.isArray(next.components)).toBe(true);
    expect(next.documentTypes.length).toBeGreaterThan(0);
    expect(next.documentTypes[0].productId).toBe("p1");
  });
  it("leaves existing collections untouched", () => {
    const existing = [{ id: "dt1" }] as unknown as PlannerState["documentTypes"];
    const base = {
      product: { id: "p1", createdAt: "x", updatedAt: "y" },
      components: [],
      documentTypes: existing,
    } as unknown as PlannerState;
    expect(ensureNomenclatureCollections(base).documentTypes).toBe(existing);
  });
});
