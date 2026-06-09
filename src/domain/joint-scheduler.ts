import { calculatePlannedCycleMinutes } from "./calculations";
import { computeOperatorIdleAnalysis, isAllocatableOperatorTask } from "./operator-allocation";
import { getTaskOperatorPatch, getTaskOperatorResetPatch } from "./operator-assignments";
import { addMinutes, computeCriticalPath, rescheduleTasksByDependencies } from "./task-scheduling";
import type { Task } from "./types";

/**
 * Deterministic joint scheduler + crew-leveler ("Optimize line").
 *
 * Two strategies (see OptimizeLineStrategy):
 * - "idle-first" (default): minimize operator idle. Total idle = crew × makespan − work, so it uses
 *   the leanest crew that still meets demand (the capacity floor) and list-schedules it densely
 *   (each task to the operator free earliest after its deps finish). Lead time is free.
 * - "lead-time": shortest lead time. Pull every task to its earliest dependency-feasible start,
 *   derive critical-path float, then staff with the fewest operators, leveling non-critical work
 *   only within FREE float (slack that delays no successor) so the finish never slips.
 *
 * Pure + deterministic: no Supabase, no network, no Date.now() in the scheduling math (the line
 * start is taken from the tasks). The LLM is intentionally not involved (it steers later phases).
 */

export interface OptimizeLineConstraints {
  availableOperatorIds: string[];
  demandQuantity: number;
  /** Per-operator capacity for the demand period (minutes). <= 0 means no capacity. */
  operatorCapacityMinutes: number;
}

export interface OptimizeLineMetrics {
  leadTimeMinutes: number;
  operatorsUsed: number;
  loadSpreadMinutes: number;
  idleMinutes: number;
  unassignedTaskCount: number;
  allocatableTaskCount: number;
  /** Whether leveling moved any task later within its free float. */
  delayedTaskCount: number;
}

export interface OptimizeLineResult {
  tasks: Task[];
  metrics: OptimizeLineMetrics;
}

/**
 * - "idle-first" (default): leanest crew (the capacity-floor headcount that still meets demand),
 *   list-scheduled densely so operators run back-to-back — drives idle toward zero, lead time free.
 * - "lead-time": ASAP schedule (shortest lead time) + level non-critical work within free float.
 */
export type OptimizeLineStrategy = "idle-first" | "lead-time";

interface Interval {
  startMs: number;
  finishMs: number;
}

interface OperatorState {
  operatorId: string;
  intervals: Interval[];
  periodMinutes: number;
}

function intervalsOverlap(startMs: number, finishMs: number, interval: Interval): boolean {
  return startMs < interval.finishMs && finishMs > interval.startMs;
}

function isFreeAt(operator: OperatorState, startMs: number, durationMs: number): boolean {
  const finishMs = startMs + durationMs;
  return !operator.intervals.some((interval) => intervalsOverlap(startMs, finishMs, interval));
}

/** Earliest start in [esMs, maxStartMs] at which the operator is free for `durationMs`, else undefined. */
function earliestFreeStart(operator: OperatorState, esMs: number, durationMs: number, maxStartMs: number): number | undefined {
  if (esMs > maxStartMs) {
    return undefined;
  }
  const sorted = [...operator.intervals].sort((left, right) => left.startMs - right.startMs);
  let candidate = esMs;
  let moved = true;
  while (moved) {
    moved = false;
    for (const interval of sorted) {
      if (intervalsOverlap(candidate, candidate + durationMs, interval)) {
        candidate = interval.finishMs;
        moved = true;
        if (candidate > maxStartMs) {
          return undefined;
        }
      }
    }
  }
  return candidate <= maxStartMs ? candidate : undefined;
}

