/**
 * Optimization tuning harness — scores "Optimize line" scheduling strategies against a rubric of
 * the three KPIs the user cares about: lead time, man-hours, and idle time. Runs each candidate
 * strategy over a suite of representative synthetic plans (so we don't overfit one shape), then
 * prints a per-plan leaderboard plus an overall ranking.
 *
 * Run: npx tsx scripts/tune-optimization.ts
 *
 * Deterministic only — uses the pure domain functions. Nothing here ships; it's a dev tuning tool.
 */
import { optimizeLine, type OptimizeLineConstraints, type OptimizeLineStrategy } from "../src/domain/joint-scheduler";
import { computeOperatorIdleAnalysis } from "../src/domain/operator-allocation";
import { getStoredTaskOperatorIds } from "../src/domain/operator-assignments";
import type { Task } from "../src/domain/types";

const BASE = "2026-01-01T00:00:00.000Z";
function iso(min: number) {
  return new Date(Date.parse(BASE) + min * 60_000).toISOString();
}
function t(id: string, dur: number, deps: string[] = []): Task {
  return {
    id,
    scenarioId: "s",
    stationId: "st",
    rowType: "task",
    wbs: id,
    name: id,
    plannedStart: BASE,
    plannedFinish: iso(dur),
    plannedDurationMinutes: dur,
    plannedOperators: 0,
    plannedManHours: 0,
    status: "not_started",
    percentComplete: 0,
    dependencyIds: deps,
    criticalPath: false,
    bottleneckFlag: false,
    qualityGate: false,
    travelerSignoffRequired: false,
    customFields: {},
  };
}

const HUGE = 1_000_000;

interface Plan {
  name: string;
  tasks: Task[];
  constraints: OptimizeLineConstraints;
}

const PLANS: Plan[] = [
  {
    name: "serial-chain",
    tasks: [t("a", 60), t("b", 60, ["a"]), t("c", 60, ["b"]), t("d", 60, ["c"]), t("e", 60, ["d"]), t("f", 60, ["e"])],
    constraints: { availableOperatorIds: ["A", "B", "C", "D", "E", "F"], demandQuantity: 1, operatorCapacityMinutes: HUGE },
  },
  {
    name: "wide-parallel-ample",
    tasks: ["a", "b", "c", "d", "e", "f"].map((id) => t(id, 60)),
    constraints: { availableOperatorIds: ["A", "B", "C", "D", "E", "F"], demandQuantity: 1, operatorCapacityMinutes: HUGE },
  },
  {
    name: "mixed-long-chain+side",
    tasks: [t("c1", 100), t("c2", 100, ["c1"]), t("s1", 40), t("s2", 40), t("s3", 40)],
    constraints: { availableOperatorIds: ["A", "B", "C", "D"], demandQuantity: 1, operatorCapacityMinutes: HUGE },
  },
  {
    name: "high-demand-capacity-bound",
    tasks: ["a", "b", "c", "d", "e", "f"].map((id) => t(id, 60)),
    // period work = 6*60*1 = 360; capacity 120 => floor 3 operators
    constraints: { availableOperatorIds: ["A", "B", "C", "D", "E", "F"], demandQuantity: 1, operatorCapacityMinutes: 120 },
  },
  {
    name: "diamond",
    tasks: [t("start", 30), t("l1", 90, ["start"]), t("l2", 30, ["start"]), t("l3", 30, ["l2"]), t("end", 30, ["l1", "l3"])],
    constraints: { availableOperatorIds: ["A", "B", "C"], demandQuantity: 1, operatorCapacityMinutes: HUGE },
  },
];

const STRATEGIES: OptimizeLineStrategy[] = ["idle-first", "lead-time", "balanced"];

// Rubric weights (lower composite = better). ABSOLUTE ratios so scores are stable + comparable:
//   leadTerm = leadTime / shortestLead − 1   idleTerm = idle / productiveWork
const WEIGHTS = { lead: 0.45, idle: 0.55 };

interface Kpis {
  strategy: OptimizeLineStrategy;
  leadTime: number;
  manHours: number; // productive labor = sum(duration * operators)
  idle: number;
  operators: number;
  laborHours: number; // total paid operator-time = operators * makespan (productive + idle)
  unassigned: number;
}

function evaluate(plan: Plan, strategy: OptimizeLineStrategy): Kpis {
  const { tasks, metrics } = optimizeLine(plan.tasks, plan.constraints, strategy);
  const analysis = computeOperatorIdleAnalysis(tasks, plan.constraints.availableOperatorIds);
  const manHours = tasks.reduce(
    (sum, task) => sum + Math.max(task.plannedDurationMinutes, 0) * getStoredTaskOperatorIds(task).length,
    0,
  );
  return {
    strategy,
    leadTime: metrics.leadTimeMinutes,
    manHours,
    // Use the analysis idle (makespan − busy, what the Labor panel shows) consistently, so idle and
    // laborHours (= productive man-hours + idle) reconcile across strategies.
    idle: analysis.totalIdleMinutes,
    operators: metrics.operatorsUsed,
    laborHours: analysis.operatorsUsed * analysis.makespanMinutes,
    unassigned: metrics.unassignedTaskCount,
  };
}

function fmt(n: number, width = 7) {
  return String(Math.round(n)).padStart(width);
}

console.log(`\nOptimization rubric — absolute ratios, weights: lead ${WEIGHTS.lead}, idle ${WEIGHTS.idle} (lower composite = better)\n`);

const overall = new Map<OptimizeLineStrategy, number[]>(STRATEGIES.map((s) => [s, []]));

for (const plan of PLANS) {
  const rows = STRATEGIES.map((s) => evaluate(plan, s));
  const shortestLead = Math.min(...rows.map((r) => r.leadTime)) || 1;
  const work = Math.max(...rows.map((r) => r.manHours)) || 1; // productive work content (≈ constant across strategies)
  const composites = rows.map((r) => WEIGHTS.lead * (r.leadTime / shortestLead - 1) + WEIGHTS.idle * (r.idle / work));

  console.log(`■ ${plan.name}`);
  console.log(`  strategy      lead   manHrs   idle    ops   laborHrs  unassigned  composite`);
  rows.forEach((r, i) => {
    overall.get(r.strategy)!.push(composites[i]);
    const best = composites[i] === Math.min(...composites) ? " ◀ best" : "";
    console.log(
      `  ${r.strategy.padEnd(11)} ${fmt(r.leadTime)} ${fmt(r.manHours)} ${fmt(r.idle)} ${fmt(r.operators, 5)} ${fmt(r.laborHours, 9)} ${fmt(r.unassigned, 10)}    ${composites[i].toFixed(3)}${best}`,
    );
  });
  console.log("");
}

console.log("Overall mean composite (lower = better balance across all plans):");
[...overall.entries()]
  .map(([s, cs]) => ({ s, mean: cs.reduce((a, b) => a + b, 0) / cs.length }))
  .sort((a, b) => a.mean - b.mean)
  .forEach((row, i) => console.log(`  ${i === 0 ? "►" : " "} ${row.s.padEnd(11)} ${row.mean.toFixed(3)}`));
console.log("");
