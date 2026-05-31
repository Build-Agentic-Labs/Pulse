import { describe, expect, it, vi } from "vitest";

import { attachPartToStep, getStepPartReferenceIds } from "./step-part-references";
import type { ManufacturingStep, Task } from "./types";

function makeStep(overrides: Partial<ManufacturingStep> = {}): ManufacturingStep {
  return { id: "step1", sequence: 1, instruction: "", partReferenceIds: [], ...overrides };
}

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
    manufacturingSteps: [makeStep()],
    partReferences: [],
    ...overrides,
  };
}

describe("attachPartToStep", () => {
  it("creates a new part reference and links it to the step", () => {
    const task = makeTask();
    const next = attachPartToStep(task, "step1", { partNumber: "P1", description: "Widget", quantity: 4 }, () => "id1");

    expect(next).not.toBeNull();
    expect(next?.partReferences).toEqual([
      { id: "id1", partNumber: "P1", description: "Widget", quantity: 4, disposition: "" },
    ]);
    expect(getStepPartReferenceIds(next!, "step1")).toEqual(["id1"]);
  });

  it("defaults description to empty and quantity to 1", () => {
    const next = attachPartToStep(makeTask(), "step1", { partNumber: "P2" }, () => "id2");
    expect(next?.partReferences?.[0]).toMatchObject({ partNumber: "P2", description: "", quantity: 1 });
  });

  it("reuses an existing part by case-insensitive part number without creating a new id", () => {
    const task = makeTask({
      partReferences: [{ id: "existing", partNumber: "P1", description: "Widget", quantity: 2 }],
    });
    const makeId = vi.fn(() => "should-not-be-used");

    const next = attachPartToStep(task, "step1", { partNumber: "  p1 ", quantity: 9 }, makeId);

    expect(makeId).not.toHaveBeenCalled();
    expect(next?.partReferences).toHaveLength(1);
    expect(next?.partReferences?.[0].quantity).toBe(2); // existing part kept as-is
    expect(getStepPartReferenceIds(next!, "step1")).toEqual(["existing"]);
  });

  it("returns null when the part number is blank", () => {
    expect(attachPartToStep(makeTask(), "step1", { partNumber: "   " }, () => "x")).toBeNull();
  });
});
