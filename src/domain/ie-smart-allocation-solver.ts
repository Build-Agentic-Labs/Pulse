/**
 * Deterministic smart-allocation solver + LLM-plan validation, extracted from
 * app/api/smart-allocation/route.ts (refactor plan, Stage 6) so ~560 lines of
 * pure scheduling logic live in the domain layer where they can be tested.
 * Behavior-preserving move: bodies are verbatim.
 */

import { formatMinutes, getTimelineBounds, round } from "./calculations";
import type {
  IeSmartAllocationAssignment,
  IeSmartAllocationOperatorSchedule,
  IeSmartAllocationPlan,
  IeSmartAllocationRequest,
  IeSmartAllocationReviewItem,
} from "./ie-smart-allocation";
import { buildOperatorAssignmentsFromIePlan, buildSmartOperatorAssignments } from "./operator-allocation";
import { getTaskOperatorIds } from "./operator-assignments";
import type { Task } from "./types";
export function finiteNumber(value: unknown) {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}


export function normalizePlan(value: unknown, availableOperatorIds: string[], taskIds: Set<string>): IeSmartAllocationPlan {
  const raw = value && typeof value === "object" ? (value as Record<string, unknown>) : {};
  const availableSet = new Set(availableOperatorIds);
  const assignments: IeSmartAllocationAssignment[] = Array.isArray(raw.assignments)
    ? raw.assignments
        .map((item) => (item && typeof item === "object" ? (item as Record<string, unknown>) : undefined))
        .filter((item): item is Record<string, unknown> => Boolean(item))
        .filter((item) => typeof item.taskId === "string" && taskIds.has(item.taskId))
        .map((item) => ({
          taskId: String(item.taskId),
          operatorIds: Array.isArray(item.operatorIds)
            ? [...new Set(item.operatorIds.filter((operatorId): operatorId is string => typeof operatorId === "string"))]
                .filter((operatorId) => availableSet.has(operatorId))
            : [],
          rationale: typeof item.rationale === "string" ? item.rationale : "",
        }))
    : [];
  const reviewItems: IeSmartAllocationReviewItem[] = Array.isArray(raw.reviewItems)
    ? raw.reviewItems
        .map((item) => (item && typeof item === "object" ? (item as Record<string, unknown>) : undefined))
        .filter((item): item is Record<string, unknown> => Boolean(item))
        .map((item) => {
          const severity: IeSmartAllocationReviewItem["severity"] =
            item.severity === "blocker" || item.severity === "warning" || item.severity === "info"
              ? item.severity
              : "info";

          return {
            severity,
            taskId: typeof item.taskId === "string" ? item.taskId : undefined,
            message: typeof item.message === "string" ? item.message : "",
            recommendation: typeof item.recommendation === "string" ? item.recommendation : "",
          };
        })
        .filter((item) => item.message || item.recommendation)
    : [];
  const operatorSchedules: IeSmartAllocationOperatorSchedule[] = Array.isArray(raw.operatorSchedules)
    ? raw.operatorSchedules
        .map((item) => (item && typeof item === "object" ? (item as Record<string, unknown>) : undefined))
        .filter((item): item is Record<string, unknown> => Boolean(item))
        .filter((item) => typeof item.operatorId === "string" && availableSet.has(item.operatorId))
        .map((item) => ({
          operatorId: String(item.operatorId),
          sequence: Array.isArray(item.sequence)
            ? item.sequence
                .map((sequenceItem) => (sequenceItem && typeof sequenceItem === "object" ? (sequenceItem as Record<string, unknown>) : undefined))
                .filter((sequenceItem): sequenceItem is Record<string, unknown> => Boolean(sequenceItem))
                .filter((sequenceItem) => typeof sequenceItem.taskId === "string" && taskIds.has(sequenceItem.taskId))
                .map((sequenceItem) => ({
                  taskId: String(sequenceItem.taskId),
                  startMinute: finiteNumber(sequenceItem.startMinute),
                  finishMinute: finiteNumber(sequenceItem.finishMinute),
                }))
            : [],
        }))
    : [];

  return {
    summary: typeof raw.summary === "string" ? raw.summary : "IE smart allocation completed.",
    assignments,
    operatorSchedules,
    reviewItems,
    strategyNotes: Array.isArray(raw.strategyNotes)
      ? raw.strategyNotes.filter((item): item is string => typeof item === "string")
      : [],
  };
}


