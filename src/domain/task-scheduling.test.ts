import { describe, expect, it } from "vitest";

import {
  addMinutes,
  rebuildDependenciesFromTasks,
  relinkTasksForDependency,
  rescheduleTasksByDependencies,
  sanitizeDependencyIds,
  taskDependencyRefBelongsTo,
  taskDependsOn,
  wouldCreateDependencyCycle,
} from "./task-scheduling";
import type { Dependency, Task } from "./types";

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

describe("addMinutes", () => {
  it("offsets an ISO timestamp by whole minutes", () => {
    expect(addMinutes("2026-01-01T08:00:00.000Z", 30)).toBe("2026-01-01T08:30:00.000Z");
  });
  it("handles negative offsets", () => {
    expect(addMinutes("2026-01-01T08:00:00.000Z", -60)).toBe("2026-01-01T07:00:00.000Z");
  });
});

describe("taskDependencyRefBelongsTo", () => {
  const ids = new Set(["task-a", "task-b"]);
  it("matches a direct task id", () => {
    expect(taskDependencyRefBelongsTo("task-a", ids)).toBe(true);
  });
  it("matches a step-scoped ref by its task id", () => {
    expect(taskDependencyRefBelongsTo("step:task-b", ids)).toBe(true);
  });
  it("rejects unknown refs", () => {
    expect(taskDependencyRefBelongsTo("task-x", ids)).toBe(false);
    expect(taskDependencyRefBelongsTo("step:task-x", ids)).toBe(false);
  });
});

describe("taskDependsOn", () => {
  // A -> B -> C  (A depends on B, B depends on C)
  const map = new Map<string, Task>([
    ["A", makeTask({ id: "A", dependencyIds: ["B"] })],
    ["B", makeTask({ id: "B", dependencyIds: ["C"] })],
    ["C", makeTask({ id: "C", dependencyIds: [] })],
  ]);
  it("detects transitive dependence", () => {
    expect(taskDependsOn(map, "A", "C")).toBe(true);
  });
  it("treats a task as depending on itself", () => {
    expect(taskDependsOn(map, "A", "A")).toBe(true);
  });
  it("returns false when there is no path", () => {
    expect(taskDependsOn(map, "C", "A")).toBe(false);
  });
});

describe("wouldCreateDependencyCycle", () => {
  // B depends on A
  const tasks = [makeTask({ id: "A" }), makeTask({ id: "B", dependencyIds: ["A"] })];
  it("flags self-reference", () => {
    expect(wouldCreateDependencyCycle(tasks, "A", "A")).toBe(true);
  });
  it("flags an edge that closes a loop", () => {
    // Adding B as a dependency of A would make A -> B -> A
    expect(wouldCreateDependencyCycle(tasks, "A", "B")).toBe(true);
  });
  it("allows an acyclic edge", () => {
    expect(wouldCreateDependencyCycle(tasks, "B", "A")).toBe(false);
  });
});

describe("sanitizeDependencyIds", () => {
  const tasks = [makeTask({ id: "A" }), makeTask({ id: "B" }), makeTask({ id: "C" })];
  it("dedupes, drops self/unknown, and keeps valid acyclic ids", () => {
    expect(sanitizeDependencyIds(tasks, "C", ["A", "A", "B", "C", "X"])).toEqual(["A", "B"]);
  });
});

describe("relinkTasksForDependency", () => {
  it("adds the predecessor to the target's dependencies", () => {
    const tasks = [makeTask({ id: "A" }), makeTask({ id: "B" })];
    const next = relinkTasksForDependency(tasks, "B", "A");
    expect(next.find((task) => task.id === "B")?.dependencyIds).toEqual(["A"]);
    expect(next.find((task) => task.id === "A")?.dependencyIds).toEqual([]);
  });
  it("is a no-op when the dependency already exists", () => {
    const tasks = [makeTask({ id: "A" }), makeTask({ id: "B", dependencyIds: ["A"] })];
    expect(relinkTasksForDependency(tasks, "B", "A")).toBe(tasks);
  });
  it("breaks the existing edge when the new one would cycle", () => {
    // B depends on A; linking A -> B should drop B -> A to stay acyclic
    const tasks = [makeTask({ id: "A" }), makeTask({ id: "B", dependencyIds: ["A"] })];
    const next = relinkTasksForDependency(tasks, "A", "B");
    expect(next.find((task) => task.id === "A")?.dependencyIds).toEqual(["B"]);
    expect(next.find((task) => task.id === "B")?.dependencyIds).toEqual([]);
  });
});

describe("rebuildDependenciesFromTasks", () => {
  it("derives Dependency rows from task dependencyIds", () => {
    const tasks = [makeTask({ id: "A" }), makeTask({ id: "B", dependencyIds: ["A"] })];
    const deps = rebuildDependenciesFromTasks(tasks, []);
    expect(deps).toEqual<Dependency[]>([
      {
        id: "dep-A-B-0",
        predecessorTaskId: "A",
        successorTaskId: "B",
        type: "finish_to_start",
        lagMinutes: undefined,
        constraintType: undefined,
      },
    ]);
  });
  it("reuses existing dependency id/type and marks quality gates", () => {
    const tasks = [makeTask({ id: "A" }), makeTask({ id: "B", dependencyIds: ["A"], qualityGate: true })];
    const existing: Dependency[] = [
      { id: "keep-me", predecessorTaskId: "A", successorTaskId: "B", type: "start_to_start" },
    ];
    const [dep] = rebuildDependenciesFromTasks(tasks, existing);
    expect(dep.id).toBe("keep-me");
    expect(dep.type).toBe("start_to_start");
    expect(dep.constraintType).toBe("quality");
  });
});

describe("rescheduleTasksByDependencies", () => {
  it("pushes dependents to start when their predecessor finishes", () => {
    const tasks = [
      makeTask({ id: "A", plannedStart: "2026-01-01T08:00:00.000Z", plannedDurationMinutes: 60 }),
      makeTask({
        id: "B",
        plannedStart: "2026-01-01T08:00:00.000Z",
        plannedDurationMinutes: 30,
        dependencyIds: ["A"],
      }),
    ];
    const next = rescheduleTasksByDependencies(tasks);
    const a = next.find((task) => task.id === "A");
    const b = next.find((task) => task.id === "B");
    expect(a?.plannedStart).toBe("2026-01-01T08:00:00.000Z");
    expect(a?.plannedFinish).toBe("2026-01-01T09:00:00.000Z");
    expect(b?.plannedStart).toBe("2026-01-01T09:00:00.000Z"); // waits for A
    expect(b?.plannedFinish).toBe("2026-01-01T09:30:00.000Z");
  });
  it("returns the same array reference for empty input", () => {
    const empty: Task[] = [];
    expect(rescheduleTasksByDependencies(empty)).toBe(empty);
  });
});
