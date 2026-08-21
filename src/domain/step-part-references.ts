import type { PartReference, Task } from "./types";
import {
  addStepPartMention,
  removePartReferenceMentions,
  removeStepPartReferenceMentions,
} from "./step-part-mentions";

export const STEP_PART_REFERENCE_REF_PREFIX = "part:";
const STEP_PART_QUANTITY_SEPARATOR = "|qty:";

function cleanId(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function uniqueIds(values: unknown[]) {
  return values
    .map(cleanId)
    .filter(Boolean)
    .filter((id, index, list) => list.indexOf(id) === index);
}

function cleanQuantity(value: unknown) {
  const quantity = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(quantity) || quantity <= 0) {
    return undefined;
  }

  return Math.round(quantity * 1_000_000) / 1_000_000;
}

export function encodeStepPartReferenceId(partReferenceId: string, quantity?: number) {
  const encodedId = `${STEP_PART_REFERENCE_REF_PREFIX}${partReferenceId}`;
  const normalizedQuantity = cleanQuantity(quantity);
  return normalizedQuantity === undefined
    ? encodedId
    : `${encodedId}${STEP_PART_QUANTITY_SEPARATOR}${normalizedQuantity}`;
}

export function decodeStepPartReference(value: string) {
  if (!value.startsWith(STEP_PART_REFERENCE_REF_PREFIX)) {
    return undefined;
  }

  const encoded = value.slice(STEP_PART_REFERENCE_REF_PREFIX.length);
  const quantityIndex = encoded.lastIndexOf(STEP_PART_QUANTITY_SEPARATOR);
  if (quantityIndex < 0) {
    const partReferenceId = cleanId(encoded);
    return partReferenceId ? { partReferenceId, quantity: undefined } : undefined;
  }

  const partReferenceId = cleanId(encoded.slice(0, quantityIndex));
  if (!partReferenceId) {
    return undefined;
  }

  return {
    partReferenceId,
    quantity: cleanQuantity(encoded.slice(quantityIndex + STEP_PART_QUANTITY_SEPARATOR.length)),
  };
}

export function decodeStepPartReferenceId(value: string) {
  return decodeStepPartReference(value)?.partReferenceId;
}

export function splitStepDependencyRefs(values: unknown[]) {
  const dependencyIds: string[] = [];
  const partReferenceIds: string[] = [];
  const partReferenceQuantities: Record<string, number> = {};

  uniqueIds(values).forEach((value) => {
    const partReference = decodeStepPartReference(value);
    if (partReference) {
      if (!partReferenceIds.includes(partReference.partReferenceId)) {
        partReferenceIds.push(partReference.partReferenceId);
      }
      if (partReference.quantity !== undefined) {
        partReferenceQuantities[partReference.partReferenceId] = partReference.quantity;
      }
      return;
    }

    dependencyIds.push(value);
  });

  return { dependencyIds, partReferenceIds, partReferenceQuantities };
}