export function validationMessages(plan: IeSmartAllocationPlan, request: IeSmartAllocationRequest) {
  const allocation = buildOperatorAssignmentsFromIePlan({
    assignments: plan.assignments,
    availableOperatorIds: request.availableOperatorIds,
    budgetedAllocationPercent: request.constraints.requiredAverageAllocationPercent,
    demandQuantity: request.constraints.demandQuantity,
    operatorCapacityMinutes: request.constraints.operatorCapacityMinutes,
    strategyNotes: plan.strategyNotes,
    taktMinutes: request.constraints.taktMinutes,
    tasks: request.plannerState.tasks,
  });
  const taskById = new Map(allocation.tasks.map((task) => [task.id, task]));
  const hardMessages = allocation.issues
    .filter((issue) => issue.kind === "schedule_conflict" || issue.kind === "capacity_overage")
    .map((issue) => {
      const task = issue.taskId ? taskById.get(issue.taskId) : undefined;
      const conflict = issue.conflictingTaskId ? taskById.get(issue.conflictingTaskId) : undefined;
      return [
        issue.kind,
        issue.operatorId ? `operator ${issue.operatorId}` : "",
        task ? `task ${task.wbs} ${task.name}` : "",
        conflict ? `conflicts with ${conflict.wbs} ${conflict.name}` : "",
        issue.message,
      ].filter(Boolean).join(" | ");
    });

  if (allocation.audit.summaryTaskAssignmentCount > 0) {
    hardMessages.push(`${allocation.audit.summaryTaskAssignmentCount} summary row assignment(s) were present.`);
  }

  return {
    allocation,
    hardMessages,
  };
}

export function auditedSummary(audit: ReturnType<typeof validationMessages>["allocation"]["audit"]) {
  const hardFailureCount =
    audit.scheduleConflictCount + audit.physicalCapacityOverageCount + audit.summaryTaskAssignmentCount;
  const hardStatus = hardFailureCount === 0
    ? "no schedule, capacity, or summary-row conflicts"
    : `${hardFailureCount} hard validation issue(s)`;

  return `Smart allocation validated: ${audit.assignedTaskCount}/${audit.eligibleTaskCount} task rows assigned, ${audit.unassignedTaskCount} unassigned for review, ${formatMinutes(audit.loadSpreadMinutes)} operator load spread, ${hardStatus}.`;
}

export function unassignedPriorityScore(validation: ReturnType<typeof validationMessages>, availableOperatorIds: string[]) {
  return validation.allocation.tasks
    .filter((task) => isAllocatableAgentTask(task, validation.allocation.tasks))
    .filter((task) => getTaskOperatorIds(task, availableOperatorIds).length === 0)
    .reduce((score, task) => score + taskKeepScore(task, validation.allocation.tasks), 0);
}

export function coverageGuardBeatsCurrent({
  coverageValidation,
  currentValidation,
  request,
}: {
  coverageValidation: ReturnType<typeof validationMessages>;
  currentValidation: ReturnType<typeof validationMessages>;
  request: IeSmartAllocationRequest;
}) {
  if (coverageValidation.hardMessages.length > 0) {
    return false;
  }

  const coverageAudit = coverageValidation.allocation.audit;
  const currentAudit = currentValidation.allocation.audit;
  if (coverageAudit.assignedTaskCount !== currentAudit.assignedTaskCount) {
    return coverageAudit.assignedTaskCount > currentAudit.assignedTaskCount;
  }

  const coverageUnassignedScore = unassignedPriorityScore(coverageValidation, request.availableOperatorIds);
  const currentUnassignedScore = unassignedPriorityScore(currentValidation, request.availableOperatorIds);
  if (coverageUnassignedScore !== currentUnassignedScore) {
    return coverageUnassignedScore < currentUnassignedScore;
  }

  return coverageAudit.loadSpreadMinutes < currentAudit.loadSpreadMinutes;
}

export function isAllocatableAgentTask(task: Task, tasks: Task[]) {
  const childPrefix = `${task.wbs}.`;
  return task.plannedDurationMinutes > 0 && !tasks.some((candidate) => candidate.id !== task.id && candidate.wbs.startsWith(childPrefix));
}

