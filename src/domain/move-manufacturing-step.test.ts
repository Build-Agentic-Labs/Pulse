import { describe, expect, it } from "vitest";

import { moveManufacturingStepBetweenTasks } from "./move-manufacturing-step";
import { STEP_PART_MENTIONS_FIELD } from "./step-part-mentions";
import type { Task } from "./types";

function makeTask(id: string, overrides: Partial<Task> = {}): Task {
  return {
    id,
    scenarioId: "scenario-1",
    stationId: "station-1",
    rowType: "task",
    wbs: "1",
    name: id,
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
    customFields: {},
    ...overrides,
  };
}

describe("moveManufacturingStepBetweenTasks", () => {
  it("moves the step part marker, allocation, and part catalog entry together", () => {
    const source = makeTask("source", {
      manufacturingSteps: [
        {
          id: "step-1",
          sequence: 1,
          instruction: "Install cooling hose",
          durationMinutes: 20,
          partReferenceIds: ["part-1"],
          partReferenceQuantities: { "part-1": 3 },
        },
      ],
      partReferences: [{ id: "part-1", partNumber: "P-100", description: "Cooling hose", quantity: 2 }],
      customFields: {
        [STEP_PART_MENTIONS_FIELD]: {
          "step-1": [
            { id: "mention-1", partReferenceId: "part-1", text: "cooling hose", start: 8, end: 20 },
          ],
        },
      },
    });
    const target = makeTask("target", { manufacturingSteps: [], partReferences: [] });

    const moved = moveManufacturingStepBetweenTasks([source, target], "source", "target", "step-1");
    const nextSource = moved?.find((task) => task.id === "source");
    const nextTarget = moved?.find((task) => task.id === "target");

    expect(nextSource?.customFields[STEP_PART_MENTIONS_FIELD]).toBeUndefined();
    expect(nextTarget?.partReferences).toContainEqual(
      expect.objectContaining({ id: "part-1", partNumber: "P-100" }),
    );
    expect(nextTarget?.manufacturingSteps?.[0]).toMatchObject({
      id: "step-1",
      partReferenceIds: ["part-1"],
      partReferenceQuantities: { "part-1": 3 },
    });
    expect(nextTarget?.customFields[STEP_PART_MENTIONS_FIELD]).toEqual({
      "step-1": [
        { id: "mention-1", partReferenceId: "part-1", text: "cooling hose", start: 8, end: 20 },
      ],
    });
  });
});
