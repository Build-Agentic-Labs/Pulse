import { describe, expect, it } from "vitest";
import type { Task } from "./types";
import { rescheduleTasksByDependencies as shared } from "./task-scheduling";
import { rescheduleMobileTasksByDependencies as mobile } from "./mobile-task-scheduling";

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


const time = (hour: number, minute = 0) => `2026-01-01T${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}:00.000Z`;
const windows = (tasks: Task[]) => tasks.map(task => [task.id, task.plannedStart, task.plannedFinish]);

describe("mobile and shared scheduling contracts", () => {
  it("keeps an empty input unchanged", () => {
    const tasks: Task[] = [];
    expect(mobile(tasks)).toBe(tasks);
    expect(shared(tasks)).toBe(tasks);
  });

  it("matches on independent tasks, chains, forks, joins and missing dependencies", () => {
    const graphs = [ [[], []], [[], ["A"]], [[], ["A"], ["A"]], [[], [], ["A", "B"]], [[], ["missing"]] ];
    for (const graph of graphs) {
      const tasks = graph.map((dependencyIds, i) => makeTask({ id: String.fromCharCode(65 + i), dependencyIds, plannedStart: time(8 + i), plannedFinish: time(9 + i) }));
      const before = structuredClone(tasks);
      expect(mobile(tasks)).toEqual(shared(tasks));
      expect(tasks).toEqual(before);
    }
  });

  it("matches across 80 deterministic acyclic schedules with stale finish times", () => {
    for (let seed = 0; seed < 80; seed++) {
      const tasks = Array.from({length: 12}, (_, i) => makeTask({
        id: String(i), plannedStart: time(8 + i % 4), plannedFinish: time(9),
        plannedDurationMinutes: ((seed + i * 17) % 6) * 15,
        dependencyIds: Array.from({length: i}, (_, j) => j).filter(j => (seed + i + j * 3) % 5 === 0).map(String),
      }));
      expect(mobile(tasks)).toEqual(shared(tasks));
    }
  });

  it("matches a cycle when the saved start, finish and duration agree", () => {
    const tasks = [makeTask({id: "A", dependencyIds: ["B"]}), makeTask({id: "B", dependencyIds: ["A"]})];
    expect(mobile(tasks)).toEqual(shared(tasks));
  });

  it("differs on a cycle when saved finish disagrees with start plus duration", () => {
    const tasks = [makeTask({id: "A", dependencyIds: ["B"], plannedDurationMinutes: 30}), makeTask({id: "B", dependencyIds: ["A"]})];
    expect(windows(mobile(tasks))).toEqual([["A", time(9,30), time(10)], ["B", time(8,30), time(9,30)]]);
    expect(windows(shared(tasks))).toEqual([["A", time(10), time(10,30)], ["B", time(9), time(10)]]);
  });

  it("differs on a self-link with inconsistent saved dates", () => {
    const tasks = [makeTask({id: "A", dependencyIds: ["A"], plannedDurationMinutes: 30})];
    expect(windows(mobile(tasks))).toEqual([["A", time(8,30), time(9)]]);
    expect(windows(shared(tasks))).toEqual([["A", time(9), time(9,30)]]);
  });

  it("differs on a cycle with an invalid saved finish", () => {
    const tasks = [makeTask({id: "A", dependencyIds: ["B"], plannedFinish: "invalid"}), makeTask({id: "B", dependencyIds: ["A"]})];
    expect(windows(mobile(tasks))).toEqual([["A", time(10), time(11)], ["B", time(9), time(10)]]);
    expect(windows(shared(tasks))).toEqual([["A", time(9), time(10)], ["B", time(8), time(9)]]);
  });

  it("preserves a later manual start only when explicitly requested from the shared scheduler", () => {
    const tasks = [makeTask({id: "A"}), makeTask({id: "B", dependencyIds: ["A"], plannedStart: time(12), plannedFinish: time(13)})];
    expect(mobile(tasks)[1].plannedStart).toBe(time(9));
    expect(shared(tasks)[1].plannedStart).toBe(time(9));
    expect(shared(tasks, {preserveManualStartTaskIds: new Set(["B"])} )[1].plannedStart).toBe(time(12));
  });
});
