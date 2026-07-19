import { describe, expect, it } from "vitest";

import { finiteNumber, normalizePlan, taskKeepScore, taskWindowsOverlap } from "./ie-smart-allocation-solver";
import type { Task } from "./types";

// First tests for the solver module extracted from the smart-allocation route
// (Stage 6): characterization of the pure pieces, starting with normalizePlan —
// the boundary that turns arbitrary LLM output into a trustworthy plan.

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

describe("normalizePlan", () => {
  const operators = ["op-1", "op-2"];
  const taskIds = new Set(["task-a", "task-b"]);

  it("returns a safe empty plan for garbage input", () => {
    for (const garbage of [null, undefined, 42, "text", []]) {
      const plan = normalizePlan(garbage, operators, taskIds);
      expect(plan.assignments).toEqual([]);
      expect(plan.operatorSchedules).toEqual([]);
      expect(plan.reviewItems).toEqual([]);
      expect(plan.strategyNotes).toEqual([]);
      expect(plan.summary).toBe("IE smart allocation completed.");
    }
  });

  it("drops assignments for unknown tasks and filters unknown operators", () => {
    const plan = normalizePlan(
      {
        assignments: [
          { taskId: "task-a", operatorIds: ["op-1", "op-999", "op-1"], rationale: "keep" },
          { taskId: "task-unknown", operatorIds: ["op-1"] },
          "not-an-object",
        ],
      },
      operators,
      taskIds,
    );

    expect(plan.assignments).toEqual([{ taskId: "task-a", operatorIds: ["op-1"], rationale: "keep" }]);
  });

  it("coerces review-item severity to info and drops empty items", () => {
    const plan = normalizePlan(
      {
        reviewItems: [
          { severity: "blocker", message: "hard stop" },
          { severity: "catastrophic", message: "made-up severity" },
          { severity: "warning" }, // no message/recommendation -> dropped
        ],
      },
      operators,
      taskIds,
    );

    expect(plan.reviewItems).toEqual([
      { severity: "blocker", taskId: undefined, message: "hard stop", recommendation: "" },
      { severity: "info", taskId: undefined, message: "made-up severity", recommendation: "" },
    ]);
  });

  it("keeps schedules only for known operators and coerces sequence minutes to finite numbers", () => {
    const plan = normalizePlan(
      {
        operatorSchedules: [
          {
            operatorId: "op-2",
            sequence: [
              { taskId: "task-b", startMinute: "12", finishMinute: Number.NaN },
              { taskId: "task-unknown", startMinute: 0, finishMinute: 5 },
            ],
          },
          { operatorId: "op-999", sequence: [] },
        ],
      },
      operators,
      taskIds,
    );

    expect(plan.operatorSchedules).toEqual([
      { operatorId: "op-2", sequence: [{ taskId: "task-b", startMinute: 12, finishMinute: 0 }] },
    ]);
  });
});

describe("finiteNumber", () => {
  it("parses numerics and falls back to 0 for anything non-finite", () => {
    expect(finiteNumber(7)).toBe(7);
    expect(finiteNumber("3.5")).toBe(3.5);
    expect(finiteNumber(Number.POSITIVE_INFINITY)).toBe(0);
    expect(finiteNumber("abc")).toBe(0);
    expect(finiteNumber(undefined)).toBe(0);
  });
});

describe("taskWindowsOverlap", () => {
  it("detects overlapping and non-overlapping windows, treating bad dates as no overlap", () => {
    const base = makeTask({ plannedStart: "2026-01-01T08:00:00Z", plannedFinish: "2026-01-01T10:00:00Z" });
    const overlapping = makeTask({ id: "t2", plannedStart: "2026-01-01T09:00:00Z", plannedFinish: "2026-01-01T11:00:00Z" });
    const adjacent = makeTask({ id: "t3", plannedStart: "2026-01-01T10:00:00Z", plannedFinish: "2026-01-01T12:00:00Z" });
    const invalid = makeTask({ id: "t4", plannedStart: "not-a-date" });

    expect(taskWindowsOverlap(base, overlapping)).toBe(true);
    expect(taskWindowsOverlap(base, adjacent)).toBe(false); // touching endpoints do not overlap
    expect(taskWindowsOverlap(base, invalid)).toBe(false);
  });
});

describe("taskKeepScore", () => {
  it("ranks critical-path bottlenecks with successors above plain tasks", () => {
    const plain = makeTask({ id: "plain", plannedDurationMinutes: 60 });
    const loadBearing = makeTask({ id: "load", plannedDurationMinutes: 60, criticalPath: true, bottleneckFlag: true });
    const successor = makeTask({ id: "succ", dependencyIds: ["load"] });
    const tasks = [plain, loadBearing, successor];

    expect(taskKeepScore(loadBearing, tasks)).toBeGreaterThan(taskKeepScore(plain, tasks));
  });
});