export function taskWindowsOverlap(task: Task, candidate: Task) {
  const startMs = Date.parse(task.plannedStart);
  const finishMs = Date.parse(task.plannedFinish);
  const candidateStartMs = Date.parse(candidate.plannedStart);
  const candidateFinishMs = Date.parse(candidate.plannedFinish);

  if (![startMs, finishMs, candidateStartMs, candidateFinishMs].every(Number.isFinite)) {
    return false;
  }

  return startMs < candidateFinishMs && finishMs > candidateStartMs;
}

export function countSuccessors(task: Task, tasks: Task[]) {
  return tasks.reduce((count, candidate) => count + (candidate.dependencyIds.includes(task.id) ? 1 : 0), 0);
}

export function taskKeepScore(task: Task, tasks: Task[]) {
  return (
    task.plannedDurationMinutes +
    task.dependencyIds.length * 60 +
    countSuccessors(task, tasks) * 240 +
    (task.criticalPath ? 120 : 0) +
    (task.bottleneckFlag ? 180 : 0)
  );
}

export function operatorAssignedPeriodMinutes(
  operatorId: string,
  assignmentsByTaskId: Map<string, string[]>,
  tasks: Task[],
  demandQuantity: number,
  excludedTaskId?: string,
) {
  return tasks.reduce((total, task) => {
    if (task.id === excludedTaskId || !assignmentsByTaskId.get(task.id)?.includes(operatorId)) {
      return total;
    }

    return total + task.plannedDurationMinutes * Math.max(demandQuantity, 0);
  }, 0);
}

export function findFeasibleOperator({
  assignmentsByTaskId,
  availableOperatorIds,
  demandQuantity,
  excludedTaskId,
  operatorCapacityMinutes,
  task,
  tasks,
}: {
  assignmentsByTaskId: Map<string, string[]>;
  availableOperatorIds: string[];
  demandQuantity: number;
  excludedTaskId?: string;
  operatorCapacityMinutes: number;
  task: Task;
  tasks: Task[];
}) {
  const taskPeriodMinutes = task.plannedDurationMinutes * Math.max(demandQuantity, 0);
  const candidates = availableOperatorIds
    .map((operatorId) => {
      const overlappingTask = tasks.find(
        (candidate) =>
          candidate.id !== task.id &&
          candidate.id !== excludedTaskId &&
          assignmentsByTaskId.get(candidate.id)?.includes(operatorId) &&
          taskWindowsOverlap(task, candidate),
      );
      const currentMinutes = operatorAssignedPeriodMinutes(
        operatorId,
        assignmentsByTaskId,
        tasks,
        demandQuantity,
        task.id,
      );
      const nextMinutes = currentMinutes + taskPeriodMinutes;

      return {
        currentMinutes,
        nextMinutes,
        operatorId,
        overlappingTask,
      };
    })
    .filter((candidate) => !candidate.overlappingTask)
    .filter((candidate) => operatorCapacityMinutes > 0 && candidate.nextMinutes <= operatorCapacityMinutes)
    .sort((left, right) => {
      if (left.nextMinutes !== right.nextMinutes) {
        return left.nextMinutes - right.nextMinutes;
      }

      return left.operatorId.localeCompare(right.operatorId);
    });

  return candidates[0]?.operatorId;
}

export function operatorLoadMap(
  operatorIds: string[],
  assignmentsByTaskId: Map<string, string[]>,
  tasks: Task[],
  demandQuantity: number,
) {
  return new Map(
    operatorIds.map((operatorId) => [
      operatorId,
      operatorAssignedPeriodMinutes(operatorId, assignmentsByTaskId, tasks, demandQuantity),
    ]),
  );
}

export function loadSpread(loads: Map<string, number>) {
  const values = [...loads.values()];
  return values.length ? Math.max(...values) - Math.min(...values) : 0;
}

