import type { ManufacturingStep } from "./types";

/** A task's planned time is the sum of its step times; missing and negative times count as zero. */
export function sumStepDurationMinutes(steps: readonly ManufacturingStep[]): number {
  return steps.reduce((total, step) => total + Math.max(step.durationMinutes ?? 0, 0), 0);
}
