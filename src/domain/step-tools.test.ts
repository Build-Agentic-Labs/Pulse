import { describe, expect, it } from "vitest";

import {
  addStepTool,
  buildStepToolLibrary,
  getStepToolList,
  removeToolFromAllTasks,
  renameToolInTasks,
  STEP_TOOL_LISTS_FIELD,
} from "./step-tools";
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

function taskWithTools(stepToolLists: Record<string, string[]>, id = "t1"): Task {
  return makeTask({ id, customFields: { [STEP_TOOL_LISTS_FIELD]: stepToolLists } });
}

describe("buildStepToolLibrary", () => {
  it("returns formatted display names", () => {
    const tasks = [taskWithTools({ s1: ["torque wrench", "10mm socket"] })];
    expect(buildStepToolLibrary(tasks)).toEqual(["10mm Socket", "Torque Wrench"]);
  });

  it("dedupes whitespace and case variants of the same tool", () => {
    const tasks = [
      taskWithTools({ s1: ["torque  wrench"] }, "t1"),
      taskWithTools({ s2: ["Torque Wrench"] }, "t2"),
    ];
    expect(buildStepToolLibrary(tasks)).toEqual(["Torque Wrench"]);
  });
});

describe("renameToolInTasks", () => {
  it("renames a messy stored occurrence when matched by its clean form", () => {
    const tasks = [taskWithTools({ s1: ["torque  wrench"] })];
    const out = renameToolInTasks(tasks, "Torque Wrench", "Impact Gun");
    expect(getStepToolList(out[0], "s1")).toEqual(["Impact Gun"]);
  });

  it("collapses whitespace in storage when renaming to the clean form", () => {
    const tasks = [taskWithTools({ s1: ["torque  wrench"] })];
    const out = renameToolInTasks(tasks, "torque  wrench", "Torque Wrench");
    expect(getStepToolList(out[0], "s1")).toEqual(["Torque Wrench"]);
  });

  it("preserves other tools and the step assignment", () => {
    const tasks = [taskWithTools({ s1: ["torque  wrench", "10mm socket"] })];
    const out = renameToolInTasks(tasks, "Torque Wrench", "Torque Wrench 1/2in");
    expect(getStepToolList(out[0], "s1")).toEqual(["Torque Wrench 1/2in", "10mm socket"]);
  });

  it("is a no-op when the stored name already matches the target string", () => {
    const tasks = [taskWithTools({ s1: ["Torque Wrench"] })];
    const out = renameToolInTasks(tasks, "Torque Wrench", "Torque Wrench");
    expect(out[0]).toBe(tasks[0]);
  });
});

describe("removeToolFromAllTasks", () => {
  it("removes a whitespace-variant stored occurrence matched by its clean form", () => {
    const tasks = [taskWithTools({ s1: ["torque  wrench", "10mm socket"] })];
    const out = removeToolFromAllTasks(tasks, "Torque Wrench");
    expect(getStepToolList(out[0], "s1")).toEqual(["10mm socket"]);
  });
});

describe("addStepTool", () => {
  it("formats the tool name on add", () => {
    const out = addStepTool(taskWithTools({}), "s1", "torque  WRENCH");
    expect(getStepToolList(out, "s1")).toEqual(["Torque Wrench"]);
  });

  it("merges a messy duplicate into the existing formatted tool", () => {
    const out = addStepTool(taskWithTools({ s1: ["Torque Wrench"] }), "s1", "torque  wrench");
    expect(getStepToolList(out, "s1")).toEqual(["Torque Wrench"]);
  });
});
