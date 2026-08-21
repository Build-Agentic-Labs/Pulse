import { describe, expect, it, vi } from "vitest";

import {
  attachPartMentionToStep,
  attachPartToStep,
  getStepPartReferenceIds,
  getStepPartReferenceQuantity,
  getTaskPartAllocationSummaries,
  mergeStepDependencyRefs,
  removeStepPartReference,
  setStepPartReferenceQuantity,
  splitStepDependencyRefs,
} from "./step-part-references";
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
    expect(getStepPartReferenceQuantity(next!, "step1", "id1")).toBe(4);
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
    expect(getStepPartReferenceQuantity(next!, "step1", "existing")).toBe(9);
  });

  it("fills a missing description from the selected BOM part", () => {
    const task = makeTask({
      partReferences: [{ id: "existing", partNumber: "P1", description: "", quantity: 2 }],
    });

    const next = attachPartToStep(
      task,
      "step1",
      { partNumber: "P1", description: "Full BOM part description", quantity: 3 },
      () => "unused",
    );

    expect(next?.partReferences?.[0].description).toBe("Full BOM part description");
    expect(getStepPartReferenceQuantity(next!, "step1", "existing")).toBe(3);
  });

  it("stores different quantities for the same shared part across multiple steps", () => {
    const task = makeTask({
      manufacturingSteps: [makeStep(), makeStep({ id: "step2", sequence: 2 })],
    });
    const first = attachPartToStep(task, "step1", { partNumber: "P1", quantity: 2 }, () => "shared");
    const second = attachPartToStep(first!, "step2", { partNumber: "P1", quantity: 7 }, () => "unused");

    expect(second?.partReferences).toHaveLength(1);
    expect(getStepPartReferenceQuantity(second!, "step1", "shared")).toBe(2);
    expect(getStepPartReferenceQuantity(second!, "step2", "shared")).toBe(7);
  });

  it("links selected instruction text while adding the BOM part to the step", () => {
    const task = makeTask({ manufacturingSteps: [makeStep({ instruction: "Install cooling hose" })] });
    const next = attachPartMentionToStep(
      task,
      "step1",
      "Install cooling hose",
      { start: 8, end: 20 },
      { partNumber: "P-HOSE", description: "Full cooling hose description", quantity: 2 },
      () => "part-hose",
      () => "mention-hose",
    );

    expect(next?.partReferences?.[0]).toMatchObject({ id: "part-hose", partNumber: "P-HOSE" });
    expect(next?.manufacturingSteps?.[0]).toMatchObject({
      partReferenceIds: ["part-hose"],
      partReferenceQuantities: { "part-hose": 2 },
    });
    expect(next?.customFields.stepPartMentions).toEqual({
      step1: [{ id: "mention-hose", partReferenceId: "part-hose", text: "cooling hose", start: 8, end: 20 }],
    });
  });

  it("uses the quantity entered in the link popup for an already allocated part", () => {
    const task = makeTask({
      manufacturingSteps: [
        makeStep({
          instruction: "Install cooling hose",
          partReferenceIds: ["part-hose"],
          partReferenceQuantities: { "part-hose": 2 },
        }),
      ],
      partReferences: [{ id: "part-hose", partNumber: "P-HOSE", description: "Cooling hose", quantity: 10 }],
    });

    const next = attachPartMentionToStep(
      task,
      "step1",
      "Install cooling hose",
      { start: 8, end: 20 },
      { partNumber: "P-HOSE", description: "Cooling hose", quantity: 7 },
      () => "unused",
      () => "mention-hose",
    );

    expect(getStepPartReferenceQuantity(next!, "step1", "part-hose")).toBe(7);
  });

  it("returns null when the part number is blank", () => {
    expect(attachPartToStep(makeTask(), "step1", { partNumber: "   " }, () => "x")).toBeNull();
  });
});

describe("step part allocation persistence", () => {
  it("summarizes only allocated parts and totals quantities across steps", () => {
    const task = makeTask({
      manufacturingSteps: [
        makeStep({
          partReferenceIds: ["allocated", "allocated"],
          partReferenceQuantities: { allocated: 4 },
        }),
        makeStep({
          id: "step2",
          sequence: 2,
          partReferenceIds: ["allocated"],
          partReferenceQuantities: { allocated: 3 },
        }),
      ],
      partReferences: [
        { id: "allocated", partNumber: "P-100", description: "Allocated part", quantity: 17 },
        { id: "unlinked", partNumber: "P-200", description: "Unlinked part", quantity: 2 },
      ],
    });

    expect(getTaskPartAllocationSummaries(task)).toEqual([
      {
        part: { id: "allocated", partNumber: "P-100", description: "Allocated part", quantity: 17 },
        allocatedQuantity: 7,
      },
    ]);
  });

  it("round-trips per-step quantities through dependency_ids while reading legacy links", () => {
    const stored = mergeStepDependencyRefs(
      ["dependency-1"],
      ["part-1", "part-2"],
      { "part-1": 2.5, "part-2": 7 },
    );

    expect(stored).toEqual(["dependency-1", "part:part-1|qty:2.5", "part:part-2|qty:7"]);
    expect(splitStepDependencyRefs(stored)).toEqual({
      dependencyIds: ["dependency-1"],
      partReferenceIds: ["part-1", "part-2"],
      partReferenceQuantities: { "part-1": 2.5, "part-2": 7 },
    });
    expect(splitStepDependencyRefs(["part:legacy-part"])).toEqual({
      dependencyIds: [],
      partReferenceIds: ["legacy-part"],
      partReferenceQuantities: {},
    });
  });

  it("updates and removes quantity together with the step allocation", () => {
    const linkedPart = attachPartToStep(makeTask(), "step1", { partNumber: "P1", quantity: 2 }, () => "part-1")!;
    const linked = attachPartMentionToStep(
      {
        ...linkedPart,
        manufacturingSteps: [{ ...linkedPart.manufacturingSteps![0], instruction: "Install widget" }],
      },
      "step1",
      "Install widget",
      { start: 8, end: 14 },
      { partNumber: "P1", quantity: 2 },
      () => "unused",
      () => "mention-1",
    )!;
    const updated = setStepPartReferenceQuantity(linked, "step1", "part-1", 6);
    const removed = removeStepPartReference(updated, "step1", "part-1");

    expect(getStepPartReferenceQuantity(updated, "step1", "part-1")).toBe(6);
    expect(removed.manufacturingSteps?.[0].partReferenceIds).toEqual([]);
    expect(removed.manufacturingSteps?.[0].partReferenceQuantities).toEqual({});
    expect(removed.customFields.stepPartMentions).toBeUndefined();
  });
});
