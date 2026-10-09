import type { StepPhotoAttachment } from "@/domain/step-photos";
import type { ManufacturingStepCheckValue } from "@/domain/manufacturing-step-checks";

/** The draft shape passed to the coordinator's existing persistence callbacks. */
export interface MobileStepDraftSnapshot {
  stepId: string | null;
  name: string;
  instruction: string;
  durationText: string;
  tools: string[];
  photos: StepPhotoAttachment[];
  checks: Set<string>;
  checkValues: Record<string, ManufacturingStepCheckValue>;
}
