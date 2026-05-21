import type { Task } from "./types";

export const STEP_TOOL_LISTS_FIELD = "stepToolLists";

export type StepToolListMap = Record<string, string[]>;

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function cleanToolName(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

export function getTaskStepToolListMap(task: Pick<Task, "customFields">): StepToolListMap {
  const rawMap = task.customFields?.[STEP_TOOL_LISTS_FIELD];

  if (!isRecord(rawMap)) {
    return {};
  }

  return Object.entries(rawMap).reduce<StepToolListMap>((accumulator, [stepId, rawTools]) => {
    if (!Array.isArray(rawTools)) {
      return accumulator;
    }

    const tools = rawTools
      .map(cleanToolName)
      .filter(Boolean)
      .filter((tool, index, list) => list.findIndex((item) => item.toLocaleLowerCase() === tool.toLocaleLowerCase()) === index);

    if (tools.length > 0) {
      accumulator[stepId] = tools;
    }

    return accumulator;
  }, {});
}

export function getStepToolList(task: Pick<Task, "customFields">, stepId: string) {
  return getTaskStepToolListMap(task)[stepId] ?? [];
}

export function countTaskStepTools(task: Pick<Task, "customFields">) {
  return Object.values(getTaskStepToolListMap(task)).reduce((total, tools) => total + tools.length, 0);
}

export function buildStepToolLibrary(tasks: Pick<Task, "customFields">[]) {
  const toolsByKey = new Map<string, string>();

  tasks.forEach((task) => {
    Object.values(getTaskStepToolListMap(task)).forEach((tools) => {
      tools.forEach((tool) => {
        const key = tool.toLocaleLowerCase();
        if (!toolsByKey.has(key)) {
          toolsByKey.set(key, tool);
        }
      });
    });
  });

  return [...toolsByKey.values()].sort((left, right) => left.localeCompare(right, undefined, { sensitivity: "base" }));
}

function writeStepToolListMap(task: Task, map: StepToolListMap): Task {
  const cleanedMap = Object.entries(map).reduce<StepToolListMap>((accumulator, [stepId, rawTools]) => {
    const tools = rawTools
      .map(cleanToolName)
      .filter(Boolean)
      .filter((tool, index, list) => list.findIndex((item) => item.toLocaleLowerCase() === tool.toLocaleLowerCase()) === index);

    if (tools.length > 0) {
      accumulator[stepId] = tools;
    }

    return accumulator;
  }, {});

  const nextCustomFields = { ...task.customFields };

  if (Object.keys(cleanedMap).length > 0) {
    nextCustomFields[STEP_TOOL_LISTS_FIELD] = cleanedMap;
  } else {
    delete nextCustomFields[STEP_TOOL_LISTS_FIELD];
  }

  return {
    ...task,
    customFields: nextCustomFields,
  };
}

export function addStepTool(task: Task, stepId: string, toolName: string): Task {
  const nextTool = cleanToolName(toolName);
  if (!nextTool) {
    return task;
  }

  const map = getTaskStepToolListMap(task);
  return writeStepToolListMap(task, {
    ...map,
    [stepId]: [...(map[stepId] ?? []), nextTool],
  });
}

export function removeStepTool(task: Task, stepId: string, toolName: string): Task {
  const map = getTaskStepToolListMap(task);
  return writeStepToolListMap(task, {
    ...map,
    [stepId]: (map[stepId] ?? []).filter((tool) => tool !== toolName),
  });
}

function dedupeToolNames(tools: string[]) {
  return tools
    .map(cleanToolName)
    .filter(Boolean)
    .filter((tool, index, list) => list.findIndex((item) => item.toLocaleLowerCase() === tool.toLocaleLowerCase()) === index);
}

export function renameToolInTasks(tasks: Task[], fromName: string, toName: string): Task[] {
  const fromKey = fromName.trim().toLocaleLowerCase();
  const nextName = cleanToolName(toName);

  if (!fromKey || !nextName || fromKey === nextName.toLocaleLowerCase()) {
    return tasks;
  }

  return tasks.map((task) => {
    const map = getTaskStepToolListMap(task);
    let changed = false;

    const nextMap = Object.fromEntries(
      Object.entries(map).map(([stepId, tools]) => {
        const nextTools = dedupeToolNames(
          tools.map((tool) => {
            if (tool.toLocaleLowerCase() !== fromKey) {
              return tool;
            }

            changed = true;
            return nextName;
          }),
        );

        return [stepId, nextTools];
      }),
    ) as StepToolListMap;

    return changed ? writeStepToolListMap(task, nextMap) : task;
  });
}

export function removeToolFromAllTasks(tasks: Task[], toolName: string): Task[] {
  const targetKey = toolName.trim().toLocaleLowerCase();

  if (!targetKey) {
    return tasks;
  }

  return tasks.map((task) => {
    const map = getTaskStepToolListMap(task);
    let changed = false;

    const nextMap = Object.fromEntries(
      Object.entries(map).map(([stepId, tools]) => {
        const nextTools = tools.filter((tool) => {
          if (tool.toLocaleLowerCase() === targetKey) {
            changed = true;
            return false;
          }

          return true;
        });

        return [stepId, nextTools];
      }),
    ) as StepToolListMap;

    return changed ? writeStepToolListMap(task, nextMap) : task;
  });
}
