import { calculatePeakManpower, formatMinutes, round } from "./calculations";
import type { IeSmartAllocationAssignment } from "./ie-smart-allocation";
import { getStoredTaskOperatorIds, getTaskOperatorIds, getTaskOperatorPatch } from "./operator-assignments";
import type { Task } from "./types";

export type OperatorBlockKind = "capacity" | "schedule";
export type OperatorAllocationIssueReason =
  | "all_operators_occupied"
  | "all_operators_over_capacity"
  | "mixed_constraints"
  | "no_operators"
  | "single_operator_period_capacity";

export interface OperatorBlockState {
  reason: string;
  kind: OperatorBlockKind;
}

export interface OperatorAllocationIssue {
  kind: "budget_overage" | "capacity_overage" | "schedule_conflict" | "takt_overage" | "unassigned_task";
  message: string;
  severity?: "blocker" | "warning";
  reason?: OperatorAllocationIssueReason;
  operatorId?: string;
  taskId?: string;
  conflictingTaskId?: string;
}

export interface OperatorAllocationAuditOperator {
  operatorId: string;
  assignedTaskCount: number;
  assignedMinutes: number;
  utilizationPercent: number;
  budgetVarianceMinutes: number;
  idleGapCount: number;
  idleMinutes: number;
  sameZoneHandoffCount: number;
  sameStationHandoffCount: number;
  zoneSwitchCount: number;
  assignedTaskLabels: string[];
}

export interface OperatorAllocationAudit {
  eligibleTaskCount: number;
  assignedTaskCount: number;
  unassignedTaskCount: number;
  assignmentCoveragePercent: number;
  summaryTaskCount: number;
  summaryTaskAssignmentCount: number;
  peakManpower: number;
  blockerCount: number;
  warningCount: number;
  scheduleConflictCount: number;
  physicalCapacityOverageCount: number;
  budgetOverageCount: number;
  taktOverageCount: number;
  loadSpreadMinutes: number;
  loadSpreadPercent: number;
  operators: OperatorAllocationAuditOperator[];
  strategyNotes: string[];
}

function compareTasksBySchedule(a: Task, b: Task) {
  const startA = Date.parse(a.plannedStart);
  const startB = Date.parse(b.plannedStart);
  const safeStartA = Number.isFinite(startA) ? startA : Number.MAX_SAFE_INTEGER;
  const safeStartB = Number.isFinite(startB) ? startB : Number.MAX_SAFE_INTEGER;

  if (safeStartA !== safeStartB) {
    return safeStartA - safeStartB;
  }

  return Number.parseFloat(a.wbs) - Number.parseFloat(b.wbs);
}

function getTaskWindowMs(task: Task) {
  const startMs = Date.parse(task.plannedStart);
  const finishMs = Date.parse(task.plannedFinish);

  if (!Number.isFinite(startMs) || !Number.isFinite(finishMs) || finishMs <= startMs) {
    return undefined;
  }

  return { startMs, finishMs };
}

export function isSummaryTask(task: Task, tasks: Task[]) {
  const childPrefix = `${task.wbs}.`;
  return tasks.some((candidate) => candidate.id !== task.id && candidate.wbs.startsWith(childPrefix));
}

export function isAllocatableOperatorTask(task: Task, tasks: Task[]) {
  return task.plannedDurationMinutes > 0 && !isSummaryTask(task, tasks);
}

function getAllocatableOperatorTasks(tasks: Task[]) {
  return tasks.filter((task) => isAllocatableOperatorTask(task, tasks));
}

function getTaskPeriodMinutes(task: Task, demandQuantity: number) {
  return Math.max(task.plannedDurationMinutes, 0) * Math.max(demandQuantity, 0);
}

function getTaskSuccessorCount(task: Task, tasks: Task[]) {
  return tasks.reduce((count, candidate) => count + (candidate.dependencyIds.includes(task.id) ? 1 : 0), 0);
}

function getTaskPriorityScore(task: Task, tasks: Task[], taktMinutes: number) {
  const overTaktScore = taktMinutes > 0 && task.plannedDurationMinutes > taktMinutes ? 1_000_000 : 0;
  const bottleneckScore = task.bottleneckFlag ? 150_000 : 0;
  const criticalPathScore = task.criticalPath ? 75_000 : 0;
  const successorScore = getTaskSuccessorCount(task, tasks) * 5_000;
  const durationScore = Math.max(task.plannedDurationMinutes, 0);

  return overTaktScore + bottleneckScore + criticalPathScore + successorScore + durationScore;
}

function compareTasksBySmartPriority(tasks: Task[], taktMinutes: number) {
  return (a: Task, b: Task) => {
    const priorityDelta = getTaskPriorityScore(b, tasks, taktMinutes) - getTaskPriorityScore(a, tasks, taktMinutes);
    if (priorityDelta !== 0) {
      return priorityDelta;
    }

    return compareTasksBySchedule(a, b);
  };
}

