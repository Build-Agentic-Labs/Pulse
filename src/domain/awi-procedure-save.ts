import type { Task } from "./types";

/** Capture only confirmed rows, never infer removals from a later edited snapshot. */
export function awiProcedureSaveBaseline(task: Task): NonNullable<Task["procedureSaveBaseline"]> {
  return {
    stepVersions: Object.fromEntries((task.manufacturingSteps ?? [])
      .filter((step) => step.version !== undefined)
      .map((step) => [step.id, step.version!])),
    partReferences: (task.partReferences ?? []).map((part) => ({ ...part })),
  };
}