export function bestRebalanceOperator({
  assignmentsByTaskId,
  availableOperatorIds,
  demandQuantity,
  operatorCapacityMinutes,
  previousSpread,
  sourceOperatorId,
  task,
  tasks,
}: {
  assignmentsByTaskId: Map<string, string[]>;
  availableOperatorIds: string[];
  demandQuantity: number;
  operatorCapacityMinutes: number;
  previousSpread: number;
  sourceOperatorId: string;
  task: Task;
  tasks: Task[];
}) {
  const taskPeriodMinutes = task.plannedDurationMinutes * Math.max(demandQuantity, 0);

  return availableOperatorIds
    .filter((operatorId) => operatorId !== sourceOperatorId)
    .map((operatorId) => {
      const overlappingTask = tasks.find(
        (candidate) =>
          candidate.id !== task.id &&
          assignmentsByTaskId.get(candidate.id)?.includes(operatorId) &&
          taskWindowsOverlap(task, candidate),
      );
      if (overlappingTask) {
        return undefined;
      }

      const nextMinutes = operatorAssignedPeriodMinutes(
        operatorId,
        assignmentsByTaskId,
        tasks,
        demandQuantity,
        task.id,
      ) + taskPeriodMinutes;
      if (operatorCapacityMinutes <= 0 || nextMinutes > operatorCapacityMinutes) {
        return undefined;
      }

      assignmentsByTaskId.set(task.id, [operatorId]);
      const nextSpread = loadSpread(operatorLoadMap(availableOperatorIds, assignmentsByTaskId, tasks, demandQuantity));
      assignmentsByTaskId.set(task.id, []);

      if (nextSpread >= previousSpread) {
        return undefined;
      }

      return {
        nextSpread,
        operatorId,
      };
    })
    .filter((candidate): candidate is { nextSpread: number; operatorId: string } => Boolean(candidate))
    .sort((left, right) => {
      if (left.nextSpread !== right.nextSpread) {
        return left.nextSpread - right.nextSpread;
      }

      return left.operatorId.localeCompare(right.operatorId);
    })[0]?.operatorId;
}

export function buildOperatorSchedulesFromAssignments(
  assignments: IeSmartAllocationAssignment[],
  tasks: Task[],
  availableOperatorIds: string[],
) {
  const taskById = new Map(tasks.map((task) => [task.id, task]));
  const bounds = getTimelineBounds(tasks);

  return availableOperatorIds.map((operatorId) => ({
    operatorId,
    sequence: assignments
      .filter((assignment) => assignment.operatorIds.includes(operatorId))
      .map((assignment) => {
        const task = taskById.get(assignment.taskId);
        return {
          finishMinute: task ? round((Date.parse(task.plannedFinish) - bounds.startMs) / 60000, 2) : 0,
          startMinute: task ? round((Date.parse(task.plannedStart) - bounds.startMs) / 60000, 2) : 0,
          taskId: assignment.taskId,
        };
      })
      .sort((left, right) => left.startMinute - right.startMinute),
  }));
}

