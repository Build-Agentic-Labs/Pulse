import type { ManufacturingStep, Task } from "@/domain/types";

// Shared fixtures for the save/draft ownership tests: one task with one step ("task-1"/"step-1").

export function procedureTestStep(instruction: string, version = 1, name = "Fit bracket"): ManufacturingStep {
  return { id: "step-1", sequence: 1, name, instruction, durationMinutes: 1, qualityCheck: "", version };
}

export function procedureTestTask(instruction: string, version = 1, patch: Partial<Task> = {}): Task {
  return {
    id: "task-1",
    scenarioId: "scenario-main",
    stationId: "station-1",
    zoneId: "zone-1",
    rowType: "task",
    wbs: "1",
    name: "Bracket task",
    description: "",
    plannedStart: "0h",
    plannedFinish: "1h",
    plannedDurationMinutes: 60,
    plannedOperators: 1,
    plannedManHours: 1,
    status: "not_started",
    percentComplete: 0,
    dependencyIds: [],
    criticalPath: false,
    bottleneckFlag: false,
    qualityGate: false,
    travelerSignoffRequired: false,
    safetyNotes: "",
    manufacturingSteps: [procedureTestStep(instruction, version)],
    partReferences: [],
    customFields: {},
    version,
    ...patch,
  };
}

export function deferredPromise<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((onResolve, onReject) => {
    resolve = onResolve;
    reject = onReject;
  });
  return { promise, resolve, reject };
}
