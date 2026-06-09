import type { Dependency, Task } from "./types";

/**
 * Pure task dependency + scheduling helpers.
 *
 * Extracted from line-workspace.tsx so the logic can be shared (gantt-timeline
 * and mobile-photo-portal carry their own copies) and unit-tested in isolation.
 * Every function here is pure: it derives new values from its inputs and never
 * mutates the tasks/dependencies passed in.
 */

export function addMinutes(iso: string, minutes: number) {
  return new Date(Date.parse(iso) + minutes * 60_000).toISOString();
}

export function taskDependencyRefBelongsTo(ref: string, taskIds: Set<string>) {
  if (taskIds.has(ref)) {
    return true;
  }

  if (!ref.startsWith("step:")) {
    return false;
  }

  const [, taskId] = ref.split(":");
  return taskId ? taskIds.has(taskId) : false;
}

export function taskDependsOn(
  taskMap: Map<string, Task>,
  taskId: string,
  dependencyId: string,
  visited = new Set<string>(),
): boolean {
  if (taskId === dependencyId) {
    return true;
  }

  if (visited.has(taskId)) {
    return false;
  }

  visited.add(taskId);
  const task = taskMap.get(taskId);

  if (!task) {
    return false;
  }

  return task.dependencyIds.some((nextDependencyId) =>
    taskDependsOn(taskMap, nextDependencyId, dependencyId, visited),
  );
}

export function wouldCreateDependencyCycle(tasks: Task[], targetTaskId: string, predecessorTaskId: string): boolean {
  if (targetTaskId === predecessorTaskId) {
    return true;
  }

  const taskMap = new Map(tasks.map((task) => [task.id, task]));
  return taskDependsOn(taskMap, predecessorTaskId, targetTaskId);
}

export function sanitizeDependencyIds(tasks: Task[], taskId: string, dependencyIds: string[]) {
  const validTaskIds = new Set(tasks.map((task) => task.id));

  return [...new Set(dependencyIds)].filter(
    (dependencyId) =>
      dependencyId !== taskId &&
      validTaskIds.has(dependencyId) &&
      !wouldCreateDependencyCycle(tasks, taskId, dependencyId),
  );
}

export function relinkTasksForDependency(tasks: Task[], targetTaskId: string, predecessorTaskId: string) {
  if (targetTaskId === predecessorTaskId) {
    return tasks;
  }

  const taskMap = new Map(tasks.map((task) => [task.id, task]));
  const targetTask = taskMap.get(targetTaskId);
  const predecessorTask = taskMap.get(predecessorTaskId);

  if (!targetTask || !predecessorTask || targetTask.dependencyIds.includes(predecessorTaskId)) {
    return tasks;
  }

  let nextTasks = tasks;

  if (wouldCreateDependencyCycle(tasks, targetTaskId, predecessorTaskId)) {
    const dependencyEdgesToRemove = new Set<string>();

    function collectCycleBreakingEdges(taskId: string, visited = new Set<string>()) {
      if (visited.has(taskId)) {
        return;
      }

      visited.add(taskId);
      const task = taskMap.get(taskId);

      if (!task) {
        return;
      }

      task.dependencyIds.forEach((dependencyId) => {
        if (dependencyId === targetTaskId) {
          dependencyEdgesToRemove.add(`${task.id}:${dependencyId}`);
          return;
        }

        if (taskDependsOn(taskMap, dependencyId, targetTaskId)) {
          collectCycleBreakingEdges(dependencyId, visited);
        }
      });
    }

    collectCycleBreakingEdges(predecessorTaskId);

    nextTasks = tasks.map((task) => {
      const dependencyIds = task.dependencyIds.filter(
        (dependencyId) => !dependencyEdgesToRemove.has(`${task.id}:${dependencyId}`),
      );

      return dependencyIds.length === task.dependencyIds.length ? task : { ...task, dependencyIds };
    });
  }

  return nextTasks.map((task) =>
    task.id === targetTaskId
      ? { ...task, dependencyIds: [...new Set([...task.dependencyIds, predecessorTaskId])] }
      : task,
  );
}