function scheduleLeadTime(tasks: Task[], constraints: OptimizeLineConstraints): OptimizeLineResult {
  const { availableOperatorIds, demandQuantity, operatorCapacityMinutes } = constraints;
  const periodDemand = Math.max(demandQuantity, 0);
  const capacity = operatorCapacityMinutes;

  // --- A. ASAP schedule: collapse every task to the earliest its dependencies allow. ---
  const startTimes = tasks.map((task) => Date.parse(task.plannedStart)).filter(Number.isFinite);
  const lineStartMs = startTimes.length ? Math.min(...startTimes) : 0;
  const lineStartIso = new Date(lineStartMs).toISOString();
  const flattened = tasks.map((task) => ({
    ...task,
    plannedStart: lineStartIso,
    plannedFinish: addMinutes(lineStartIso, Math.max(task.plannedDurationMinutes, 0)),
  }));
  const scheduled = rescheduleTasksByDependencies(flattened);

  // --- B. Critical-path float over the ASAP schedule. ---
  const floatById = computeCriticalPath(scheduled);

  // --- C. Lean, balanced staffing with free-float leveling. ---
  const allocatable = scheduled.filter((task) => isAllocatableOperatorTask(task, scheduled));
  // Process earliest-start first; critical tasks (no slack) before flexible ones; longer first.
  const ordered = [...allocatable].sort((left, right) => {
    const leftFloat = floatById.get(left.id);
    const rightFloat = floatById.get(right.id);
    const leftStart = leftFloat?.earlyStartMs ?? Date.parse(left.plannedStart);
    const rightStart = rightFloat?.earlyStartMs ?? Date.parse(right.plannedStart);
    if (leftStart !== rightStart) {
      return leftStart - rightStart;
    }
    const leftCritical = leftFloat?.isCritical ? 0 : 1;
    const rightCritical = rightFloat?.isCritical ? 0 : 1;
    if (leftCritical !== rightCritical) {
      return leftCritical - rightCritical;
    }
    return Math.max(right.plannedDurationMinutes, 0) - Math.max(left.plannedDurationMinutes, 0);
  });

  const opened = new Map<string, OperatorState>();
  const assignmentByTaskId = new Map<string, string>();
  const startMsByTaskId = new Map<string, number>();
  let delayedTaskCount = 0;

  function capacityFits(operator: OperatorState | undefined, periodMinutes: number): boolean {
    const current = operator?.periodMinutes ?? 0;
    if (capacity > 0) {
      return current + periodMinutes <= capacity;
    }
    return periodMinutes === 0;
  }

  function assign(operator: OperatorState, taskId: string, startMs: number, durationMs: number, periodMinutes: number, esMs: number) {
    operator.intervals.push({ startMs, finishMs: startMs + durationMs });
    operator.periodMinutes += periodMinutes;
    assignmentByTaskId.set(taskId, operator.operatorId);
    startMsByTaskId.set(taskId, startMs);
    if (startMs > esMs) {
      delayedTaskCount += 1;
    }
  }

  for (const task of ordered) {
    const durationMinutes = Math.max(task.plannedDurationMinutes, 0);
    const durationMs = durationMinutes * 60_000;
    const periodMinutes = durationMinutes * periodDemand;
    const esMs = Date.parse(task.plannedStart);
    if (!Number.isFinite(esMs)) {
      continue;
    }
    const info = floatById.get(task.id);
    const maxDelayMs = info && !info.isCritical ? Math.max(0, info.freeFloatMinutes) * 60_000 : 0;
    const maxStartMs = esMs + maxDelayMs;

    const openedStates = [...opened.values()];

    // 1) Reuse an already-open operator that is free right now (balance: least-loaded wins).
    const freeNow = openedStates
      .filter((operator) => capacityFits(operator, periodMinutes) && isFreeAt(operator, esMs, durationMs))
      .sort((left, right) => left.periodMinutes - right.periodMinutes || left.operatorId.localeCompare(right.operatorId));
    if (freeNow[0]) {
      assign(freeNow[0], task.id, esMs, durationMs, periodMinutes, esMs);
      continue;
    }

    // 2) Delay within free float to reuse an open operator instead of opening a new one.
    let bestDelay: { operator: OperatorState; startMs: number } | undefined;
    if (maxDelayMs > 0) {
      for (const operator of openedStates) {
        if (!capacityFits(operator, periodMinutes)) {
          continue;
        }
        const slot = earliestFreeStart(operator, esMs, durationMs, maxStartMs);
        if (slot === undefined) {
          continue;
        }
        if (
          !bestDelay ||
          slot < bestDelay.startMs ||
          (slot === bestDelay.startMs && operator.periodMinutes < bestDelay.operator.periodMinutes)
        ) {
          bestDelay = { operator, startMs: slot };
        }
      }
    }
    if (bestDelay) {
      assign(bestDelay.operator, task.id, bestDelay.startMs, durationMs, periodMinutes, esMs);
      continue;
    }

    // 3) Open a fresh operator only when forced.
    const nextOperatorId = availableOperatorIds.find((operatorId) => !opened.has(operatorId));
    if (nextOperatorId && capacityFits(undefined, periodMinutes)) {
      const operator: OperatorState = { operatorId: nextOperatorId, intervals: [], periodMinutes: 0 };
      opened.set(nextOperatorId, operator);
      assign(operator, task.id, esMs, durationMs, periodMinutes, esMs);
      continue;
    }

    // Otherwise: no open operator free, no new operator available, no in-float slot left —
    // the task stays unassigned and is surfaced in metrics.unassignedTaskCount.
  }

  // --- Apply: new start times (leveled) + operator assignments onto the task set. ---
  const allocatableIds = new Set(allocatable.map((task) => task.id));
  const nextTasks = scheduled.map((task) => {
    if (!allocatableIds.has(task.id)) {
      // Summary / non-allocatable rows keep ASAP dates and carry no operators.
      return { ...task, ...getTaskOperatorResetPatch(task) };
    }
    const operatorId = assignmentByTaskId.get(task.id);
    const startMs = startMsByTaskId.get(task.id);
    const durationMinutes = Math.max(task.plannedDurationMinutes, 0);
    const dated = startMs !== undefined
      ? {
          ...task,
          plannedStart: new Date(startMs).toISOString(),
          plannedFinish: addMinutes(new Date(startMs).toISOString(), durationMinutes),
        }
      : task;
    const operatorPatch = getTaskOperatorPatch(dated, operatorId ? [operatorId] : [], availableOperatorIds);
    return { ...dated, ...operatorPatch };
  });

  // --- Metrics ---
  const usedOperators = [...opened.values()].filter((operator) => operator.intervals.length > 0);
  const loads = usedOperators.map((operator) => operator.periodMinutes);
  const loadSpreadMinutes = loads.length ? Math.max(...loads) - Math.min(...loads) : 0;
  const idleMinutes = usedOperators.reduce((total, operator) => {
    const sorted = [...operator.intervals].sort((left, right) => left.startMs - right.startMs);
    let gap = 0;
    for (let index = 1; index < sorted.length; index += 1) {
      gap += Math.max(0, sorted[index].startMs - sorted[index - 1].finishMs);
    }
    return total + gap / 60_000;
  }, 0);
  const unassignedTaskCount = allocatable.filter((task) => !assignmentByTaskId.has(task.id)).length;

  return {
    tasks: nextTasks,
    metrics: {
      leadTimeMinutes: calculatePlannedCycleMinutes(nextTasks),
      operatorsUsed: usedOperators.length,
      loadSpreadMinutes,
      idleMinutes,
      unassignedTaskCount,
      allocatableTaskCount: allocatable.length,
      delayedTaskCount,
    },
  };
}

