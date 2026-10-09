import type { Task } from "./types";

/** Mobile scheduling policy, preserved independently until cycle behavior is reconciled. */
export function rescheduleMobileTasksByDependencies(tasks: Task[]) {
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
      const fallbackStartMs = Date.parse(task.plannedStart);
      const startMs = Number.isFinite(fallbackStartMs) ? fallbackStartMs : lineStartMs;
      return {
        startMs,
        finishMs: startMs + Math.max(task.plannedDurationMinutes, 0) * 60_000,
      };
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
      ? Math.max(lineStartMs, dependencyFinishMs)
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