export function repairPlanDeterministically(plan: IeSmartAllocationPlan, request: IeSmartAllocationRequest) {
  const allocatableTasks = request.plannerState.tasks.filter((task) => isAllocatableAgentTask(task, request.plannerState.tasks));
  const taskById = new Map(allocatableTasks.map((task) => [task.id, task]));
  const assignmentsByTaskId = new Map<string, string[]>();
  const repairNotes: string[] = [];

  allocatableTasks.forEach((task) => assignmentsByTaskId.set(task.id, []));
  plan.assignments.forEach((assignment) => {
    if (!taskById.has(assignment.taskId)) {
      return;
    }

    assignmentsByTaskId.set(
      assignment.taskId,
      [...new Set(assignment.operatorIds)].filter((operatorId) => request.availableOperatorIds.includes(operatorId)),
    );
  });

  for (let pass = 0; pass < 40; pass += 1) {
    const candidatePlan: IeSmartAllocationPlan = {
      ...plan,
      assignments: allocatableTasks.map((task) => ({
        taskId: task.id,
        operatorIds: assignmentsByTaskId.get(task.id) ?? [],
        rationale: "Deterministic repair candidate.",
      })),
    };
    const validation = validationMessages(candidatePlan, request);
    const scheduleConflict = validation.allocation.issues.find((issue) => issue.kind === "schedule_conflict" && issue.taskId && issue.conflictingTaskId);
    const capacityOverage = validation.allocation.issues.find((issue) => issue.kind === "capacity_overage" && issue.operatorId);

    if (!scheduleConflict && !capacityOverage && validation.allocation.audit.summaryTaskAssignmentCount === 0) {
      break;
    }

    if (scheduleConflict?.taskId && scheduleConflict.conflictingTaskId) {
      const leftTask = taskById.get(scheduleConflict.taskId);
      const rightTask = taskById.get(scheduleConflict.conflictingTaskId);
      if (!leftTask || !rightTask) {
        break;
      }

      const orderedTasks = [leftTask, rightTask].sort((left, right) => taskKeepScore(left, allocatableTasks) - taskKeepScore(right, allocatableTasks));
      let repaired = false;

      for (const task of orderedTasks) {
        const previousOperators = assignmentsByTaskId.get(task.id) ?? [];
        assignmentsByTaskId.set(task.id, []);
        const operatorId = findFeasibleOperator({
          assignmentsByTaskId,
          availableOperatorIds: request.availableOperatorIds,
          demandQuantity: request.constraints.demandQuantity,
          operatorCapacityMinutes: request.constraints.operatorCapacityMinutes,
          task,
          tasks: allocatableTasks,
        });

        if (operatorId) {
          assignmentsByTaskId.set(task.id, [operatorId]);
          repairNotes.push(`Moved ${task.wbs} ${task.name} to operator ${operatorId} to remove a schedule conflict.`);
          repaired = true;
          break;
        }

        assignmentsByTaskId.set(task.id, previousOperators);
      }

      if (!repaired) {
        const droppedTask = orderedTasks[0];
        assignmentsByTaskId.set(droppedTask.id, []);
        repairNotes.push(`Unassigned ${droppedTask.wbs} ${droppedTask.name} because no non-overlapping operator was available.`);
      }

      continue;
    }

    if (capacityOverage?.operatorId) {
      const overloadedOperatorId = capacityOverage.operatorId;
      const assignedTasks = allocatableTasks
        .filter((task) => assignmentsByTaskId.get(task.id)?.includes(overloadedOperatorId))
        .sort((left, right) => taskKeepScore(left, allocatableTasks) - taskKeepScore(right, allocatableTasks));
      const task = assignedTasks[0];

      if (!task) {
        break;
      }

      assignmentsByTaskId.set(task.id, []);
      const operatorId = findFeasibleOperator({
        assignmentsByTaskId,
        availableOperatorIds: request.availableOperatorIds.filter((candidate) => candidate !== overloadedOperatorId),
        demandQuantity: request.constraints.demandQuantity,
        operatorCapacityMinutes: request.constraints.operatorCapacityMinutes,
        task,
        tasks: allocatableTasks,
      });

      if (operatorId) {
        assignmentsByTaskId.set(task.id, [operatorId]);
        repairNotes.push(`Moved ${task.wbs} ${task.name} to operator ${operatorId} to remove a capacity overage.`);
      } else {
        repairNotes.push(`Unassigned ${task.wbs} ${task.name} because no operator had remaining capacity.`);
      }
    }
  }

  allocatableTasks
    .filter((task) => (assignmentsByTaskId.get(task.id) ?? []).length === 0)
    .sort((left, right) => {
      const priorityDelta = taskKeepScore(right, allocatableTasks) - taskKeepScore(left, allocatableTasks);
      if (priorityDelta !== 0) {
        return priorityDelta;
      }

      return right.plannedDurationMinutes - left.plannedDurationMinutes;
    })
    .forEach((task) => {
      const taskPeriodMinutes = task.plannedDurationMinutes * Math.max(request.constraints.demandQuantity, 0);
      if (request.constraints.operatorCapacityMinutes > 0 && taskPeriodMinutes > request.constraints.operatorCapacityMinutes) {
        return;
      }

      const operatorId = findFeasibleOperator({
        assignmentsByTaskId,
        availableOperatorIds: request.availableOperatorIds,
        demandQuantity: request.constraints.demandQuantity,
        operatorCapacityMinutes: request.constraints.operatorCapacityMinutes,
        task,
        tasks: allocatableTasks,
      });

      if (!operatorId) {
        return;
      }

      assignmentsByTaskId.set(task.id, [operatorId]);
      repairNotes.push(`Assigned ${task.wbs} ${task.name} to operator ${operatorId} during the feasible-fill repair pass.`);
    });

  for (let pass = 0; pass < 60; pass += 1) {
    const loads = operatorLoadMap(
      request.availableOperatorIds,
      assignmentsByTaskId,
      allocatableTasks,
      request.constraints.demandQuantity,
    );
    const previousSpread = loadSpread(loads);
    const sourceOperatorId = [...loads.entries()].sort((left, right) => right[1] - left[1])[0]?.[0];

    if (!sourceOperatorId || previousSpread <= 0) {
      break;
    }

    const sourceTasks = allocatableTasks
      .filter((task) => assignmentsByTaskId.get(task.id)?.includes(sourceOperatorId))
      .sort((left, right) => {
        const durationDelta = right.plannedDurationMinutes - left.plannedDurationMinutes;
        if (durationDelta !== 0) {
          return durationDelta;
        }

        return taskKeepScore(left, allocatableTasks) - taskKeepScore(right, allocatableTasks);
      });
    let moved = false;

    for (const task of sourceTasks) {
      assignmentsByTaskId.set(task.id, []);
      const operatorId = bestRebalanceOperator({
        assignmentsByTaskId,
        availableOperatorIds: request.availableOperatorIds,
        demandQuantity: request.constraints.demandQuantity,
        operatorCapacityMinutes: request.constraints.operatorCapacityMinutes,
        previousSpread,
        sourceOperatorId,
        task,
        tasks: allocatableTasks,
      });

      if (operatorId) {
        assignmentsByTaskId.set(task.id, [operatorId]);
        repairNotes.push(`Moved ${task.wbs} ${task.name} from operator ${sourceOperatorId} to ${operatorId} to reduce load spread.`);
        moved = true;
        break;
      }

      assignmentsByTaskId.set(task.id, [sourceOperatorId]);
    }

    if (!moved) {
      break;
    }
  }

  const assignments = allocatableTasks.map((task) => ({
    taskId: task.id,
    operatorIds: assignmentsByTaskId.get(task.id) ?? [],
    rationale: repairNotes.some((note) => note.includes(`${task.wbs} ${task.name}`))
      ? "Adjusted by deterministic repair after IE validation."
      : plan.assignments.find((assignment) => assignment.taskId === task.id)?.rationale ?? "Preserved from IE agent plan.",
  }));

  return {
    ...plan,
    assignments,
    operatorSchedules: buildOperatorSchedulesFromAssignments(assignments, allocatableTasks, request.availableOperatorIds),
    reviewItems: [
      ...plan.reviewItems,
      ...repairNotes.map((note): IeSmartAllocationReviewItem => ({
        severity: note.startsWith("Unassigned") ? "blocker" : "info",
        taskId: "",
        message: note,
        recommendation: note.startsWith("Unassigned")
          ? "Review the task window or work design if this task must be covered."
          : "Validate the repaired assignment in the audit.",
      })),
    ],
    strategyNotes: [
      ...plan.strategyNotes,
      "Deterministic repair pass adjusted the IE proposal after retry validation.",
      ...repairNotes,
    ],
  };
}