function sameOperatorIds(a: string[], b: string[]) {
  if (a.length !== b.length) {
    return false;
  }

  const aSet = new Set(a);
  return b.every((operatorId) => aSet.has(operatorId));
}

export function taskWindowsOverlap(task: Task, otherTask: Task) {
  const startMs = Date.parse(task.plannedStart);
  const finishMs = Date.parse(task.plannedFinish);
  const otherStartMs = Date.parse(otherTask.plannedStart);
  const otherFinishMs = Date.parse(otherTask.plannedFinish);

  if (![startMs, finishMs, otherStartMs, otherFinishMs].every(Number.isFinite)) {
    return false;
  }

  return startMs < otherFinishMs && finishMs > otherStartMs;
}

function getTaskLabel(task: Task) {
  return `${task.wbs} ${task.name}`.trim();
}

function getOperatorScheduleContext(
  operatorId: string,
  task: Task,
  tasks: Task[],
  availableOperatorIds: string[],
) {
  const taskWindow = getTaskWindowMs(task);
  let closestIdleGapMinutes = Number.POSITIVE_INFINITY;
  let sameZoneContinuity = false;
  let sameStationContinuity = false;

  tasks.forEach((candidate) => {
    if (candidate.id === task.id || !getTaskOperatorIds(candidate, availableOperatorIds).includes(operatorId)) {
      return;
    }

    const candidateWindow = getTaskWindowMs(candidate);
    if (!taskWindow || !candidateWindow) {
      return;
    }

    if (task.zoneId && candidate.zoneId === task.zoneId) {
      sameZoneContinuity = true;
    }

    if (task.stationId && candidate.stationId === task.stationId) {
      sameStationContinuity = true;
    }

    if (candidateWindow.finishMs <= taskWindow.startMs) {
      closestIdleGapMinutes = Math.min(
        closestIdleGapMinutes,
        (taskWindow.startMs - candidateWindow.finishMs) / 60000,
      );
    } else if (candidateWindow.startMs >= taskWindow.finishMs) {
      closestIdleGapMinutes = Math.min(
        closestIdleGapMinutes,
        (candidateWindow.startMs - taskWindow.finishMs) / 60000,
      );
    }
  });

  return {
    closestIdleGapMinutes: Number.isFinite(closestIdleGapMinutes) ? closestIdleGapMinutes : 0,
    sameStationContinuity,
    sameZoneContinuity,
  };
}

export function getOperatorAssignedPeriodMinutes(
  operatorId: string,
  tasks: Task[],
  availableOperatorIds: string[],
  demandQuantity: number,
  excludedTaskId?: string,
) {
  const periodDemand = Math.max(demandQuantity, 0);

  return tasks.reduce((total, task) => {
    if (task.id === excludedTaskId || !getTaskOperatorIds(task, availableOperatorIds).includes(operatorId)) {
      return total;
    }

    return total + Math.max(task.plannedDurationMinutes, 0) * periodDemand;
  }, 0);
}

export function getOperatorAssignmentBlockState({
  availableOperatorIds,
  demandQuantity,
  operatorCapacityMinutes,
  operatorId,
  selected,
  taktMinutes,
  task,
  tasks,
}: {
  availableOperatorIds: string[];
  demandQuantity: number;
  operatorCapacityMinutes: number;
  operatorId: string;
  selected: boolean;
  taktMinutes: number;
  task: Task;
  tasks: Task[];
}): OperatorBlockState | undefined {
  if (selected) {
    return undefined;
  }

  const overlappingTask = tasks.find(
    (candidate) =>
      candidate.id !== task.id &&
      getTaskOperatorIds(candidate, availableOperatorIds).includes(operatorId) &&
      taskWindowsOverlap(task, candidate),
  );

  if (overlappingTask) {
    return {
      kind: "schedule",
      reason: `Operator ${operatorId} is occupied by ${overlappingTask.wbs} ${overlappingTask.name} during this time.`,
    };
  }

  if (taktMinutes > 0 && task.plannedDurationMinutes > taktMinutes) {
    return {
      kind: "capacity",
      reason: `Task duration ${formatMinutes(task.plannedDurationMinutes)} exceeds the ${formatMinutes(taktMinutes)} required takt.`,
    };
  }

  const currentMinutes = getOperatorAssignedPeriodMinutes(
    operatorId,
    tasks,
    availableOperatorIds,
    demandQuantity,
    task.id,
  );
  const taskMinutes = Math.max(task.plannedDurationMinutes, 0) * Math.max(demandQuantity, 0);

  if (operatorCapacityMinutes <= 0 && taskMinutes > 0) {
    return {
      kind: "capacity",
      reason: `Operator ${operatorId} has no available capacity for this demand period.`,
    };
  }

  if (operatorCapacityMinutes <= 0) {
    return undefined;
  }

  const currentUtilization = (currentMinutes / operatorCapacityMinutes) * 100;
  const nextUtilization = ((currentMinutes + taskMinutes) / operatorCapacityMinutes) * 100;

  if (currentUtilization >= 100 && taskMinutes > 0) {
    return {
      kind: "capacity",
      reason: `Operator ${operatorId} is already at ${round(currentUtilization, 0)}% utilization for this period.`,
    };
  }

  if (nextUtilization > 100) {
    return {
      kind: "capacity",
      reason: `Assigning ${operatorId} would raise utilization to ${round(nextUtilization, 0)}% for this period.`,
    };
  }

  return undefined;
}

