import { describe, expect, it } from "vitest";

import {
  addStepTool,
  buildStepToolLibrary,
  diffStepToolLists,
  getStepToolList,
  getTaskStepToolListMap,
  removeToolFromAllTasks,
  renameToolInTasks,
  revertStepToolListChanges,
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

describe("reverting a failed catalog rewrite's step tool changes", () => {
  const before = [
    taskWithTools({ a: ["torque  wrench", "Hex Key"], b: ["Hex Key"] }, "t1"),
    taskWithTools({ c: ["Torque Wrench"] }, "t2"),
  ];
  const renamed = renameToolInTasks(before, "torque  wrench", "Torque Driver");
  const removed = removeToolFromAllTasks(before, "torque  wrench");

  it("lists only the steps the rewrite changed, with both sides", () => {
    expect(diffStepToolLists(before, renamed)).toEqual([
      { taskId: "t1", stepId: "a", before: ["torque  wrench", "Hex Key"], after: ["Torque Driver", "Hex Key"] },
      { taskId: "t2", stepId: "c", before: ["Torque Wrench"], after: ["Torque Driver"] },
    ]);
    expect(diffStepToolLists(before, removed)).toEqual([
      { taskId: "t1", stepId: "a", before: ["torque  wrench", "Hex Key"], after: ["Hex Key"] },
      { taskId: "t2", stepId: "c", before: ["Torque Wrench"], after: [] },
    ]);
    expect(diffStepToolLists(before, before)).toEqual([]);
  });

  it("restores untouched steps exactly and leaves unaffected tasks as the same objects", () => {
    const unaffected = taskWithTools({ d: ["Mallet"] }, "t3");
    for (const after of [renamed, removed]) {
      const reverted = revertStepToolListChanges([...after, unaffected], diffStepToolLists(before, after));
      expect(getTaskStepToolListMap(reverted[0]!)).toEqual(getTaskStepToolListMap(before[0]!));
      expect(getTaskStepToolListMap(reverted[1]!)).toEqual(getTaskStepToolListMap(before[1]!));
      expect(reverted[2]).toBe(unaffected);
    }
  });

  it("restores a tidy that only changed a name's spelling (same canonical key)", () => {
    const tidied = renameToolInTasks(before, "torque  wrench", "Torque Wrench");
    const reverted = revertStepToolListChanges(tidied, diffStepToolLists(before, tidied));
    expect(getStepToolList(reverted[0]!, "a")).toEqual(["torque  wrench", "Hex Key"]);
  });

  it("keeps edits made while the rewrite was pending: other fields, added tools and removed tools", () => {
    const changes = diffStepToolLists(before, renamed);
    const concurrent = [
      addStepTool({ ...renamed[0]!, name: "Renamed meanwhile" }, "a", "Mallet"),
      // The user replaced t2's renamed tool with "Pliers" meanwhile.
      { ...renamed[1]!, customFields: { [STEP_TOOL_LISTS_FIELD]: { c: ["Pliers"] } } },
    ];
    const reverted = revertStepToolListChanges(concurrent, changes);
    expect(reverted[0]?.name).toBe("Renamed meanwhile");
    expect(getStepToolList(reverted[0]!, "a")).toEqual(["torque  wrench", "Hex Key", "Mallet"]);
    expect(getStepToolList(reverted[0]!, "b")).toEqual(["Hex Key"]);
    // "Torque Driver" was removed meanwhile: that removal never reached the old stored row, so the
    // database still has the original tool. Restoring it matches what was saved; "Pliers" is kept.
    expect(getStepToolList(reverted[1]!, "c")).toEqual(["Torque Wrench", "Pliers"]);
  });

  it("drops a tool the user removed meanwhile when it was not part of the rewrite", () => {
    const changes = diffStepToolLists(before, renamed);
    const concurrent = [{ ...renamed[0]!, customFields: { [STEP_TOOL_LISTS_FIELD]: { a: ["Torque Driver"], b: ["Hex Key"] } } }];
    expect(getStepToolList(revertStepToolListChanges(concurrent, changes)[0]!, "a")).toEqual(["torque  wrench"]);
  });

  it("skips tasks deleted meanwhile and steps whose tools were cleared meanwhile", () => {
    const changes = diffStepToolLists(before, renamed);
    const cleared = { ...renamed[0]!, customFields: { [STEP_TOOL_LISTS_FIELD]: { b: ["Hex Key"] } } };
    const reverted = revertStepToolListChanges([cleared], changes);
    expect(reverted).toHaveLength(1);
    expect(getTaskStepToolListMap(reverted[0]!)).toEqual({ b: ["Hex Key"] });
  });
});
