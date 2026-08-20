import { describe, expect, it } from "vitest";

import {
  addStepPartMention,
  getStepPartMentions,
  instructionWithPartMentionMarkers,
  reconcileStepPartMentionsAfterInstructionChange,
  removeStepPartMention,
} from "./step-part-mentions";
import type { Task } from "./types";

const instruction = "Mount relay box with M8-1.25 bolts and torque evenly.";

function makeTask(overrides: Partial<Task> = {}): Task {
  return {
    id: "task-1",
    scenarioId: "scenario-1",
    stationId: "station-1",
    rowType: "task",
    wbs: "1",
    name: "Task",
    plannedStart: "2026-01-01T08:00:00.000Z",
    plannedFinish: "2026-01-01T09:00:00.000Z",
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
    manufacturingSteps: [{ id: "step-1", sequence: 1, instruction }],
    partReferences: [{ id: "part-1", partNumber: "1000000373", description: "Full bolt description" }],
    ...overrides,
  };
}

function linkedTask() {
  const start = instruction.indexOf("M8-1.25 bolts");
  return addStepPartMention(makeTask(), "step-1", instruction, {
    id: "mention-1",
    partReferenceId: "part-1",
    start,
    end: start + "M8-1.25 bolts".length,
  })!;
}

describe("step part text mentions", () => {
  it("keeps the instruction unchanged and derives a numbered marker", () => {
    const task = linkedTask();

    expect(task.manufacturingSteps?.[0].instruction).toBe(instruction);
    expect(getStepPartMentions(task, "step-1")).toMatchObject([
      { id: "mention-1", partReferenceId: "part-1", text: "M8-1.25 bolts" },
    ]);
    expect(instructionWithPartMentionMarkers(task, "step-1", instruction)).toBe(
      "Mount relay box with M8-1.25 bolts[1] and torque evenly.",
    );
  });

  it("rebases the mapping when surrounding text changes", () => {
    const task = linkedTask();
    const nextInstruction = `Carefully ${instruction}`;
    const next = reconcileStepPartMentionsAfterInstructionChange(task, "step-1", instruction, nextInstruction);

    expect(getStepPartMentions(next, "step-1")[0]).toMatchObject({
      text: "M8-1.25 bolts",
      start: instruction.indexOf("M8-1.25 bolts") + "Carefully ".length,
    });
    expect(instructionWithPartMentionMarkers(next, "step-1", nextInstruction)).toContain("M8-1.25 bolts[1]");
  });

  it("removes the text mapping when the linked phrase itself is edited", () => {
    const task = linkedTask();
    const nextInstruction = instruction.replace("M8-1.25 bolts", "M8 bolts");
    const next = reconcileStepPartMentionsAfterInstructionChange(task, "step-1", instruction, nextInstruction);

    expect(getStepPartMentions(next, "step-1")).toEqual([]);
    expect(next.partReferences).toEqual(task.partReferences);
    expect(next.manufacturingSteps?.[0].partReferenceIds).toEqual(task.manufacturingSteps?.[0].partReferenceIds);
  });

  it("removes one marker without deleting the part allocation", () => {
    const task = linkedTask();
    const next = removeStepPartMention(task, "step-1", "mention-1");

    expect(getStepPartMentions(next, "step-1")).toEqual([]);
    expect(next.partReferences).toEqual(task.partReferences);
  });
});