export function rebuildDependenciesFromTasks(tasks: Task[], existingDependencies: Dependency[]) {
  const existingByKey = new Map(
    existingDependencies.map((dependency) => [
      `${dependency.predecessorTaskId}:${dependency.successorTaskId}`,
      dependency,
    ]),
  );

  return tasks.flatMap((task) =>
    task.dependencyIds.map((predecessorTaskId, index) => {
      const existing = existingByKey.get(`${predecessorTaskId}:${task.id}`);

      return {
        id: existing?.id ?? `dep-${predecessorTaskId}-${task.id}-${index}`,
        predecessorTaskId,
        successorTaskId: task.id,
        type: existing?.type ?? "finish_to_start",
        lagMinutes: existing?.lagMinutes,
        constraintType: existing?.constraintType ?? (task.qualityGate ? "quality" : undefined),
      } satisfies Dependency;
    }),
  );
}

export interface TaskScheduleFloat {
  taskId: string;
  earlyStartMs: number;
  earlyFinishMs: number;
  lateStartMs: number;
  lateFinishMs: number;
  /** Slack before this task delays the whole project. */
  totalFloatMinutes: number;
  /** Slack before this task delays ANY direct successor's early start (safe to consume without rippling). */
  freeFloatMinutes: number;
  isCritical: boolean;
}

/**
 * Critical-path / float analysis over an already-(ASAP)-scheduled task set. Forward values
 * (ES/EF) are read from each task's plannedStart/plannedFinish; a backward pass over the
 * successor graph derives LS/LF and total float. Free float (slack that delays no successor)
 * lets a leveler push non-critical work later without moving anything else. `Task.criticalPath`
 * is not trusted — criticality is computed here from the longest path.
 */
export function computeCriticalPath(tasks: Task[]): Map<string, TaskScheduleFloat> {
  const result = new Map<string, TaskScheduleFloat>();
  if (tasks.length === 0) {
    return result;
  }

  const es = new Map<string, number>();
  const ef = new Map<string, number>();
  const durMs = new Map<string, number>();
  for (const task of tasks) {
    const startMs = Date.parse(task.plannedStart);
    const finishMs = Date.parse(task.plannedFinish);
    if (!Number.isFinite(startMs) || !Number.isFinite(finishMs)) {
      continue;
    }
    es.set(task.id, startMs);
    ef.set(task.id, finishMs);
    durMs.set(task.id, Math.max(task.plannedDurationMinutes, 0) * 60_000);
  }

  const scheduled = tasks.filter((task) => es.has(task.id));
  if (scheduled.length === 0) {
    return result;
  }

  const projectFinishMs = Math.max(...scheduled.map((task) => ef.get(task.id) ?? 0));

  // taskId -> ids of tasks that depend on it (its successors)
  const successorsById = new Map<string, string[]>();
  for (const task of scheduled) {
    for (const dependencyId of task.dependencyIds) {
      if (!es.has(dependencyId)) {
        continue;
      }
      const list = successorsById.get(dependencyId) ?? [];
      list.push(task.id);
      successorsById.set(dependencyId, list);
    }
  }

  const lf = new Map<string, number>();
  const ls = new Map<string, number>();
  const visiting = new Set<string>();

  function resolveLate(taskId: string): number {
    const cached = ls.get(taskId);
    if (cached !== undefined) {
      return cached;
    }
    if (visiting.has(taskId)) {
      // Defensive against a dependency cycle: treat as the project boundary.
      return projectFinishMs - (durMs.get(taskId) ?? 0);
    }
    visiting.add(taskId);

    const successors = successorsById.get(taskId) ?? [];
    const lateFinishMs = successors.length === 0
      ? projectFinishMs
      : Math.min(...successors.map((successorId) => resolveLate(successorId)));
    const lateStartMs = lateFinishMs - (durMs.get(taskId) ?? 0);
    lf.set(taskId, lateFinishMs);
    ls.set(taskId, lateStartMs);
    visiting.delete(taskId);
    return lateStartMs;
  }

  for (const task of scheduled) {
    resolveLate(task.id);
  }

  for (const task of scheduled) {
    const taskId = task.id;
    const earlyStartMs = es.get(taskId) ?? 0;
    const earlyFinishMs = ef.get(taskId) ?? 0;
    const lateFinishMs = lf.get(taskId) ?? projectFinishMs;
    const lateStartMs = ls.get(taskId) ?? earlyStartMs;
    const totalFloatMs = Math.max(0, lateStartMs - earlyStartMs);
    const successors = successorsById.get(taskId) ?? [];
    const freeFloatMs = successors.length === 0
      ? totalFloatMs
      : Math.max(0, Math.min(...successors.map((successorId) => es.get(successorId) ?? earlyFinishMs)) - earlyFinishMs);

    result.set(taskId, {
      taskId,
      earlyStartMs,
      earlyFinishMs,
      lateStartMs,
      lateFinishMs,
      totalFloatMinutes: totalFloatMs / 60_000,
      freeFloatMinutes: freeFloatMs / 60_000,
      isCritical: totalFloatMs < 60_000,
    });
  }

  return result;
}