export function validateOperatorAllocations({
  availableOperatorIds,
  budgetedAllocationPercent = 100,
  demandQuantity,
  operatorCapacityMinutes,
  taktMinutes,
  tasks,
}: {
  availableOperatorIds: string[];
  budgetedAllocationPercent?: number;
  demandQuantity: number;
  operatorCapacityMinutes: number;
  taktMinutes: number;
  tasks: Task[];
}) {
  const issues: OperatorAllocationIssue[] = [];
  const validationTasks = getAllocatableOperatorTasks(tasks);

  validationTasks.forEach((task) => {
    if (taktMinutes > 0 && task.plannedDurationMinutes > taktMinutes) {
      issues.push({
        kind: "takt_overage",
        severity: "warning",
        taskId: task.id,
        message: `${task.wbs} ${task.name} exceeds takt.`,
      });
    }
  });

  availableOperatorIds.forEach((operatorId) => {
    const assignedTasks = validationTasks.filter((task) => getTaskOperatorIds(task, availableOperatorIds).includes(operatorId));

    assignedTasks.forEach((task, index) => {
      assignedTasks.slice(index + 1).forEach((candidate) => {
        if (!taskWindowsOverlap(task, candidate)) {
          return;
        }

        issues.push({
          kind: "schedule_conflict",
          severity: "blocker",
          operatorId,
          taskId: task.id,
          conflictingTaskId: candidate.id,
          message: `Operator ${operatorId} is double-booked on ${task.wbs} and ${candidate.wbs}.`,
        });
      });
    });

    const assignedMinutes = getOperatorAssignedPeriodMinutes(
      operatorId,
      validationTasks,
      availableOperatorIds,
      demandQuantity,
    );

    if (operatorCapacityMinutes > 0 && assignedMinutes > operatorCapacityMinutes) {
      issues.push({
        kind: "capacity_overage",
        severity: "blocker",
        operatorId,
        message: `Operator ${operatorId} is over physical capacity.`,
      });
    }

    const budgetedMinutes = operatorCapacityMinutes * Math.max(budgetedAllocationPercent, 0) / 100;
    if (budgetedMinutes > 0 && assignedMinutes > budgetedMinutes) {
      issues.push({
        kind: "budget_overage",
        severity: "warning",
        operatorId,
        message: `Operator ${operatorId} is over budgeted allocation.`,
      });
    }
  });

  return issues;
}

function dedupeOperatorAllocationIssues(issues: OperatorAllocationIssue[]) {
  const seen = new Set<string>();
  return issues.filter((issue) => {
    const key = [
      issue.kind,
      issue.taskId ?? "",
      issue.operatorId ?? "",
      issue.conflictingTaskId ?? "",
      issue.reason ?? "",
      issue.message,
    ].join(":");

    if (seen.has(key)) {
      return false;
    }

    seen.add(key);
    return true;
  });
}