export function mergeStepDependencyRefs(
  dependencyIds: unknown[] = [],
  partReferenceIds: unknown[] = [],
  partReferenceQuantities: Record<string, number> = {},
) {
  return [
    ...uniqueIds(dependencyIds),
    ...uniqueIds(partReferenceIds).map((partReferenceId) =>
      encodeStepPartReferenceId(partReferenceId, partReferenceQuantities[partReferenceId]),
    ),
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

export type TaskPartAllocationSummary = {
  part: PartReference;
  allocatedQuantity: number;
};

/**
 * Build a task-level summary from actual step allocations. Unlinked task part
 * records are intentionally excluded, and quantities are totaled across every
 * step that uses the part.
 */
export function getTaskPartAllocationSummaries(
  task: Pick<Task, "manufacturingSteps" | "partReferences">,
): TaskPartAllocationSummary[] {
  const partById = new Map((task.partReferences ?? []).map((part) => [part.id, part]));
  const allocatedQuantityByPartId = new Map<string, number>();

  (task.manufacturingSteps ?? []).forEach((step) => {
    uniqueIds(step.partReferenceIds ?? []).forEach((partReferenceId) => {
      if (!partById.has(partReferenceId)) {
        return;
      }

      const quantity = getStepPartReferenceQuantity(task, step.id, partReferenceId);
      allocatedQuantityByPartId.set(
        partReferenceId,
        (allocatedQuantityByPartId.get(partReferenceId) ?? 0) + quantity,
      );
    });
  });

  return (task.partReferences ?? []).flatMap((part) => {
    const allocatedQuantity = allocatedQuantityByPartId.get(part.id);
    return allocatedQuantity === undefined ? [] : [{ part, allocatedQuantity }];
  });
}

export function getStepPartReferenceQuantity(
  task: Pick<Task, "manufacturingSteps" | "partReferences">,
  stepId: string,
  partReferenceId: string,
) {
  const step = (task.manufacturingSteps ?? []).find((candidate) => candidate.id === stepId);
  const stepQuantity = cleanQuantity(step?.partReferenceQuantities?.[partReferenceId]);
  if (stepQuantity !== undefined) {
    return stepQuantity;
  }

  const partQuantity = cleanQuantity((task.partReferences ?? []).find((part) => part.id === partReferenceId)?.quantity);
  return partQuantity ?? 1;
}

export function addStepPartReference(
  task: Task,
  stepId: string,
  partReferenceId: string,
  quantity?: number,
): Task {
  const partId = cleanId(partReferenceId);
  const part = (task.partReferences ?? []).find((candidate) => candidate.id === partId);
  if (!partId || !part) {
    return task;
  }

  return {
    ...task,
    manufacturingSteps: (task.manufacturingSteps ?? []).map((step) =>
      step.id === stepId
        ? {
            ...step,
            partReferenceIds: uniqueIds([...(step.partReferenceIds ?? []), partId]),
            partReferenceQuantities: {
              ...(step.partReferenceQuantities ?? {}),
              [partId]:
                cleanQuantity(quantity) ??
                cleanQuantity(step.partReferenceQuantities?.[partId]) ??
                cleanQuantity(part.quantity) ??
                1,
            },
          }
        : step,
    ),
  };
}

export function setStepPartReferenceQuantity(
  task: Task,
  stepId: string,
  partReferenceId: string,
  quantity: number,
): Task {
  const normalizedQuantity = cleanQuantity(quantity);
  if (normalizedQuantity === undefined) {
    return task;
  }

  return {
    ...task,
    manufacturingSteps: (task.manufacturingSteps ?? []).map((step) =>
      step.id === stepId && (step.partReferenceIds ?? []).includes(partReferenceId)
        ? {
            ...step,
            partReferenceQuantities: {
              ...(step.partReferenceQuantities ?? {}),
              [partReferenceId]: normalizedQuantity,
            },
          }
        : step,
    ),
  };
}

export type StepPartInput = {
  partNumber: string;
  description?: string;
  quantity?: number;
};

export type StepPartTextSelection = {
  start: number;
  end: number;
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
  const inputDescription = input.description?.trim() ?? "";
  const partReference: PartReference = existingPart
    ? {
        ...existingPart,
        description: existingPart.description?.trim() ? existingPart.description : inputDescription,
      }
    : {
    id: makeId(),
    partNumber,
    description: inputDescription,
    quantity: input.quantity ?? 1,
    disposition: "",
  };
  const taskWithPart = existingPart
    ? {
        ...task,
        partReferences: partReferences.map((part) => (part.id === existingPart.id ? partReference : part)),
      }
    : { ...task, partReferences: [...partReferences, partReference] };

  return addStepPartReference(taskWithPart, stepId, partReference.id, input.quantity);
}

export function attachPartMentionToStep(
  task: Task,
  stepId: string,
  instruction: string,
  selection: StepPartTextSelection,
  input: StepPartInput,
  makePartId: () => string,
  makeMentionId: () => string,
): Task | null {
  const partNumber = input.partNumber.trim();
  const taskWithPart = attachPartToStep(task, stepId, input, makePartId);
  if (!taskWithPart) {
    return null;
  }

  const partReference = (taskWithPart.partReferences ?? []).find(
    (part) => part.partNumber.trim().toLocaleLowerCase() === partNumber.toLocaleLowerCase(),
  );
  if (!partReference) {
    return null;
  }

  return addStepPartMention(taskWithPart, stepId, instruction, {
    id: makeMentionId(),
    partReferenceId: partReference.id,
    start: selection.start,
    end: selection.end,
  });
}

export function removeStepPartReference(task: Task, stepId: string, partReferenceId: string): Task {
  const taskWithoutAllocation = {
    ...task,
    manufacturingSteps: (task.manufacturingSteps ?? []).map((step) =>
      step.id === stepId
        ? {
            ...step,
            partReferenceIds: (step.partReferenceIds ?? []).filter((partId) => partId !== partReferenceId),
            partReferenceQuantities: Object.fromEntries(
              Object.entries(step.partReferenceQuantities ?? {}).filter(([partId]) => partId !== partReferenceId),
            ),
          }
        : step,
    ),
  };

  return removeStepPartReferenceMentions(taskWithoutAllocation, stepId, partReferenceId);
}

export function removePartReferenceFromSteps(task: Task, partReferenceId: string): Task {
  const taskWithoutStepLinks = {
    ...task,
    manufacturingSteps: (task.manufacturingSteps ?? []).map((step) => ({
      ...step,
      partReferenceIds: (step.partReferenceIds ?? []).filter((partId) => partId !== partReferenceId),
      partReferenceQuantities: Object.fromEntries(
        Object.entries(step.partReferenceQuantities ?? {}).filter(([partId]) => partId !== partReferenceId),
      ),
    })),
  };

  return removePartReferenceMentions(taskWithoutStepLinks, partReferenceId);
}
