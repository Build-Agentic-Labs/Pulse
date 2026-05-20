import type { Task } from "./types";

const OPERATOR_IDS_FIELD = "operatorIds";

export function getStoredTaskOperatorIds(task: Pick<Task, "customFields">) {
  const rawOperatorIds = task.customFields?.[OPERATOR_IDS_FIELD];
  if (!Array.isArray(rawOperatorIds)) {
    return [];
  }

  return [...new Set(rawOperatorIds.filter((id): id is string => typeof id === "string"))];
}

export function getTaskOperatorIds(task: Pick<Task, "customFields">, availableOperatorIds: string[]) {
  const storedOperatorIds = getStoredTaskOperatorIds(task);
  const availableSet = new Set(availableOperatorIds);
  const uniqueIds = [...new Set(storedOperatorIds.filter((id): id is string => typeof id === "string"))];

  return uniqueIds.filter((id) => availableSet.has(id));
}

export function getTaskOperatorCount(task: Pick<Task, "customFields">) {
  return getStoredTaskOperatorIds(task).length;
}

export function syncTaskOperatorCount<T extends Task>(task: T): T {
  const plannedOperators = getTaskOperatorCount(task);
  if (task.plannedOperators === plannedOperators) {
    return task;
  }

  return {
    ...task,
    plannedOperators,
  };
}

export function getTaskOperatorPatch(task: Task, operatorIds: string[], availableOperatorIds: string[]): Partial<Task> {
  const availableSet = new Set(availableOperatorIds);
  const normalizedOperatorIds = [...new Set(operatorIds)].filter((id) => availableSet.has(id));

  return {
    plannedOperators: normalizedOperatorIds.length,
    customFields: {
      ...task.customFields,
      [OPERATOR_IDS_FIELD]: normalizedOperatorIds,
    },
  };
}

export function getTaskOperatorResetPatch(task: Task): Partial<Task> {
  return {
    plannedOperators: 0,
    customFields: {
      ...task.customFields,
      [OPERATOR_IDS_FIELD]: [],
    },
  };
}