function buildUnassignedTaskIssue({
  availableOperatorIds,
  demandQuantity,
  diagnostics,
  operatorCapacityMinutes,
  task,
}: {
  availableOperatorIds: string[];
  demandQuantity: number;
  diagnostics: Array<{ conflict?: Task; withinCapacity: boolean }>;
  operatorCapacityMinutes: number;
  task: Task;
}): OperatorAllocationIssue {
  const taskPeriodMinutes = getTaskPeriodMinutes(task, demandQuantity);
  const taskLabel = getTaskLabel(task);

  if (availableOperatorIds.length === 0) {
    return {
      kind: "unassigned_task",
      severity: "blocker",
      reason: "no_operators",
      taskId: task.id,
      message: `${taskLabel} could not be assigned because no budgeted operators are available.`,
    };
  }

  if (operatorCapacityMinutes <= 0 && taskPeriodMinutes > 0) {
    return {
      kind: "unassigned_task",
      severity: "blocker",
      reason: "all_operators_over_capacity",
      taskId: task.id,
      message: `${taskLabel} could not be assigned because operator capacity for the demand period is zero.`,
    };
  }

  if (operatorCapacityMinutes > 0 && taskPeriodMinutes > operatorCapacityMinutes) {
    return {
      kind: "unassigned_task",
      severity: "blocker",
      reason: "single_operator_period_capacity",
      taskId: task.id,
      message: `${taskLabel} needs ${formatMinutes(taskPeriodMinutes)} per operator for the demand period, above the ${formatMinutes(operatorCapacityMinutes)} operator capacity. Split the task, reduce duration/demand, or model a different work pattern.`,
    };
  }

  const occupiedCount = diagnostics.filter((diagnostic) => diagnostic.conflict).length;
  const overCapacityCount = diagnostics.filter((diagnostic) => !diagnostic.withinCapacity).length;

  if (occupiedCount === availableOperatorIds.length) {
    return {
      kind: "unassigned_task",
      severity: "blocker",
      reason: "all_operators_occupied",
      taskId: task.id,
      message: `${taskLabel} has no available operator in its scheduled window; all operators are occupied by overlapping work.`,
    };
  }

  if (overCapacityCount === availableOperatorIds.length) {
    return {
      kind: "unassigned_task",
      severity: "blocker",
      reason: "all_operators_over_capacity",
      taskId: task.id,
      message: `${taskLabel} has no operator with remaining period capacity.`,
    };
  }

  return {
    kind: "unassigned_task",
    severity: "blocker",
    reason: "mixed_constraints",
    taskId: task.id,
    message: `${taskLabel} could not be assigned because every operator is blocked by schedule overlap or remaining capacity.`,
  };
}

function getOperatorAssignmentDiagnostics({
  availableOperatorIds,
  demandQuantity,
  operatorCapacityMinutes,
  task,
  tasks,
}: {
  availableOperatorIds: string[];
  demandQuantity: number;
  operatorCapacityMinutes: number;
  task: Task;
  tasks: Task[];
}) {
  const taskPeriodMinutes = getTaskPeriodMinutes(task, demandQuantity);

  return availableOperatorIds.map((operatorId) => {
    const conflict = tasks.find(
      (candidate) =>
        candidate.id !== task.id &&
        getTaskOperatorIds(candidate, availableOperatorIds).includes(operatorId) &&
        taskWindowsOverlap(task, candidate),
    );
    const currentMinutes = getOperatorAssignedPeriodMinutes(
      operatorId,
      tasks,
      availableOperatorIds,
      demandQuantity,
      task.id,
    );
    const nextMinutes = currentMinutes + taskPeriodMinutes;

    return {
      conflict,
      withinCapacity: taskPeriodMinutes === 0 || (operatorCapacityMinutes > 0 && nextMinutes <= operatorCapacityMinutes),
    };
  });
}

function issueSeverity(issue: OperatorAllocationIssue) {
  return issue.severity ??
    (issue.kind === "unassigned_task" || issue.kind === "capacity_overage" || issue.kind === "schedule_conflict"
      ? "blocker"
      : "warning");
}

function getOperatorIdleAndContinuity(operatorId: string, assignedTasks: Task[], availableOperatorIds: string[]) {
  const sortedTasks = [...assignedTasks]
    .filter((task) => getTaskOperatorIds(task, availableOperatorIds).includes(operatorId))
    .sort(compareTasksBySchedule);
  let idleGapCount = 0;
  let idleMinutes = 0;
  let sameZoneHandoffCount = 0;
  let sameStationHandoffCount = 0;
  let zoneSwitchCount = 0;

  sortedTasks.forEach((task, index) => {
    const previousTask = sortedTasks[index - 1];
    if (!previousTask) {
      return;
    }

    const previousWindow = getTaskWindowMs(previousTask);
    const taskWindow = getTaskWindowMs(task);
    if (previousWindow && taskWindow && taskWindow.startMs > previousWindow.finishMs) {
      idleGapCount += 1;
      idleMinutes += (taskWindow.startMs - previousWindow.finishMs) / 60000;
    }

    if (previousTask.zoneId && task.zoneId && previousTask.zoneId === task.zoneId) {
      sameZoneHandoffCount += 1;
    }

    if (previousTask.stationId && task.stationId && previousTask.stationId === task.stationId) {
      sameStationHandoffCount += 1;
    }

    if (previousTask.zoneId && task.zoneId && previousTask.zoneId !== task.zoneId) {
      zoneSwitchCount += 1;
    }
  });

  return {
    idleGapCount,
    idleMinutes,
    sameStationHandoffCount,
    sameZoneHandoffCount,
    zoneSwitchCount,
  };
}