export function rescheduleTasksByDependencies(tasks: Task[], options: { preserveManualStartTaskIds?: Set<string> } = {}) {
  if (tasks.length === 0) {
    return tasks;
  }

  const taskStartTimes = tasks.map((task) => Date.parse(task.plannedStart)).filter(Number.isFinite);
  const lineStartMs = taskStartTimes.length ? Math.min(...taskStartTimes) : Date.now();
  const taskById = new Map(tasks.map((task) => [task.id, task]));
  const scheduledById = new Map<string, { startMs: number; finishMs: number }>();
  const visiting = new Set<string>();

  function resolveSchedule(taskId: string): { startMs: number; finishMs: number } {
    const existing = scheduledById.get(taskId);
    if (existing) {
      return existing;
    }

    const task = taskById.get(taskId);
    if (!task) {
      return { startMs: lineStartMs, finishMs: lineStartMs };
    }

    if (visiting.has(taskId)) {
      const fallbackFinish = Date.parse(task.plannedFinish);
      const finishMs = Number.isFinite(fallbackFinish) ? fallbackFinish : lineStartMs;
      const durationMs = Math.max(task.plannedDurationMinutes, 0) * 60_000;
      return { startMs: Math.max(lineStartMs, finishMs - durationMs), finishMs: Math.max(lineStartMs, finishMs) };
    }

    visiting.add(taskId);

    const plannedStartMs = Date.parse(task.plannedStart);
    const manualStartMs = Number.isFinite(plannedStartMs) ? Math.max(lineStartMs, plannedStartMs) : lineStartMs;
    const dependencyFinishMs = task.dependencyIds.reduce((latestFinish, dependencyId) => {
      const predecessor = taskById.get(dependencyId);
      if (!predecessor) {
        return latestFinish;
      }

      return Math.max(latestFinish, resolveSchedule(predecessor.id).finishMs);
    }, lineStartMs);
    const startMs = task.dependencyIds.length > 0
      ? Math.max(
        lineStartMs,
        dependencyFinishMs,
        options.preserveManualStartTaskIds?.has(task.id) ? manualStartMs : lineStartMs,
      )
      : Math.max(lineStartMs, manualStartMs);
    const finishMs = startMs + Math.max(task.plannedDurationMinutes, 0) * 60_000;
    const schedule = { startMs, finishMs };
    scheduledById.set(taskId, schedule);
    visiting.delete(taskId);

    return schedule;
  }

  return tasks.map((task) => {
    const { startMs, finishMs } = resolveSchedule(task.id);

    return {
      ...task,
      plannedStart: new Date(startMs).toISOString(),
      plannedFinish: new Date(finishMs).toISOString(),
    };
  });
}
