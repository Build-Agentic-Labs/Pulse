import { getStepPartReferenceIds, getStepPartReferences } from "./step-part-references";
import {
  STEP_PHOTO_ATTACHMENTS_FIELD,
  getTaskStepPhotoAttachmentMap,
  upsertStepPhotoAttachments,
} from "./step-photos";
import { STEP_TOOL_LISTS_FIELD, addStepTool, getStepToolList } from "./step-tools";
import type { ManufacturingStep, PartReference, Task } from "./types";

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function sumStepDurationMinutes(steps: ManufacturingStep[]) {
  return steps.reduce((total, step) => total + Math.max(step.durationMinutes ?? 0, 0), 0);
}

function normalizeStepSequences(steps: ManufacturingStep[]) {
  return steps.map((step, index) => ({ ...step, sequence: index + 1 }));
}

function removeStepScopedCustomFields(task: Task, stepId: string): Task {
  const nextCustomFields = { ...task.customFields };

  [STEP_PHOTO_ATTACHMENTS_FIELD, STEP_TOOL_LISTS_FIELD].forEach((field) => {
    const fieldValue = nextCustomFields[field];

    if (!isRecord(fieldValue)) {
      return;
    }

    const nextMap = { ...fieldValue };
    delete nextMap[stepId];

    if (Object.keys(nextMap).length > 0) {
      nextCustomFields[field] = nextMap;
    } else {
      delete nextCustomFields[field];
    }
  });

  return {
    ...task,
    customFields: nextCustomFields,
  };
}

function appendStepAssets(
  task: Task,
  stepId: string,
  tools: string[],
  partsToCopy: PartReference[],
): Task {
  let nextTask = task;
  const existingPartIds = new Set((nextTask.partReferences ?? []).map((part) => part.id));
  const mergedParts = [...(nextTask.partReferences ?? [])];

  partsToCopy.forEach((part) => {
    if (!existingPartIds.has(part.id)) {
      mergedParts.push(part);
      existingPartIds.add(part.id);
    }
  });

  if (mergedParts.length !== (nextTask.partReferences ?? []).length) {
    nextTask = {
      ...nextTask,
      partReferences: mergedParts,
    };
  }

  tools.forEach((toolName) => {
    nextTask = addStepTool(nextTask, stepId, toolName);
  });

  return nextTask;
}

export function moveManufacturingStepBetweenTasks(
  tasks: Task[],
  sourceTaskId: string,
  targetTaskId: string,
  stepId: string,
): Task[] | null {
  if (!sourceTaskId || !targetTaskId || sourceTaskId === targetTaskId) {
    return null;
  }

  const sourceTask = tasks.find((task) => task.id === sourceTaskId);
  const targetTask = tasks.find((task) => task.id === targetTaskId);
  const step = sourceTask?.manufacturingSteps?.find((candidate) => candidate.id === stepId);

  if (!sourceTask || !targetTask || !step) {
    return null;
  }

  const tools = getStepToolList(sourceTask, stepId);
  const photos = getTaskStepPhotoAttachmentMap(sourceTask)[stepId] ?? [];
  const partsToCopy = getStepPartReferences(sourceTask, stepId);

  const sourceSteps = normalizeStepSequences((sourceTask.manufacturingSteps ?? []).filter((candidate) => candidate.id !== stepId));
  const targetSteps = normalizeStepSequences([...(targetTask.manufacturingSteps ?? []), step]);

  const nextSourceTask = removeStepScopedCustomFields(
    {
      ...sourceTask,
      manufacturingSteps: sourceSteps,
      plannedDurationMinutes: sumStepDurationMinutes(sourceSteps),
    },
    stepId,
  );

  let nextTargetTask = appendStepAssets(
    {
      ...targetTask,
      manufacturingSteps: targetSteps,
      plannedDurationMinutes: sumStepDurationMinutes(targetSteps),
    },
    stepId,
    tools,
    partsToCopy,
  );

  if (photos.length > 0) {
    nextTargetTask = upsertStepPhotoAttachments(nextTargetTask, stepId, photos);
  }

  const validPartIds = new Set((nextTargetTask.partReferences ?? []).map((part) => part.id));
  nextTargetTask = {
    ...nextTargetTask,
    manufacturingSteps: (nextTargetTask.manufacturingSteps ?? []).map((candidate) =>
      candidate.id === stepId
        ? {
            ...candidate,
            partReferenceIds: getStepPartReferenceIds(
              {
                manufacturingSteps: [candidate],
                partReferences: nextTargetTask.partReferences,
              },
              stepId,
            ).filter((partId) => validPartIds.has(partId)),
          }
        : candidate,
    ),
  };

  return tasks.map((task) => {
    if (task.id === sourceTaskId) {
      return nextSourceTask;
    }

    if (task.id === targetTaskId) {
      return nextTargetTask;
    }

    return task;
  });
}
