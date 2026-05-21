import { removePartReferenceFromSteps } from "@/domain/step-part-references";
import { buildStepToolLibrary, getTaskStepToolListMap } from "@/domain/step-tools";
import type { ToolLibraryItem } from "@/domain/supabase-planner";
import { resolveProjectTool, type ProjectToolDefinition } from "@/domain/tool-registry";
import { resolveToolType, type ToolTypeValue } from "@/domain/tool-types";
import type { PartReference, Task } from "@/domain/types";

export type ProjectToolCatalogEntry = {
  key: string;
  id: string;
  name: string;
  color: string;
  colorLabel: string;
  category: ToolTypeValue;
  libraryId?: string;
  stepUsageCount: number;
  taskUsageCount: number;
};

export type ProjectPartCatalogEntry = {
  taskId: string;
  taskLabel: string;
  part: PartReference;
  linkedStepCount: number;
};

function normalizeToolName(toolName: string) {
  return toolName.trim().toLocaleLowerCase();
}

function normalizePartNumber(partNumber: string) {
  return partNumber.trim().toLocaleLowerCase();
}

export function buildProjectToolCatalog(
  tasks: Task[],
  registry: Map<string, ProjectToolDefinition>,
  libraryItems: ToolLibraryItem[] = [],
): ProjectToolCatalogEntry[] {
  const libraryByName = new Map(
    libraryItems.map((item) => [normalizeToolName(item.toolName), item] as const),
  );
  const usageByKey = new Map<string, { stepUsageCount: number; taskIds: Set<string> }>();

  tasks.forEach((task) => {
    Object.values(getTaskStepToolListMap(task)).forEach((tools) => {
      tools.forEach((toolName) => {
        const key = normalizeToolName(toolName);
        const usage = usageByKey.get(key) ?? { stepUsageCount: 0, taskIds: new Set<string>() };
        usage.stepUsageCount += 1;
        usage.taskIds.add(task.id);
        usageByKey.set(key, usage);
      });
    });
  });

  const toolNames = buildStepToolLibrary(tasks);

  return toolNames.map((name) => {
    const key = normalizeToolName(name);
    const registryTool = resolveProjectTool(name, registry);
    const libraryItem = libraryByName.get(key);
    const usage = usageByKey.get(key) ?? { stepUsageCount: 0, taskIds: new Set<string>() };

    return {
      key,
      id: registryTool.id,
      name,
      color: registryTool.color,
      colorLabel: registryTool.colorLabel,
      category: resolveToolType(name, libraryItem?.category),
      libraryId: libraryItem?.id ?? registryTool.libraryId,
      stepUsageCount: usage.stepUsageCount,
      taskUsageCount: usage.taskIds.size,
    } satisfies ProjectToolCatalogEntry;
  });
}

export function buildProjectPartCatalog(tasks: Task[]): ProjectPartCatalogEntry[] {
  const entries: ProjectPartCatalogEntry[] = [];

  tasks.forEach((task) => {
    const taskLabel = `${task.wbs} · ${task.name}`.trim();
    (task.partReferences ?? []).forEach((part) => {
      const linkedStepCount = (task.manufacturingSteps ?? []).filter((step) =>
        (step.partReferenceIds ?? []).includes(part.id),
      ).length;

      entries.push({
        taskId: task.id,
        taskLabel,
        part,
        linkedStepCount,
      });
    });
  });

  return entries.sort((left, right) => {
    const partCompare = normalizePartNumber(left.part.partNumber).localeCompare(
      normalizePartNumber(right.part.partNumber),
      undefined,
      { sensitivity: "base" },
    );
    if (partCompare !== 0) {
      return partCompare;
    }

    return left.taskLabel.localeCompare(right.taskLabel, undefined, { sensitivity: "base" });
  });
}

export function updateTaskPartReference(
  tasks: Task[],
  taskId: string,
  partId: string,
  patch: Partial<PartReference>,
): Task[] {
  return tasks.map((task) => {
    if (task.id !== taskId) {
      return task;
    }

    return {
      ...task,
      partReferences: (task.partReferences ?? []).map((part) =>
        part.id === partId ? { ...part, ...patch } : part,
      ),
    };
  });
}

export function removeTaskPartReference(tasks: Task[], taskId: string, partId: string): Task[] {
  return tasks.map((task) => {
    if (task.id !== taskId) {
      return task;
    }

    const withoutLinks = removePartReferenceFromSteps(task, partId);

    return {
      ...withoutLinks,
      partReferences: (withoutLinks.partReferences ?? []).filter((part) => part.id !== partId),
    };
  });
}