export function auditOperatorAllocation({
  availableOperatorIds,
  budgetedAllocationPercent = 100,
  demandQuantity,
  issues,
  operatorCapacityMinutes,
  tasks,
}: {
  availableOperatorIds: string[];
  budgetedAllocationPercent?: number;
  demandQuantity: number;
  issues: OperatorAllocationIssue[];
  operatorCapacityMinutes: number;
  tasks: Task[];
}): OperatorAllocationAudit {
  const eligibleTasks = getAllocatableOperatorTasks(tasks);
  const assignedTasks = eligibleTasks.filter((task) => getTaskOperatorIds(task, availableOperatorIds).length > 0);
  const unassignedTaskCount = eligibleTasks.length - assignedTasks.length;
  const summaryTasks = tasks.filter((task) => isSummaryTask(task, tasks));
  const summaryTaskAssignmentCount = summaryTasks.filter((task) => getStoredTaskOperatorIds(task).length > 0).length;
  const budgetedMinutes = operatorCapacityMinutes * Math.max(budgetedAllocationPercent, 0) / 100;
  const blockerCount = issues.filter((issue) => issueSeverity(issue) === "blocker").length;
  const warningCount = issues.filter((issue) => issueSeverity(issue) === "warning").length;
  const operatorAudits = availableOperatorIds.map((operatorId) => {
    const operatorTasks = assignedTasks
      .filter((task) => getTaskOperatorIds(task, availableOperatorIds).includes(operatorId))
      .sort(compareTasksBySchedule);
    const assignedMinutes = getOperatorAssignedPeriodMinutes(
      operatorId,
      eligibleTasks,
      availableOperatorIds,
      demandQuantity,
    );
    const continuity = getOperatorIdleAndContinuity(operatorId, operatorTasks, availableOperatorIds);

    return {
      operatorId,
      assignedTaskCount: operatorTasks.length,
      assignedMinutes,
      utilizationPercent: operatorCapacityMinutes > 0 ? (assignedMinutes / operatorCapacityMinutes) * 100 : 0,
      budgetVarianceMinutes: budgetedMinutes > 0 ? assignedMinutes - budgetedMinutes : 0,
      idleGapCount: continuity.idleGapCount,
      idleMinutes: continuity.idleMinutes,
      sameZoneHandoffCount: continuity.sameZoneHandoffCount,
      sameStationHandoffCount: continuity.sameStationHandoffCount,
      zoneSwitchCount: continuity.zoneSwitchCount,
      assignedTaskLabels: operatorTasks.map((task) => `${task.wbs} ${task.name}`),
    };
  });
  const assignedMinuteValues = operatorAudits.map((operator) => operator.assignedMinutes);
  const loadSpreadMinutes = assignedMinuteValues.length
    ? Math.max(...assignedMinuteValues) - Math.min(...assignedMinuteValues)
    : 0;

  return {
    eligibleTaskCount: eligibleTasks.length,
    assignedTaskCount: assignedTasks.length,
    unassignedTaskCount,
    assignmentCoveragePercent: eligibleTasks.length > 0 ? (assignedTasks.length / eligibleTasks.length) * 100 : 0,
    summaryTaskCount: summaryTasks.length,
    summaryTaskAssignmentCount,
    peakManpower: calculatePeakManpower(tasks),
    blockerCount,
    warningCount,
    scheduleConflictCount: issues.filter((issue) => issue.kind === "schedule_conflict").length,
    physicalCapacityOverageCount: issues.filter((issue) => issue.kind === "capacity_overage").length,
    budgetOverageCount: issues.filter((issue) => issue.kind === "budget_overage").length,
    taktOverageCount: issues.filter((issue) => issue.kind === "takt_overage").length,
    loadSpreadMinutes,
    loadSpreadPercent: operatorCapacityMinutes > 0 ? (loadSpreadMinutes / operatorCapacityMinutes) * 100 : 0,
    operators: operatorAudits,
    strategyNotes: [
      "Smart allocation clears prior operator selections before assigning.",
      "Summary rows are excluded so zone headcount is driven by real task assignments.",
      "Operator overlap and physical capacity are hard constraints.",
      "Takt and budget allocation are review warnings so the plan remains visible.",
      "Candidate scoring prefers budget fit, balanced utilization, lower idle gap, and light same-zone continuity.",
    ],
  };
}