/**
 * Idle-first staffing: minimize operator idle by using the leanest crew that still meets demand
 * (the capacity floor) and list-scheduling tasks densely — each task goes to the operator that can
 * start it earliest once its dependencies finish, so operators run back-to-back. Lead time is
 * whatever that lean crew needs (not minimized). Total idle = crew × makespan − work, which this
 * drives toward zero by shrinking the crew and packing it.
 */
function scheduleIdleFirst(tasks: Task[], constraints: OptimizeLineConstraints): OptimizeLineResult {
  const { availableOperatorIds, demandQuantity, operatorCapacityMinutes } = constraints;
  const periodDemand = Math.max(demandQuantity, 0);
  const allocatable = tasks.filter((task) => isAllocatableOperatorTask(task, tasks));
  const allocatableIds = new Set(allocatable.map((task) => task.id));
  const startTimes = tasks.map((task) => Date.parse(task.plannedStart)).filter(Number.isFinite);
  const lineStartMs = startTimes.length ? Math.min(...startTimes) : 0;

  // Leanest crew that still fits the demand-period workload, capped by the available pool.
  const totalWorkMinutes = allocatable.reduce((total, task) => total + Math.max(task.plannedDurationMinutes, 0), 0);
  const totalPeriodMinutes = totalWorkMinutes * periodDemand;
  const capacityFloor = operatorCapacityMinutes > 0
    ? Math.max(1, Math.ceil(totalPeriodMinutes / operatorCapacityMinutes))
    : availableOperatorIds.length;
  const crewSize = Math.min(Math.max(capacityFloor, availableOperatorIds.length > 0 ? 1 : 0), availableOperatorIds.length);
  const pool = availableOperatorIds.slice(0, crewSize);

  const assignment = new Map<string, { operatorId: string; startMs: number; finishMs: number }>();

  if (pool.length > 0) {
    const finishMsById = new Map<string, number>();
    const operatorFreeMs = new Map(pool.map((operatorId) => [operatorId, lineStartMs]));
    const operatorPeriodMinutes = new Map(pool.map((operatorId) => [operatorId, 0]));
    const scheduled = new Set<string>();

    // Earliest the task can start: after every allocatable predecessor finishes; undefined if a
    // predecessor isn't scheduled yet (so the task isn't ready).
    function readyTime(task: Task): number | undefined {
      let readyMs = lineStartMs;
      for (const dependencyId of task.dependencyIds) {
        if (!allocatableIds.has(dependencyId)) {
          continue;
        }
        const finish = finishMsById.get(dependencyId);
        if (finish === undefined) {
          return undefined;
        }
        readyMs = Math.max(readyMs, finish);
      }
      return readyMs;
    }

    let guard = allocatable.length + 1;
    while (scheduled.size < allocatable.length && guard > 0) {
      guard -= 1;
      const ready = allocatable
        .filter((task) => !scheduled.has(task.id))
        .map((task) => ({ task, readyMs: readyTime(task) }))
        .filter((entry): entry is { task: Task; readyMs: number } => entry.readyMs !== undefined)
        .sort((left, right) => {
          if (left.readyMs !== right.readyMs) {
            return left.readyMs - right.readyMs;
          }
          const leftDuration = Math.max(left.task.plannedDurationMinutes, 0);
          const rightDuration = Math.max(right.task.plannedDurationMinutes, 0);
          if (leftDuration !== rightDuration) {
            return rightDuration - leftDuration; // longest first packs better
          }
          return Number.parseFloat(left.task.wbs) - Number.parseFloat(right.task.wbs);
        });

      if (ready.length === 0) {
        break; // remaining tasks have unresolved dependencies (cycle / external) — leave unassigned
      }

      const { task, readyMs } = ready[0];
      const durationMinutes = Math.max(task.plannedDurationMinutes, 0);
      const durationMs = durationMinutes * 60_000;
      const periodMinutes = durationMinutes * periodDemand;

      const candidates = pool.map((operatorId) => {
        const current = operatorPeriodMinutes.get(operatorId) ?? 0;
        return {
          operatorId,
          startMs: Math.max(readyMs, operatorFreeMs.get(operatorId) ?? lineStartMs),
          periodMinutes: current,
          capacityOk: operatorCapacityMinutes > 0 ? current + periodMinutes <= operatorCapacityMinutes : periodMinutes === 0,
        };
      });
      const eligible = candidates.filter((candidate) => candidate.capacityOk);
      const pickFrom = eligible.length ? eligible : candidates; // never strand a task on capacity alone
      pickFrom.sort((left, right) =>
        left.startMs - right.startMs ||
        left.periodMinutes - right.periodMinutes ||
        left.operatorId.localeCompare(right.operatorId),
      );

      const chosen = pickFrom[0];
      const finishMs = chosen.startMs + durationMs;
      assignment.set(task.id, { operatorId: chosen.operatorId, startMs: chosen.startMs, finishMs });
      operatorFreeMs.set(chosen.operatorId, finishMs);
      operatorPeriodMinutes.set(chosen.operatorId, chosen.periodMinutes + periodMinutes);
      finishMsById.set(task.id, finishMs);
      scheduled.add(task.id);
    }
  }

  const nextTasks = tasks.map((task) => {
    if (!allocatableIds.has(task.id)) {
      return { ...task, ...getTaskOperatorResetPatch(task) };
    }
    const placed = assignment.get(task.id);
    const durationMinutes = Math.max(task.plannedDurationMinutes, 0);
    const dated = placed
      ? {
          ...task,
          plannedStart: new Date(placed.startMs).toISOString(),
          plannedFinish: addMinutes(new Date(placed.startMs).toISOString(), durationMinutes),
        }
      : task;
    const operatorPatch = getTaskOperatorPatch(dated, placed ? [placed.operatorId] : [], availableOperatorIds);
    return { ...dated, ...operatorPatch };
  });

  const analysis = computeOperatorIdleAnalysis(nextTasks, availableOperatorIds);
  const loads = analysis.operators.map((operator) => operator.busyMinutes);
  const loadSpreadMinutes = loads.length ? Math.max(...loads) - Math.min(...loads) : 0;
  const unassignedTaskCount = allocatable.filter((task) => !assignment.has(task.id)).length;

  return {
    tasks: nextTasks,
    metrics: {
      leadTimeMinutes: analysis.makespanMinutes,
      operatorsUsed: analysis.operatorsUsed,
      loadSpreadMinutes,
      idleMinutes: analysis.totalIdleMinutes,
      unassignedTaskCount,
      allocatableTaskCount: allocatable.length,
      delayedTaskCount: 0,
    },
  };
}

export function optimizeLine(
  tasks: Task[],
  constraints: OptimizeLineConstraints,
  strategy: OptimizeLineStrategy = "idle-first",
): OptimizeLineResult {
  return strategy === "lead-time" ? scheduleLeadTime(tasks, constraints) : scheduleIdleFirst(tasks, constraints);
}
