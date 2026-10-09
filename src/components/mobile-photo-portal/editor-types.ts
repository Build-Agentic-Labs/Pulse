import type { CaptureTimerState } from "./capture-session";
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

/** UI changes text; the owning workflow coordinates state, recovery, and autosave. */
export interface MobileDraftTextEditor {
  values: Pick<MobileStepDraftSnapshot, "name" | "instruction" | "durationText">;
  change: (patch: Partial<MobileDraftTextEditor["values"]>) => void;
  retrySave: () => void;
}

export interface MobileDraftCaptureView {
  timer: CaptureTimerState;
  stepId: string | null;
  onSelectedTask: boolean;
  lapElapsedMs: number;
  elapsedMs: number;
}

export interface MobileDraftMedia {
  photos: StepPhotoAttachment[];
  busyCount: number;
  add: (files: File[]) => Promise<void>;
  remove: (photoId: string) => void;
}