export function buildDeterministicCoveragePlan(plan: IeSmartAllocationPlan, request: IeSmartAllocationRequest) {
  const allocation = buildSmartOperatorAssignments({
    availableOperatorIds: request.availableOperatorIds,
    budgetedAllocationPercent: request.constraints.requiredAverageAllocationPercent,
    demandQuantity: request.constraints.demandQuantity,
    operatorCapacityMinutes: request.constraints.operatorCapacityMinutes,
    preserveExisting: false,
    taktMinutes: request.constraints.taktMinutes,
    tasks: request.plannerState.tasks,
  });
  const allocationTaskById = new Map(allocation.tasks.map((task) => [task.id, task]));
  const allocatableTasks = request.plannerState.tasks.filter((task) => isAllocatableAgentTask(task, request.plannerState.tasks));
  const assignments = allocatableTasks.map((task) => {
    const allocationTask = allocationTaskById.get(task.id);
    return {
      taskId: task.id,
      operatorIds: allocationTask ? getTaskOperatorIds(allocationTask, request.availableOperatorIds) : [],
      rationale: "Deterministic coverage guard selected this assignment after IE validation.",
    };
  });

  return repairPlanDeterministically({
    ...plan,
    assignments,
    operatorSchedules: buildOperatorSchedulesFromAssignments(assignments, allocatableTasks, request.availableOperatorIds),
    reviewItems: [
      ...plan.reviewItems,
      {
        severity: "info",
        taskId: "",
        message: "The deterministic coverage guard produced a higher-coverage valid plan than the raw IE repair.",
        recommendation: "Use this as the applied headcount plan, then review remaining unassigned blockers.",
      },
    ],
    strategyNotes: [
      ...plan.strategyNotes,
      "Deterministic coverage guard compared the repaired IE plan against the local feasibility allocator.",
    ],
  }, request);
}

