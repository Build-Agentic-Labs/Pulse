import type { Task } from "./types";

export type TaskOrderRow = {
  id: string;
  wbs: string;
  zone_id: string | null;
  station_id: string | null;
  version: number;
};
export type TaskOrderPatch = Omit<TaskOrderRow, "version">;
export type TaskReorderRequest = {
  p_project_id: string;
  p_scenario_id: string;
  p_operation_id: string;
  p_expected_versions: Record<string, number>;
  p_order: TaskOrderPatch[];
};

export function taskOrderPatch(task: Task): TaskOrderPatch {
  return { id: task.id, wbs: task.wbs, zone_id: task.zoneId ?? null, station_id: task.stationId || null };
}

/** Read only current versions: intended order still comes from the user's original snapshot. */
export function taskReorderRequest(
  projectId: string, scenarioId: string, operationId: string,
  before: Task[], after: Task[], remote: TaskOrderRow[],
): TaskReorderRequest {
  const conflict = () => { throw new Error("Task reorder conflict. Reload before reordering again."); };
  if (!projectId || !scenarioId || !operationId || !before.length) conflict();
  const ids = new Set(before.map((task) => task.id));
  if (ids.size !== before.length || after.length !== ids.size || remote.length !== ids.size
      || new Set(after.map((task) => task.id)).size !== ids.size
      || new Set(remote.map((task) => task.id)).size !== ids.size
      || new Set(after.map((task) => task.wbs)).size !== ids.size) conflict();
  const previous = new Map(before.map((task) => [task.id, taskOrderPatch(task)]));
  for (const task of [...before, ...after]) if (task.scenarioId !== scenarioId || !ids.has(task.id)) conflict();
  for (const row of remote) {
    const expected = previous.get(row.id);
    if (!expected || !Number.isSafeInteger(row.version) || row.version < 1
        || row.wbs !== expected.wbs || row.zone_id !== expected.zone_id || row.station_id !== expected.station_id) conflict();
  }
  return {
    p_project_id: projectId, p_scenario_id: scenarioId, p_operation_id: operationId,
    p_expected_versions: Object.fromEntries(remote.map((row) => [row.id, row.version])),
    p_order: after.map(taskOrderPatch).filter((row) => {
      const old = previous.get(row.id)!;
      return row.wbs !== old.wbs || row.zone_id !== old.zone_id || row.station_id !== old.station_id;
    }),
  };
}

export function confirmedTaskOrder(value: unknown, request: TaskReorderRequest): TaskOrderRow[] {
  const fail = () => { throw new Error("Unable to confirm the saved task order. Reload before reordering again."); };
  if (!value || typeof value !== "object") return fail();
  const result = value as Record<string, unknown>;
  if (result.operation_id !== request.p_operation_id || result.scenario_id !== request.p_scenario_id
      || !Array.isArray(result.tasks) || result.tasks.length !== request.p_order.length) return fail();
  const expected = new Set(request.p_order.map((row) => row.id));
  const seen = new Set<string>();
  for (const value of result.tasks) {
    if (!value || typeof value !== "object") return fail();
    const row = value as TaskOrderRow;
    if (typeof row.id !== "string" || !expected.has(row.id) || seen.has(row.id)
        || typeof row.wbs !== "string" || !row.wbs || row.wbs.startsWith("~reorder~")
        || (row.zone_id !== null && typeof row.zone_id !== "string")
        || (row.station_id !== null && typeof row.station_id !== "string")
        || !Number.isSafeInteger(row.version) || row.version < 1) return fail();
    seen.add(row.id);
  }
  if (new Set(result.tasks.map((row: TaskOrderRow) => row.wbs)).size !== seen.size) return fail();
  return result.tasks as TaskOrderRow[];
}

/** Merge order only. Text, media, pending local fields and task membership remain owned by the editor. */
export function mergeTaskOrder(tasks: Task[], order: TaskOrderRow[]): Task[] {
  const rows = new Map(order.map((row) => [row.id, row]));
  return tasks.map((task) => {
    const row = rows.get(task.id);
    return row && (task.version === undefined || task.version <= row.version) ? { ...task, wbs: row.wbs, zoneId: row.zone_id ?? undefined,
      stationId: row.station_id ?? "", version: row.version } : task;
  });
}

/** Roll back only our still-visible optimistic order; don't undo a later reorder or another edit. */
export function rollbackTaskOrder(tasks: Task[], before: Task[], optimistic: Task[]): Task[] {
  const originals = new Map(before.map((task) => [task.id, task]));
  const intended = new Map(optimistic.map((task) => [task.id, taskOrderPatch(task)]));
  return tasks.map((task) => {
    const previous = originals.get(task.id);
    const expected = intended.get(task.id);
    const actual = taskOrderPatch(task);
    if (!previous || !expected || actual.wbs !== expected.wbs || actual.zone_id !== expected.zone_id
        || actual.station_id !== expected.station_id) return task;
    return { ...task, wbs: previous.wbs, zoneId: previous.zoneId, stationId: previous.stationId };
  });
}
