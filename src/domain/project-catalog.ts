import { removePartReferenceFromSteps } from "@/domain/step-part-references";
import { getTaskStepToolListMap } from "@/domain/step-tools";
import type { ToolLibraryItem } from "@/domain/supabase-planner";
import { canonicalToolKey, formatToolName } from "@/domain/tool-name-format";
import { resolveProjectTool, type ProjectToolDefinition } from "@/domain/tool-registry";
import { resolveToolType, TOOL_TYPE_OPTIONS, type ToolTypeValue } from "@/domain/tool-types";
import type { PartReference, Task } from "@/domain/types";

export type ProjectToolCatalogEntry = {
  key: string;
  /** The representative raw stored name — used as the rename `from` and by Tidy. */
  rawName: string;
  id: string;
  name: string;
  color: string;
  colorLabel: string;
  category: ToolTypeValue;
  libraryId?: string;
  stepUsageCount: number;
  taskUsageCount: number;
};

export type ProjectToolCatalogGroup = {
  type: ToolTypeValue;
  label: string;
  count: number;
  entries: ProjectToolCatalogEntry[];
};

export type ProjectPartCatalogEntry = {
  taskId: string;
  taskLabel: string;
  part: PartReference;
  linkedStepCount: number;
};

function normalizePartNumber(partNumber: string) {
  return partNumber.trim().toLocaleLowerCase();
}

export function buildProjectToolCatalog(
  tasks: Task[],
  registry: Map<string, ProjectToolDefinition>,
  libraryItems: ToolLibraryItem[] = [],
): ProjectToolCatalogEntry[] {
  const libraryByName = new Map(
    libraryItems.map((item) => [canonicalToolKey(item.toolName), item] as const),
  );

  // First-seen raw spelling and usage, both keyed by the canonical key so a
  // messy stored name and its formatted display form never diverge.
  const rawByKey = new Map<string, string>();
  const usageByKey = new Map<string, { stepUsageCount: number; taskIds: Set<string> }>();

  tasks.forEach((task) => {
    Object.values(getTaskStepToolListMap(task)).forEach((tools) => {
      tools.forEach((toolName) => {
        const key = canonicalToolKey(toolName);
        if (!rawByKey.has(key)) {
          rawByKey.set(key, toolName);
        }
        const usage = usageByKey.get(key) ?? { stepUsageCount: 0, taskIds: new Set<string>() };
        usage.stepUsageCount += 1;
        usage.taskIds.add(task.id);
        usageByKey.set(key, usage);
      });
    });
  });

  const entries = [...rawByKey.entries()].map(([key, rawName]) => {
    const name = formatToolName(rawName);
    const registryTool = resolveProjectTool(rawName, registry);
    const libraryItem = libraryByName.get(key);
    const usage = usageByKey.get(key) ?? { stepUsageCount: 0, taskIds: new Set<string>() };

    return {
      key,
      rawName,
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

  return entries.sort((left, right) =>
    left.name.localeCompare(right.name, undefined, { sensitivity: "base" }),
  );
}

export function groupToolCatalogByType(entries: ProjectToolCatalogEntry[]): ProjectToolCatalogGroup[] {
  const byType = new Map<ToolTypeValue, ProjectToolCatalogEntry[]>();

  entries.forEach((entry) => {
    const list = byType.get(entry.category) ?? [];
    list.push(entry);
    byType.set(entry.category, list);
  });

  return TOOL_TYPE_OPTIONS.filter((option) => byType.has(option.value)).map((option) => {
    const groupEntries = [...(byType.get(option.value) ?? [])].sort((left, right) =>
      left.name.localeCompare(right.name, undefined, { sensitivity: "base" }),
    );

    return {
      type: option.value,
      label: option.label,
      count: groupEntries.length,
      entries: groupEntries,
    };
  });
}

/**
 * Renames needed to converge stored tool names to their clean form. Keyed off
 * the RAW stored name (not the already-formatted display name) so the plan is
 * not silently empty. Each catalog entry is unique by canonical key, so no two
 * entries can target the same clean name; the `seenTargets` guard is defensive.
 */
export function planToolNameTidy(entries: ProjectToolCatalogEntry[]): Array<{ from: string; to: string }> {
  const seenTargets = new Set<string>();
  const plan: Array<{ from: string; to: string }> = [];

  entries.forEach((entry) => {
    const to = formatToolName(entry.rawName);
    if (to === entry.rawName) {
      return;
    }

    const targetKey = canonicalToolKey(to);
    if (seenTargets.has(targetKey)) {
      return;
    }
    seenTargets.add(targetKey);
    plan.push({ from: entry.rawName, to });
  });

  return plan;
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