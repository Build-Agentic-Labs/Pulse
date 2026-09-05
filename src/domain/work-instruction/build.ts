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
import { getStepPartReferenceQuantity } from "../step-part-references";
import {
  instructionWithPartMentionMarkers,
  numberedStepPartMentions,
} from "../step-part-mentions";
import { getTaskStepPhotoAttachmentMap, type StepPhotoAttachmentMap } from "../step-photos";
import { getTaskStepToolListMap } from "../step-tools";
import type { ManufacturingStep, Product, Task, Zone } from "../types";
import {
  DEFAULT_WORK_INSTRUCTION_LAYOUT,
  type WorkInstruction,
  type WorkInstructionCard,
  type WorkInstructionCheck,
  type WorkInstructionLayout,
  type WorkInstructionPart,
  type WorkInstructionPhoto,
  type WorkInstructionStepPartReference,
} from "./schema";
import { estimateLines } from "./estimate-lines";
import { splitInstruction } from "./split-instruction";

export interface BuildWorkInstructionInput {
  task: Task;
  product: Product;
  zone?: Zone;
  /** Card-grid variant. Determines how much text a card holds, so splitting follows it. */
  layout?: WorkInstructionLayout;
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
  return {
    id: first.id,
    url: first.dataUrl,
    caption: first.caption ?? "",
    ...(first.width ? { width: first.width } : {}),
    ...(first.height ? { height: first.height } : {}),
    ...(first.annotations?.items.length ? { annotations: first.annotations } : {}),
  };
}

/**
 * Parts, with the material kit folded in as the first row.
 *
 * A kit IS a part number, so it belongs in the parts list rather than in a
 * block of its own — and putting it first matches the order it is picked in.
 */
function buildParts(task: Task): WorkInstructionPart[] {
  const kit = task.materialKit?.trim();
  const allocatedQuantityByPartId = new Map<string, number>();
  (task.manufacturingSteps ?? []).forEach((step) => {
    (step.partReferenceIds ?? []).forEach((partReferenceId) => {
      allocatedQuantityByPartId.set(
        partReferenceId,
        (allocatedQuantityByPartId.get(partReferenceId) ?? 0) +
          getStepPartReferenceQuantity(task, step.id, partReferenceId),
      );
    });
  });
  const references = (task.partReferences ?? []).map((part) => ({
    partNumber: part.partNumber,
    description: part.description ?? "",
    quantity: allocatedQuantityByPartId.get(part.id) ?? part.quantity,
  }));

  return kit ? [{ partNumber: kit, description: "Material kit", quantity: 1 }, ...references] : references;
}

function buildStepPartReferences(task: Task, stepId: string): WorkInstructionStepPartReference[] {
  const partById = new Map((task.partReferences ?? []).map((part) => [part.id, part]));
  return numberedStepPartMentions(task, stepId).flatMap((mention) => {
    const part = partById.get(mention.partReferenceId);
    if (!part) {
      return [];
    }

    return [{
      marker: mention.marker,
      text: mention.text,
      partNumber: part.partNumber,
      description: part.description ?? "",
      quantity: getStepPartReferenceQuantity(task, stepId, part.id),
    }];
  });
}

function instructionBudgetWithPartReferences(
  budget: WorkInstructionLayout["instruction"],
  partReferences: WorkInstructionStepPartReference[],
) {
  if (partReferences.length === 0) {
    return budget;
  }

  const referenceLines = partReferences.reduce(
    (total, part) => total + 1 + Math.ceil(part.description.length / Math.max(budget.charsPerLine, 1)),
    1,
  );
  return { ...budget, lines: Math.max(4, budget.lines - referenceLines) };
}

export function buildWorkInstruction({
  task,
  product,
  zone,
  layout = DEFAULT_WORK_INSTRUCTION_LAYOUT,
}: BuildWorkInstructionInput): WorkInstruction {
  const definitions = getManufacturingStepCheckDefinitions(product.customFields);
  const toolsByStep = getTaskStepToolListMap(task);
  const photosByStep = getTaskStepPhotoAttachmentMap(task);
  const documentNumber = documentDisplayCode(task);

  const steps = [...(task.manufacturingSteps ?? [])].sort((left, right) => left.sequence - right.sequence);

  const cards: WorkInstructionCard[] = steps.flatMap((step, index) => {
    const sequence = index + 1;
    const code = stepDisplayCode(task, step);
    const checks = buildChecks(step, definitions);
    const stepPartReferences = buildStepPartReferences(task, step.id);
    const markedInstruction = instructionWithPartMentionMarkers(task, step.id, step.instruction);
    const firstCardInstructionBudget = instructionBudgetWithPartReferences(layout.instruction, stepPartReferences);
    // A reference may move onto a continuation when larger text wraps. Reserve
    // room for its key there too, so the marker remains usable on that card.
    const continuationInstructionBudget = instructionBudgetWithPartReferences(layout.continuation, stepPartReferences);
    const chunks = splitInstruction(markedInstruction, firstCardInstructionBudget, continuationInstructionBudget);
    // A step with no text still gets one card — the operator needs the slot.
    const parts = chunks.length > 0 ? chunks : [""];

    return parts.map((instruction, partIndex) => {
      const first = partIndex === 0;
      const last = partIndex === parts.length - 1;
      const budget = first ? firstCardInstructionBudget : continuationInstructionBudget;

      return {
        stepId: step.id,
        sequence,
        part: partIndex + 1,
        partCount: parts.length,
        code,
        name: step.name ?? "",
        instruction,
        // The splitter already broke what it could; anything still over budget
        // is a single token too wide to break, which only a human can fix.
        overflowing:
          estimateLines(instruction, budget.charsPerLine) > budget.lines,
        // Photo, tools and duration lead the step; checks close it.
        durationMinutes: first ? step.durationMinutes : undefined,
        tools: first ? (toolsByStep[step.id] ?? []) : [],
        checks: last ? checks : [],
        photo: first ? buildPhoto(photosByStep, step.id) : undefined,
        partReferences: first
          ? stepPartReferences
          : stepPartReferences.filter((reference) => instruction.includes(`[${reference.marker}]`)),
      };
    });
  });

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
