import { defaultDocumentTypeCodes, generateTaskCode } from "./nomenclature";
import { STEP_PART_MENTIONS_FIELD } from "./step-part-mentions";
import { STEP_PHOTO_ATTACHMENTS_FIELD } from "./step-photos";
import { STEP_TOOL_LISTS_FIELD } from "./step-tools";
import type { ManufacturingComponent, PlannerState, Task, Zone } from "./types";

/**
 * Pure task-transformation helpers extracted from line-workspace.tsx.
 * Each returns a new object/value and never mutates its inputs.
 */

export function isCustomFieldRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

export function removeStepScopedCustomFields(task: Task, stepId: string): Task {
  const nextCustomFields = { ...task.customFields };

  [STEP_PHOTO_ATTACHMENTS_FIELD, STEP_TOOL_LISTS_FIELD, STEP_PART_MENTIONS_FIELD].forEach((field) => {
    const fieldValue = nextCustomFields[field];

    if (!isCustomFieldRecord(fieldValue)) {
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

export function taskPatchChangesSchedule(patch: Partial<Task>) {
  return (
    patch.plannedStart !== undefined ||
    patch.plannedFinish !== undefined ||
    patch.plannedDurationMinutes !== undefined
  );
}

export function enforceStepDerivedDuration(task: Task, patch: Partial<Task>) {
  if (
    patch.plannedDurationMinutes === undefined ||
    patch.manufacturingSteps !== undefined ||
    (task.manufacturingSteps ?? []).length === 0
  ) {
    return patch;
  }

  const { plannedDurationMinutes: _blockedDuration, ...safePatch } = patch;

  if (patch.plannedStart === undefined) {
    const { plannedFinish: _blockedFinish, ...safePatchWithoutFinish } = safePatch;
    return safePatchWithoutFinish;
  }

  return safePatch;
}

export function applyTaskCode(
  task: Task,
  zones: Zone[],
  components: ManufacturingComponent[],
  force = false,
) {
  if (task.codeLocked && !force) {
    return task;
  }

  const manufacturingCode = generateTaskCode(task, zones, components);
  return {
    ...task,
    manufacturingCode: manufacturingCode || undefined,
    codeGeneratedAt: manufacturingCode ? new Date().toISOString() : undefined,
  };
}

export function applyTaskCodes(
  tasks: Task[],
  zones: Zone[],
  components: ManufacturingComponent[],
  force = false,
) {
  return tasks.map((task) => applyTaskCode(task, zones, components, force));
}

export function ensureNomenclatureCollections(state: PlannerState): PlannerState {
  return {
    ...state,
    components: state.components ?? [],
    documentTypes:
      state.documentTypes ??
      defaultDocumentTypeCodes.map((documentType) => ({
        id: `document-type-${documentType.code.toLowerCase()}`,
        productId: state.product.id,
        ...documentType,
        createdAt: state.product.createdAt,
        updatedAt: state.product.updatedAt,
      })),
  };
}
