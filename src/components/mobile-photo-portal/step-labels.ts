import type { ManufacturingStep } from "@/domain/types";

export function manufacturingStepDisplayName(step: Pick<ManufacturingStep, "name" | "sequence">) {
  const trimmed = step.name?.trim();
  return trimmed || `Step ${step.sequence}`;
}

export function parseManufacturingStepNameInput(value: string, sequence: number) {
  const trimmed = value.trim();
  const fallback = `Step ${sequence}`;

  if (!trimmed || trimmed === fallback) {
    return "";
  }

  return trimmed;
}
