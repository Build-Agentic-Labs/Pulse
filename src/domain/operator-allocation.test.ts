import { describe, expect, expectTypeOf, it } from "vitest";

import { buildOperatorAssignmentsFromIePlan } from "./operator-allocation";
import { buildUnallocatedWorkReviews, type SmartAllocationResult } from "./smart-allocation-report";
import type { Task } from "./types";

const BASE = Date.parse("2026-01-01T00:00:00Z");

function task(id: string, duration: number, start: number, operatorIds: string[] = []): Task {
  return {
    id,
    scenarioId: "s1",
    stationId: "st1",
    rowType: "task",
    wbs: id,
    name: id,
    plannedStart: new Date(BASE + start * 60_000).toISOString(),
    plannedFinish: new Date(BASE + (start + duration) * 60_000).toISOString(),
    plannedDurationMinutes: duration,
    plannedOperators: operatorIds.length,
    plannedManHours: 0,
    status: "not_started",
    percentComplete: 0,
    dependencyIds: [],
    criticalPath: false,
    bottleneckFlag: false,
    qualityGate: false,
    travelerSignoffRequired: false,
    customFields: { operatorIds },
  };
}

function allocate(tasks: Task[], assignments: Array<{ taskId: string; operatorIds: string[] }>, availableOperatorIds = ["A", "B"]) {
  return buildOperatorAssignmentsFromIePlan({
    tasks,
    assignments: assignments.map((assignment) => ({ ...assignment, rationale: "Current Gantt assignment" })),
    availableOperatorIds,
    demandQuantity: 1,
    operatorCapacityMinutes: 480,
    taktMinutes: 480,
  });
}

describe("current operator allocation audit", () => {
  it("reports overlapping work assigned to the same operator", () => {
    const allocation = allocate([task("left", 120, 0), task("right", 120, 60)], [
      { taskId: "left", operatorIds: ["A"] },
      { taskId: "right", operatorIds: ["A"] },
    ]);

    expect(allocation.issues.some((issue) => issue.kind === "schedule_conflict")).toBe(true);
  });

  it("allows parallel work on separate operators and a back-to-back handoff", () => {
    const allocation = allocate([task("first", 60, 0), task("second", 60, 0), task("third", 60, 60)], [
      { taskId: "first", operatorIds: ["A"] },
      { taskId: "second", operatorIds: ["B"] },
      { taskId: "third", operatorIds: ["A"] },
    ]);

    expect(allocation.issues.filter((issue) => issue.kind === "schedule_conflict")).toEqual([]);
  });

  it("keeps the live recommendation for work exceeding one operator's period capacity", () => {
    const allocation = allocate([task("long", 600, 0)], [], ["A"]);
    type ReviewInput = Parameters<typeof buildUnallocatedWorkReviews>[0];
    const reviews = buildUnallocatedWorkReviews({
      allocation,
      kpis: { taktMinutes: 0 } as ReviewInput["kpis"],
      product: { demandQuantity: 1, demandPeriod: "day" } as ReviewInput["product"],
      operatorCapacityMinutes: 480,
    });

    expect(reviews).toHaveLength(1);
    expect(reviews[0]).toMatchObject({
      taskId: "long",
      classification: "Physically infeasible",
      condition: "Exceeds one-operator period capacity",
      action: "Split task / add capacity",
    });
  });

  it("types the recommendation input from the live allocation builder", () => {
    expectTypeOf<SmartAllocationResult>().toEqualTypeOf<ReturnType<typeof buildOperatorAssignmentsFromIePlan>>();
  });
});
