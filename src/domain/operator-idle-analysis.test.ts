import { describe, expect, it } from "vitest";

import { computeOperatorIdleAnalysis } from "./operator-allocation";
import type { Task } from "./types";

const BASE = "2026-01-01T00:00:00.000Z";
function iso(offsetMinutes: number): string {
  return new Date(Date.parse(BASE) + offsetMinutes * 60_000).toISOString();
}

function makeTask(
  id: string,
  opts: { dur: number; start?: number; operatorIds?: string[]; wbs?: string },
): Task {
  const start = opts.start ?? 0;
  return {
    id,
    scenarioId: "s1",
    stationId: "st1",
    rowType: "task",
    wbs: opts.wbs ?? id,
    name: id,
    plannedStart: iso(start),
    plannedFinish: iso(start + opts.dur),
    plannedDurationMinutes: opts.dur,
    plannedOperators: (opts.operatorIds ?? []).length,
    plannedManHours: 0,
    status: "not_started",
    percentComplete: 0,
    dependencyIds: [],
    criticalPath: false,
    bottleneckFlag: false,
    qualityGate: false,
    travelerSignoffRequired: false,
    customFields: { operatorIds: opts.operatorIds ?? [] },
  };
}

describe("computeOperatorIdleAnalysis", () => {
  it("derives per-operator idle and line efficiency from assignments", () => {
    // Makespan 60. A works the full 60 (0% idle); B works 30 of 60 (30 idle, 50% util).
    const tasks = [
      makeTask("t1", { dur: 60, start: 0, operatorIds: ["A"] }),
      makeTask("t2", { dur: 30, start: 0, operatorIds: ["B"] }),
    ];

    const analysis = computeOperatorIdleAnalysis(tasks, ["A", "B", "C"]);

    expect(analysis.makespanMinutes).toBe(60);
    expect(analysis.operatorsUsed).toBe(2);
    expect(analysis.totalWorkMinutes).toBe(90);
    expect(analysis.totalIdleMinutes).toBe(30); // 2*60 - 90
    expect(Math.round(analysis.efficiencyPercent)).toBe(75);
    expect(Math.round(analysis.balanceDelayPercent)).toBe(25);

    const [first, second] = analysis.operators; // busiest first
    expect(first.operatorId).toBe("A");
    expect(first.busyMinutes).toBe(60);
    expect(first.idleMinutes).toBe(0);
    expect(Math.round(first.utilizationPercent)).toBe(100);
    expect(second.operatorId).toBe("B");
    expect(second.idleMinutes).toBe(30);
    expect(Math.round(second.utilizationPercent)).toBe(50);
  });

  it("counts idle as gap + tail time across a multi-task operator", () => {
    // Makespan 100. A: t1 0-30 then t3 80-100 => busy 50, idle 50 (a 50-min gap/tail).
    const tasks = [
      makeTask("t1", { dur: 30, start: 0, operatorIds: ["A"] }),
      makeTask("t3", { dur: 20, start: 80, operatorIds: ["A"] }),
    ];

    const analysis = computeOperatorIdleAnalysis(tasks, ["A"]);

    expect(analysis.makespanMinutes).toBe(100);
    expect(analysis.operators[0].busyMinutes).toBe(50);
    expect(analysis.operators[0].idleMinutes).toBe(50);
    expect(Math.round(analysis.operators[0].utilizationPercent)).toBe(50);
  });

  it("reports no utilization when nothing is assigned", () => {
    const analysis = computeOperatorIdleAnalysis([makeTask("t1", { dur: 60 })], ["A", "B"]);
    expect(analysis.operatorsUsed).toBe(0);
    expect(analysis.efficiencyPercent).toBe(0);
    expect(analysis.operators).toHaveLength(0);
  });
});
