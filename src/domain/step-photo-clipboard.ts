import type { StepPhotoAttachment } from "./step-photos";

export type StepPhotoClipboardMode = "copy" | "cut";

/**
 * One photo staged for placement on another step.
 *
 * The photo is a SNAPSHOT taken at copy time, deliberately: annotating the source after
 * copying does not change what a later paste produces, and deleting the source photo
 * still leaves the paste working because single-photo deletes are soft.
 */
export interface StepPhotoClipboardEntry {
  photo: StepPhotoAttachment;
  sourceTaskId: string;
  sourceStepId: string;
  mode: StepPhotoClipboardMode;
}

export function createStepPhotoClipboardEntry(
  photo: StepPhotoAttachment,
  sourceTaskId: string,
  sourceStepId: string,
  mode: StepPhotoClipboardMode,
): StepPhotoClipboardEntry {
  return { photo, sourceTaskId, sourceStepId, mode };
}

/** Pasting onto the step the photo came from is a no-op, for both copy and cut. */
export function canPasteInto(
  entry: StepPhotoClipboardEntry | null,
  targetTaskId: string,
  targetStepId: string,
): boolean {
  if (!entry) {
    return false;
  }

  return !(entry.sourceTaskId === targetTaskId && entry.sourceStepId === targetStepId);
}
