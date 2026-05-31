import type { PartReference, Task } from "./types";

export const STEP_PART_REFERENCE_REF_PREFIX = "part:";

function cleanId(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function uniqueIds(values: unknown[]) {
  return values
    .map(cleanId)
    .filter(Boolean)
    .filter((id, index, list) => list.indexOf(id) === index);
}

export function encodeStepPartReferenceId(partReferenceId: string) {
  return `${STEP_PART_REFERENCE_REF_PREFIX}${partReferenceId}`;
}

export function decodeStepPartReferenceId(value: string) {
  return value.startsWith(STEP_PART_REFERENCE_REF_PREFIX) ? value.slice(STEP_PART_REFERENCE_REF_PREFIX.length) : undefined;
}

export function splitStepDependencyRefs(values: unknown[]) {
  const dependencyIds: string[] = [];
  const partReferenceIds: string[] = [];

  uniqueIds(values).forEach((value) => {
    const partReferenceId = decodeStepPartReferenceId(value);
    if (partReferenceId) {
      partReferenceIds.push(partReferenceId);
      return;
    }

    dependencyIds.push(value);
  });

  return { dependencyIds, partReferenceIds };
}

export function mergeStepDependencyRefs(dependencyIds: unknown[] = [], partReferenceIds: unknown[] = []) {
  return [
    ...uniqueIds(dependencyIds),
    ...uniqueIds(partReferenceIds).map(encodeStepPartReferenceId),
  ];
}

export function getStepPartReferenceIds(task: Pick<Task, "manufacturingSteps" | "partReferences">, stepId: string) {
  const validPartIds = new Set((task.partReferences ?? []).map((part) => part.id));
  const step = (task.manufacturingSteps ?? []).find((candidate) => candidate.id === stepId);

  return uniqueIds(step?.partReferenceIds ?? []).filter((partId) => validPartIds.has(partId));
}

export function getStepPartReferences(task: Pick<Task, "manufacturingSteps" | "partReferences">, stepId: string): PartReference[] {
  const partById = new Map((task.partReferences ?? []).map((part) => [part.id, part]));
  return getStepPartReferenceIds(task, stepId)
    .map((partId) => partById.get(partId))
    .filter((part): part is PartReference => Boolean(part));
}

export function addStepPartReference(task: Task, stepId: string, partReferenceId: string): Task {
  const partId = cleanId(partReferenceId);
  if (!partId || !(task.partReferences ?? []).some((part) => part.id === partId)) {
    return task;
  }

  return {
    ...task,
    manufacturingSteps: (task.manufacturingSteps ?? []).map((step) =>
      step.id === stepId
        ? { ...step, partReferenceIds: uniqueIds([...(step.partReferenceIds ?? []), partId]) }
        : step,
    ),
  };
}

export type StepPartInput = {
  partNumber: string;
  description?: string;
  quantity?: number;
};

/**
 * Resolve a part for a step: reuse an existing task part with the same part
 * number (case-insensitive) or create a new one via `makeId()`, then link it to
 * the step. Returns the updated task, or null when there is no part number.
 */
export function attachPartToStep(
  task: Task,
  stepId: string,
  input: StepPartInput,
  makeId: () => string,
): Task | null {
  const partNumber = input.partNumber.trim();
  if (!partNumber) {
    return null;
  }

  const partReferences = task.partReferences ?? [];
  const existingPart = partReferences.find(
    (part) => part.partNumber.trim().toLowerCase() === partNumber.toLowerCase(),
  );
  const partReference: PartReference = existingPart ?? {
    id: makeId(),
    partNumber,
    description: input.description ?? "",
    quantity: input.quantity ?? 1,
    disposition: "",
  };
  const taskWithPart = existingPart ? task : { ...task, partReferences: [...partReferences, partReference] };

  return addStepPartReference(taskWithPart, stepId, partReference.id);
}

export function removeStepPartReference(task: Task, stepId: string, partReferenceId: string): Task {
  return {
    ...task,
    manufacturingSteps: (task.manufacturingSteps ?? []).map((step) =>
      step.id === stepId
        ? { ...step, partReferenceIds: (step.partReferenceIds ?? []).filter((partId) => partId !== partReferenceId) }
        : step,
    ),
  };
}

export function removePartReferenceFromSteps(task: Task, partReferenceId: string): Task {
  return {
    ...task,
    manufacturingSteps: (task.manufacturingSteps ?? []).map((step) => ({
      ...step,
      partReferenceIds: (step.partReferenceIds ?? []).filter((partId) => partId !== partReferenceId),
    })),
  };
}
