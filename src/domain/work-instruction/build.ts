/**
 * Builds a printable work instruction from planner state.
 *
 * Pure: no React, no Supabase, no DOM. Everything the print document needs is
 * resolved here so the renderer stays a dumb projection of `WorkInstruction`.
 *
 * The two non-obvious reads are the step-id-keyed maps in `task.customFields`:
 * tools (`stepToolLists`) and photos (`stepPhotoAttachments`) are step-scoped,
 * NOT task-scoped, so they cannot be read off the Task fields of similar name.
 * `task.toolsRequired` / `task.equipmentRequired` are separate task-level lists
 * that only appear in the setup rollup.
 */

import {
  getManufacturingStepCheckDefinitions,
  getManufacturingStepCheckState,
  type ManufacturingStepCheckDefinition,
} from "../manufacturing-step-checks";
import { documentDisplayCode, stepDisplayCode } from "../nomenclature";
import { getTaskStepPhotoAttachmentMap, type StepPhotoAttachmentMap } from "../step-photos";
import { getTaskStepToolListMap } from "../step-tools";
import type { ManufacturingStep, Product, Task, Zone } from "../types";
import {
  INSTRUCTION_BUDGET_CHARS,
  type WorkInstruction,
  type WorkInstructionCard,
  type WorkInstructionCheck,
  type WorkInstructionPart,
  type WorkInstructionPhoto,
} from "./schema";

export interface BuildWorkInstructionInput {
  task: Task;
  product: Product;
  zone?: Zone;
}

/** Case-insensitive de-dupe that keeps first-seen order and drops blanks. */
function uniqueNames(values: string[]): string[] {
  const seen = new Set<string>();
  return values.reduce<string[]>((accumulator, value) => {
    const name = value.trim();
    const key = name.toLocaleLowerCase();
    if (!name || seen.has(key)) {
      return accumulator;
    }
    seen.add(key);
    return [...accumulator, name];
  }, []);
}

function buildChecks(
  step: ManufacturingStep,
  definitions: ManufacturingStepCheckDefinition[],
): WorkInstructionCheck[] {
  const state = getManufacturingStepCheckState(step.qualityCheck, definitions);

  // Definition order, not selection order, so every card lists checks the same way.
  return definitions
    .filter((definition) => state.selected.has(definition.key))
    .map((definition) => {
      const stored = state.values[definition.key];
      const unit = stored?.unit ?? definition.defaultUnit ?? "";
      const spec = stored?.value === undefined ? "" : `${stored.value}${unit ? ` ${unit}` : ""}`;
      return { key: definition.key, label: definition.label, spec };
    });
}

function buildPhoto(attachments: StepPhotoAttachmentMap, stepId: string): WorkInstructionPhoto | undefined {
  // One photo per card: the grid slot holds exactly one, and the first is the
  // one the operator sees in the step editor.
  const [first] = attachments[stepId] ?? [];
  if (!first) {
    return undefined;
  }
  // dataUrl, never thumbnailUrl — this prints into a 2.45 x 3.20in box, where a
  // thumbnail would visibly pixelate.
  return { id: first.id, url: first.dataUrl, caption: first.caption ?? "" };
}

function buildParts(task: Task): WorkInstructionPart[] {
  return (task.partReferences ?? []).map((part) => ({
    partNumber: part.partNumber,
    description: part.description ?? "",
    quantity: part.quantity,
  }));
}

export function buildWorkInstruction({ task, product, zone }: BuildWorkInstructionInput): WorkInstruction {
  const definitions = getManufacturingStepCheckDefinitions(product.customFields);
  const toolsByStep = getTaskStepToolListMap(task);
  const photosByStep = getTaskStepPhotoAttachmentMap(task);
  const documentNumber = documentDisplayCode(task);

  const steps = [...(task.manufacturingSteps ?? [])].sort((left, right) => left.sequence - right.sequence);

  const cards: WorkInstructionCard[] = steps.map((step, index) => ({
    stepId: step.id,
    sequence: index + 1,
    code: stepDisplayCode(task, step),
    name: step.name ?? "",
    instruction: step.instruction,
    overflowing: step.instruction.length > INSTRUCTION_BUDGET_CHARS,
    durationMinutes: step.durationMinutes,
    tools: toolsByStep[step.id] ?? [],
    checks: buildChecks(step, definitions),
    photo: buildPhoto(photosByStep, step.id),
  }));

  return {
    taskId: task.id,
    meta: {
      documentNumber,
      title: task.name,
      revision: product.revision ?? "",
      effectiveDate: "",
      preparedBy: "",
      reviewedBy: "",
      approvedBy: "",
      revisionHistory: [],
    },
    context: {
      productName: product.name,
      productCode: product.productCode ?? "",
      productRevision: product.revision ?? "",
      zoneName: zone?.name ?? "Unzoned",
      manufacturingCode: task.manufacturingCode ?? "",
    },
    setup: {
      purpose: task.description ?? "",
      safetyNotes: task.safetyNotes ?? "",
      tools: uniqueNames([
        ...steps.flatMap((step) => toolsByStep[step.id] ?? []),
        ...(task.toolsRequired ?? []),
        ...(task.equipmentRequired ?? []),
      ]),
      parts: buildParts(task),
      materialKit: task.materialKit ?? "",
      drawingLink: task.drawingLink ?? "",
      sopLink: task.sopLink ?? "",
      plannedDurationMinutes: task.plannedDurationMinutes,
      plannedOperators: task.plannedOperators,
      qualityGate: task.qualityGate,
    },
    cards,
    blank: cards.length === 0,
  };
}