export function buildSmartOperatorAssignments({
  availableOperatorIds,
  budgetedAllocationPercent = 100,
  defaultOperatorsPerTask = 1,
  demandQuantity,
  operatorCapacityMinutes,
  preserveExisting = false,
  taktMinutes,
  tasks,
}: {
  availableOperatorIds: string[];
  budgetedAllocationPercent?: number;
  defaultOperatorsPerTask?: number;
  demandQuantity: number;
  operatorCapacityMinutes: number;
  preserveExisting?: boolean;
  taktMinutes: number;
  tasks: Task[];
}) {
  const allocatableTasks = getAllocatableOperatorTasks(tasks);
  const allocatableTaskIds = new Set(allocatableTasks.map((task) => task.id));

  if (availableOperatorIds.length === 0) {
    const nextTasks = tasks.map((task) => ({
      ...task,
      ...getTaskOperatorPatch(task, [], []),
    }));
    const changedTaskIds = tasks
      .filter((task) => getStoredTaskOperatorIds(task).length > 0 || task.plannedOperators !== 0)
      .map((task) => task.id);
    const issues: OperatorAllocationIssue[] = allocatableTasks
      .map((task) => ({
        kind: "unassigned_task",
        severity: "blocker",
        reason: "no_operators",
        taskId: task.id,
        message: `${task.wbs} ${task.name} could not be assigned because no budgeted operators are available.`,
      }));

    const audit = auditOperatorAllocation({
      availableOperatorIds,
      budgetedAllocationPercent,
      demandQuantity,
      issues,
      operatorCapacityMinutes,
      tasks: nextTasks,
    });

    return {
      tasks: nextTasks,
      changedTaskIds,
      issues,
      audit,
    };
  }

  const assignmentsByTaskId = new Map<string, string[]>();

  tasks.forEach((task) => {
    const existingOperatorIds = preserveExisting && allocatableTaskIds.has(task.id)
      ? getTaskOperatorIds(task, availableOperatorIds)
      : [];
    assignmentsByTaskId.set(task.id, existingOperatorIds);
  });

  function currentTasks() {
    return tasks.map((task) => ({
      ...task,
      customFields: {
        ...task.customFields,
        operatorIds: assignmentsByTaskId.get(task.id) ?? [],
      },
      plannedOperators: assignmentsByTaskId.get(task.id)?.length ?? 0,
    }));
  }

  function getScheduleConflict(operatorId: string, task: Task) {
    return currentTasks().find(
      (candidate) =>
        candidate.id !== task.id &&
        getTaskOperatorIds(candidate, availableOperatorIds).includes(operatorId) &&
        taskWindowsOverlap(task, candidate),
    );
  }

  function assignedMinutes(operatorId: string, excludedTaskId?: string) {
    return getOperatorAssignedPeriodMinutes(
      operatorId,
      currentTasks(),
      availableOperatorIds,
      demandQuantity,
      excludedTaskId,
    );
  }

  const budgetedMinutes = operatorCapacityMinutes * Math.max(budgetedAllocationPercent, 0) / 100;
  const orderedTasks = [...allocatableTasks].sort(compareTasksBySmartPriority(tasks, taktMinutes));
  const allocationIssues: OperatorAllocationIssue[] = [];

  orderedTasks.forEach((task) => {
    const existingOperatorIds = assignmentsByTaskId.get(task.id) ?? [];
    if (preserveExisting && existingOperatorIds.length > 0) {
      return;
    }

    const targetCount = Math.min(Math.max(Math.round(defaultOperatorsPerTask), 0), availableOperatorIds.length);
    const nextOperatorIds: string[] = [];
    const taskPeriodMinutes = Math.max(task.plannedDurationMinutes, 0) * Math.max(demandQuantity, 0);

    for (let slot = 0; slot < targetCount; slot += 1) {
      const diagnostics = availableOperatorIds
        .filter((operatorId) => !nextOperatorIds.includes(operatorId))
        .map((operatorId) => {
          const conflict = getScheduleConflict(operatorId, task);
          const currentMinutes = assignedMinutes(operatorId, task.id);
          const nextMinutes = currentMinutes + taskPeriodMinutes;
          const scheduleContext = getOperatorScheduleContext(
            operatorId,
            task,
            currentTasks(),
            availableOperatorIds,
          );
          const overBudgetMinutes = budgetedMinutes > 0 ? Math.max(nextMinutes - budgetedMinutes, 0) : 0;
          const budgetDenominator = Math.max(budgetedMinutes, 1);
          const capacityDenominator = Math.max(operatorCapacityMinutes, 1);
          const budgetTargetDistance = budgetedMinutes > 0 ? Math.abs(budgetedMinutes - nextMinutes) / budgetDenominator : 0;
          const physicalLoad = operatorCapacityMinutes > 0 ? nextMinutes / capacityDenominator : nextMinutes;
          const currentLoad = operatorCapacityMinutes > 0 ? currentMinutes / capacityDenominator : currentMinutes;
          const continuityBonus =
            scheduleContext.sameZoneContinuity ? 110 : scheduleContext.sameStationContinuity ? 45 : 0;
          const score =
            (overBudgetMinutes / budgetDenominator) * 12_000 +
            budgetTargetDistance * 90 +
            physicalLoad * 420 +
            currentLoad * 420 +
            scheduleContext.closestIdleGapMinutes * 0.18 -
            continuityBonus;

          return {
            conflict,
            operatorId,
            currentMinutes,
            nextMinutes,
            score,
            withinBudget: budgetedMinutes <= 0 || nextMinutes <= budgetedMinutes,
            withinCapacity: taskPeriodMinutes === 0 || (operatorCapacityMinutes > 0 && nextMinutes <= operatorCapacityMinutes),
          };
        });
      const candidates = diagnostics
        .filter((candidate) => !candidate.conflict)
        .filter((candidate) => candidate.withinCapacity)
        .sort((a, b) => {
          if (a.withinBudget !== b.withinBudget) {
            return a.withinBudget ? -1 : 1;
          }

          if (a.score !== b.score) {
            return a.score - b.score;
          }

          if (a.nextMinutes !== b.nextMinutes) {
            return a.nextMinutes - b.nextMinutes;
          }

          return a.operatorId.localeCompare(b.operatorId);
        });

      const selected = candidates[0];
      if (!selected) {
        allocationIssues.push(buildUnassignedTaskIssue({
          availableOperatorIds,
          demandQuantity,
          diagnostics,
          operatorCapacityMinutes,
          task,
        }));
        break;
      }

      nextOperatorIds.push(selected.operatorId);
    }

    if (nextOperatorIds.length > 0) {
      assignmentsByTaskId.set(task.id, nextOperatorIds);
    }
  });

  const nextTasks = tasks.map((task) => {
    const nextOperatorIds = assignmentsByTaskId.get(task.id) ?? [];
    const patch = getTaskOperatorPatch(task, nextOperatorIds, availableOperatorIds);
    return {
      ...task,
      ...patch,
    };
  });
  const finalChangedTaskIds = nextTasks
    .filter((task) => {
      const originalTask = tasks.find((candidate) => candidate.id === task.id);
      return originalTask
        ? !sameOperatorIds(getStoredTaskOperatorIds(originalTask), getStoredTaskOperatorIds(task)) ||
            originalTask.plannedOperators !== task.plannedOperators
        : true;
    })
    .map((task) => task.id);

  const issues = dedupeOperatorAllocationIssues([
    ...allocationIssues,
    ...validateOperatorAllocations({
      availableOperatorIds,
      budgetedAllocationPercent,
      demandQuantity,
      operatorCapacityMinutes,
      taktMinutes,
      tasks: nextTasks,
    }),
  ]);
  const audit = auditOperatorAllocation({
    availableOperatorIds,
    budgetedAllocationPercent,
    demandQuantity,
    issues,
    operatorCapacityMinutes,
    tasks: nextTasks,
  });

  return {
    tasks: nextTasks,
    changedTaskIds: finalChangedTaskIds,
    issues,
    audit,
  };
}

