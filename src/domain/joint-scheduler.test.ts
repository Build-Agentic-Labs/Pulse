import { describe, expect, it } from "vitest";

import { optimizeLine, type OptimizeLineConstraints } from "./joint-scheduler";
import { getStoredTaskOperatorIds } from "./operator-assignments";
import type { Task } from "./types";

const BASE = "2026-01-01T00:00:00.000Z";

function iso(offsetMinutes: number): string {
  return new Date(Date.parse(BASE) + offsetMinutes * 60_000).toISOString();
}

function makeTask(id: string, opts: { dur?: number; deps?: string[]; wbs?: string } = {}): Task {
  const dur = opts.dur ?? 60;
  return {
    id,
    scenarioId: "s1",
    stationId: "st1",
    rowType: "task",
    wbs: opts.wbs ?? id,
    name: id,
    plannedStart: BASE,
    plannedFinish: iso(dur),
    plannedDurationMinutes: dur,
    plannedOperators: 0,
    plannedManHours: 0,
    status: "not_started",
    percentComplete: 0,
    dependencyIds: opts.deps ?? [],
    criticalPath: false,
    bottleneckFlag: false,
    qualityGate: false,
    travelerSignoffRequired: false,
    customFields: {},
  };
}

const CONSTRAINTS: OptimizeLineConstraints = {
  availableOperatorIds: ["A", "B", "C", "D"],
  demandQuantity: 1,
  operatorCapacityMinutes: 100_000, // ample: capacity never binds in these fixtures
};

function startMs(task: Task) {
  return Date.parse(task.plannedStart);
}
function finishMs(task: Task) {
  return Date.parse(task.plannedFinish);
}

// No operator may be booked on two tasks whose windows overlap.
function expectNoDoubleBooking(tasks: Task[]) {
  const byOperator = new Map<string, Task[]>();
  for (const task of tasks) {
    for (const operatorId of getStoredTaskOperatorIds(task)) {
      const list = byOperator.get(operatorId) ?? [];
      list.push(task);
      byOperator.set(operatorId, list);
    }
  }
  for (const list of byOperator.values()) {
    const sorted = [...list].sort((left, right) => startMs(left) - startMs(right));
    for (let index = 1; index < sorted.length; index += 1) {
      expect(startMs(sorted[index])).toBeGreaterThanOrEqual(finishMs(sorted[index - 1]));
    }
  }
}

describe("optimizeLine", () => {
  it("schedules a dependency chain ASAP and reuses one operator across it", () => {
    const tasks = [
      makeTask("t1"),
      makeTask("t2", { deps: ["t1"] }),
      makeTask("t3", { deps: ["t2"] }),
    ];

    const { tasks: result, metrics } = optimizeLine(tasks, CONSTRAINTS, "lead-time");
    const byId = new Map(result.map((task) => [task.id, task]));

    // Dependencies respected: each starts no earlier than its predecessor finishes.
    expect(startMs(byId.get("t2")!)).toBeGreaterThanOrEqual(finishMs(byId.get("t1")!));
    expect(startMs(byId.get("t3")!)).toBeGreaterThanOrEqual(finishMs(byId.get("t2")!));
    // Sequential, non-overlapping work collapses onto a single operator.
    expect(metrics.operatorsUsed).toBe(1);
    expect(metrics.unassignedTaskCount).toBe(0);
    expect(metrics.leadTimeMinutes).toBe(180);
    expectNoDoubleBooking(result);
  });

  it("gives each concurrent independent task its own operator", () => {
    const tasks = [makeTask("a"), makeTask("b"), makeTask("c")];

    const { tasks: result, metrics } = optimizeLine(tasks, CONSTRAINTS, "lead-time");

    // Three tasks all start at the line start and overlap → three operators.
    expect(metrics.operatorsUsed).toBe(3);
    expect(metrics.unassignedTaskCount).toBe(0);
    expect(metrics.leadTimeMinutes).toBe(60);
    expectNoDoubleBooking(result);
    for (const task of result) {
      expect(startMs(task)).toBe(Date.parse(BASE));
    }
  });

  it("levels only within slack: lead time is the critical path and no one is double-booked", () => {
    // t1 -> t3 is the critical chain (120 min); t2 is independent with free float.
    const tasks = [
      makeTask("t1"),
      makeTask("t2"),
      makeTask("t3", { deps: ["t1"] }),
    ];

    const { tasks: result, metrics } = optimizeLine(tasks, CONSTRAINTS, "lead-time");

    // Leveling never pushes the finish past the critical-path length.
    expect(metrics.leadTimeMinutes).toBe(120);
    expect(metrics.unassignedTaskCount).toBe(0);
    expect(metrics.operatorsUsed).toBe(2);
    expectNoDoubleBooking(result);
  });

  it("flags work that cannot be covered when no operators are available", () => {
    const tasks = [makeTask("t1"), makeTask("t2", { deps: ["t1"] })];

    const { metrics } = optimizeLine(tasks, { ...CONSTRAINTS, availableOperatorIds: [] });

    expect(metrics.operatorsUsed).toBe(0);
    expect(metrics.unassignedTaskCount).toBe(2);
  });
});

describe("optimizeLine — idle-first (default)", () => {
  it("collapses to the leanest crew with zero idle when capacity is ample", () => {
    // 3 independent 60-min tasks; capacity is huge, so the capacity floor is 1 operator.
    const tasks = [makeTask("a"), makeTask("b"), makeTask("c")];

    const { metrics } = optimizeLine(tasks, CONSTRAINTS); // default strategy = idle-first

    // One operator runs all three back-to-back: zero idle, lead time = total work.
    expect(metrics.operatorsUsed).toBe(1);
    expect(metrics.idleMinutes).toBe(0);
    expect(metrics.leadTimeMinutes).toBe(180);
    expect(metrics.unassignedTaskCount).toBe(0);
  });

  it("opens exactly the capacity-floor crew and keeps idle at zero", () => {
    // 3 independent 60-min tasks; capacity 60/period, demand 1 → period work 180 → floor 3 operators.
    const tasks = [makeTask("a"), makeTask("b"), makeTask("c")];

    const { tasks: result, metrics } = optimizeLine(tasks, {
      availableOperatorIds: ["A", "B", "C", "D"],
      demandQuantity: 1,
      operatorCapacityMinutes: 60,
    });

    expect(metrics.operatorsUsed).toBe(3);
    expect(metrics.idleMinutes).toBe(0); // 3 operators × 60 makespan − 180 work
    expect(metrics.leadTimeMinutes).toBe(60);
    expect(metrics.unassignedTaskCount).toBe(0);
    expectNoDoubleBooking(result);
  });

  it("respects dependencies even while packing the lean crew", () => {
    const tasks = [makeTask("t1"), makeTask("t2", { deps: ["t1"] }), makeTask("t3", { deps: ["t2"] })];

    const { tasks: result } = optimizeLine(tasks, CONSTRAINTS);
    const byId = new Map(result.map((task) => [task.id, task]));

    expect(startMs(byId.get("t2")!)).toBeGreaterThanOrEqual(finishMs(byId.get("t1")!));
    expect(startMs(byId.get("t3")!)).toBeGreaterThanOrEqual(finishMs(byId.get("t2")!));
    expectNoDoubleBooking(result);
  });
});