export interface OperatorIdleStat {
  operatorId: string;
  /** Sum of assigned task durations for one unit's flow (work content). */
  busyMinutes: number;
  /** Time the operator is on the clock but not working while the line runs (makespan - busy). */
  idleMinutes: number;
  utilizationPercent: number;
  assignedTaskCount: number;
}

export interface OperatorIdleAnalysis {
  /** Operators carrying at least one task, busiest first. */
  operators: OperatorIdleStat[];
  /** Line lead time: earliest start to latest finish across allocatable work. */
  makespanMinutes: number;
  operatorsUsed: number;
  totalWorkMinutes: number;
  totalIdleMinutes: number;
  /** Σ work ÷ (operators × makespan) — the line-balancing efficiency. */
  efficiencyPercent: number;
  /** 100 − efficiency: idle as a share of available operator time. */
  balanceDelayPercent: number;
}

/**
 * Labor idle / utilization analysis over a scheduled task set, modeled on one unit's flow:
 * the line runs for the makespan, each used operator is on the clock that whole time, so their
 * idle (waiting) time = makespan − the work they actually do. Aggregated, that is the classic
 * line-balancing efficiency and balance delay. Tasks running in parallel within an operator are
 * not expected (one operator per task in v1); a task with multiple operators counts its duration
 * toward each assigned operator's busy time.
 */
export function computeOperatorIdleAnalysis(tasks: Task[], availableOperatorIds: string[]): OperatorIdleAnalysis {
  const allocatable = getAllocatableOperatorTasks(tasks);

  let minStartMs = Number.POSITIVE_INFINITY;
  let maxFinishMs = Number.NEGATIVE_INFINITY;
  for (const task of allocatable) {
    const window = getTaskWindowMs(task);
    if (!window) {
      continue;
    }
    minStartMs = Math.min(minStartMs, window.startMs);
    maxFinishMs = Math.max(maxFinishMs, window.finishMs);
  }
  const makespanMinutes = Number.isFinite(minStartMs) && Number.isFinite(maxFinishMs)
    ? Math.max(0, (maxFinishMs - minStartMs) / 60_000)
    : 0;

  const busyByOperator = new Map<string, { busyMinutes: number; assignedTaskCount: number }>();
  for (const task of allocatable) {
    const duration = Math.max(task.plannedDurationMinutes, 0);
    for (const operatorId of getTaskOperatorIds(task, availableOperatorIds)) {
      const current = busyByOperator.get(operatorId) ?? { busyMinutes: 0, assignedTaskCount: 0 };
      current.busyMinutes += duration;
      current.assignedTaskCount += 1;
      busyByOperator.set(operatorId, current);
    }
  }

  const operators: OperatorIdleStat[] = [...busyByOperator.entries()]
    .map(([operatorId, value]) => ({
      operatorId,
      busyMinutes: value.busyMinutes,
      idleMinutes: Math.max(0, makespanMinutes - value.busyMinutes),
      utilizationPercent: makespanMinutes > 0 ? (value.busyMinutes / makespanMinutes) * 100 : 0,
      assignedTaskCount: value.assignedTaskCount,
    }))
    .sort((left, right) => right.busyMinutes - left.busyMinutes || left.operatorId.localeCompare(right.operatorId));

  const operatorsUsed = operators.length;
  const totalWorkMinutes = operators.reduce((total, operator) => total + operator.busyMinutes, 0);
  const availableMinutes = operatorsUsed * makespanMinutes;
  const totalIdleMinutes = Math.max(0, availableMinutes - totalWorkMinutes);
  const efficiencyPercent = availableMinutes > 0 ? (totalWorkMinutes / availableMinutes) * 100 : 0;

  return {
    operators,
    makespanMinutes,
    operatorsUsed,
    totalWorkMinutes,
    totalIdleMinutes,
    efficiencyPercent,
    balanceDelayPercent: availableMinutes > 0 ? 100 - efficiencyPercent : 0,
  };
}

export function buildOperatorAssignmentsFromIePlan({
  assignments,
  availableOperatorIds,
  budgetedAllocationPercent = 100,
  demandQuantity,
  operatorCapacityMinutes,
  strategyNotes = [],
  taktMinutes,
  tasks,
}: {
  assignments: IeSmartAllocationAssignment[];
  availableOperatorIds: string[];
  budgetedAllocationPercent?: number;
  demandQuantity: number;
  operatorCapacityMinutes: number;
  strategyNotes?: string[];
  taktMinutes: number;
  tasks: Task[];
}) {
  const allocatableTasks = getAllocatableOperatorTasks(tasks);
  const allocatableTaskIds = new Set(allocatableTasks.map((task) => task.id));
  const availableSet = new Set(availableOperatorIds);
  const assignmentsByTaskId = new Map<string, string[]>();

  assignments.forEach((assignment) => {
    if (!allocatableTaskIds.has(assignment.taskId)) {
      return;
    }

    assignmentsByTaskId.set(
      assignment.taskId,
      [...new Set(assignment.operatorIds)].filter((operatorId) => availableSet.has(operatorId)),
    );
  });

  const nextTasks = tasks.map((task) => {
    const nextOperatorIds = allocatableTaskIds.has(task.id) ? assignmentsByTaskId.get(task.id) ?? [] : [];
    const patch = getTaskOperatorPatch(task, nextOperatorIds, availableOperatorIds);
    return {
      ...task,
      ...patch,
    };
  });
  const unassignedIssues = getAllocatableOperatorTasks(nextTasks)
    .filter((task) => getTaskOperatorIds(task, availableOperatorIds).length === 0)
    .map((task) =>
      buildUnassignedTaskIssue({
        availableOperatorIds,
        demandQuantity,
        diagnostics: getOperatorAssignmentDiagnostics({
          availableOperatorIds,
          demandQuantity,
          operatorCapacityMinutes,
          task,
          tasks: nextTasks,
        }),
        operatorCapacityMinutes,
        task,
      }),
    );
  const issues = dedupeOperatorAllocationIssues([
    ...unassignedIssues,
    ...validateOperatorAllocations({
      availableOperatorIds,
      budgetedAllocationPercent,
      demandQuantity,
      operatorCapacityMinutes,
      taktMinutes,
      tasks: nextTasks,
    }),
  ]);
  const baseAudit = auditOperatorAllocation({
    availableOperatorIds,
    budgetedAllocationPercent,
    demandQuantity,
    issues,
    operatorCapacityMinutes,
    tasks: nextTasks,
  });
  const audit = {
    ...baseAudit,
    strategyNotes: strategyNotes.length
      ? [
          "Smart allocation used the IE agent to assign operators from the current Gantt constraints.",
          ...strategyNotes,
          "Deterministic validation checked overlap, physical capacity, takt warnings, and summary-row assignments after the agent response.",
        ]
      : baseAudit.strategyNotes,
  };
  const changedTaskIds = nextTasks
    .filter((task) => {
      const originalTask = tasks.find((candidate) => candidate.id === task.id);
      return originalTask
        ? !sameOperatorIds(getStoredTaskOperatorIds(originalTask), getStoredTaskOperatorIds(task)) ||
            originalTask.plannedOperators !== task.plannedOperators
        : true;
    })
    .map((task) => task.id);

  return {
    tasks: nextTasks,
    changedTaskIds,
    issues,
    audit,
  };
}
