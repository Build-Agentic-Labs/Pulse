import type { RefObject } from "react";
import type { ManufacturingStep, Task } from "@/domain/types";
import { makeProcedureDraftKey, procedureDraftStorageKey, type ProcedureDraftField } from "./state";
import type { ProcedureDraftFieldName } from "./shared";
import type { ProcedureDrafts } from "./use-procedure-drafts";
import type { ProcedureSaveQueueStore } from "./use-procedure-save-queue";

export type ProcedureAutosaveHarnessOptions = {
  projectId?: string;
  /** `?autosaveHarness=1`: run every scenario once on install and publish the result. */
  hasAutosaveHarnessParam: boolean;
  autosaveHarnessRanRef: RefObject<boolean>;
  procedureSaveQueuesRef: ProcedureSaveQueueStore["procedureSaveQueuesRef"];
  drafts: Pick<
    ProcedureDrafts,
    | "procedureDraftsRef"
    | "deferredProcedureServerUpdatesRef"
    | "cloneProcedureDrafts"
    | "markProcedureDraftsForSave"
    | "confirmProcedureDraftsFromSave"
    | "storeDeferredProcedureServerUpdate"
    | "mergeServerTaskIntoLocalTask"
    | "isDeferredProcedureUpdateOlderThanLocal"
    | "cleanupCleanProcedureDrafts"
  >;
};

/**
 * Development-only procedure autosave harness. Exposes window.__PULSE_PROCEDURE_AUTOSAVE_HARNESS__.runAll(),
 * which swaps in synthetic draft, queue, and deferred-update state, replays save/refresh races against
 * the real draft functions, and restores everything (including the localStorage draft snapshot).
 * The caller gates on development and a browser; returns the uninstall cleanup.
 */
export function installProcedureAutosaveHarness({
  projectId,
  hasAutosaveHarnessParam,
  autosaveHarnessRanRef,
  procedureSaveQueuesRef,
  drafts,
}: ProcedureAutosaveHarnessOptions): () => void {
  const {
    procedureDraftsRef,
    deferredProcedureServerUpdatesRef,
    cloneProcedureDrafts,
    markProcedureDraftsForSave,
    confirmProcedureDraftsFromSave,
    storeDeferredProcedureServerUpdate,
    mergeServerTaskIntoLocalTask,
    isDeferredProcedureUpdateOlderThanLocal,
    cleanupCleanProcedureDrafts,
  } = drafts;

  type HarnessTestResult = {
    name: string;
    pass: boolean;
    detail: Record<string, unknown>;
  };
  type HarnessWindow = Window & {
    __PULSE_PROCEDURE_AUTOSAVE_HARNESS__?: {
      runAll: () => HarnessTestResult[];
    };
  };

  function harnessStep(id: string, instruction: string, name = "Harness step", version = 1): ManufacturingStep {
    return {
      id,
      sequence: 1,
      name,
      instruction,
      durationMinutes: 1,
      qualityCheck: "",
      version,
    };
  }

  function harnessTask(
    id: string,
    instruction: string,
    name = "Harness step",
    taskVersion = 1,
    stepVersion = 1,
    steps?: ManufacturingStep[],
  ): Task {
    return {
      id,
      scenarioId: "scenario-harness",
      stationId: "station-harness",
      zoneId: "zone-harness",
      rowType: "task",
      wbs: "1",
      name: "Harness task",
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
      manufacturingSteps: steps ?? [harnessStep("step-harness", instruction, name, stepVersion)],
      partReferences: [],
      customFields: {},
      version: taskVersion,
    };
  }

  function harnessDraft(
    taskId: string,
    stepId: string,
    fieldName: ProcedureDraftFieldName,
    value: string,
    seq: number,
    active = true,
    dirty = true,
  ): ProcedureDraftField {
    return {
      taskId,
      stepId,
      fieldName,
      value,
      baseValue: "server-base",
      baseVersion: 1,
      dirty,
      active,
      localEditSeq: seq,
      lastEditedAt: Date.now(),
      saveStatus: dirty ? "dirty" : "saved",
    };
  }

  function withSyntheticProcedureState(run: () => HarnessTestResult[]) {
    const previousDrafts = procedureDraftsRef.current;
    const previousQueues = procedureSaveQueuesRef.current;
    const previousDeferred = deferredProcedureServerUpdatesRef.current;
    const previousStorage = window.localStorage.getItem(procedureDraftStorageKey(projectId));

    try {
      procedureDraftsRef.current = {};
      procedureSaveQueuesRef.current = {};
      deferredProcedureServerUpdatesRef.current = {};
      return run();
    } finally {
      procedureDraftsRef.current = previousDrafts;
      procedureSaveQueuesRef.current = previousQueues;
      deferredProcedureServerUpdatesRef.current = previousDeferred;
      if (previousStorage === null) {
        window.localStorage.removeItem(procedureDraftStorageKey(projectId));
      } else {
        window.localStorage.setItem(procedureDraftStorageKey(projectId), previousStorage);
      }
    }
  }

  function runDelayedSaveResponseSimulation(): HarnessTestResult {
    const taskId = "task-harness-delayed";
    const stepId = "step-harness";
    const key = makeProcedureDraftKey(taskId, stepId, "instruction");
    const valueA = "typed A";
    const valueB = "typed B";

    procedureDraftsRef.current = {
      [key]: harnessDraft(taskId, stepId, "instruction", valueA, 1),
    };
    const snapshotA = cloneProcedureDrafts();
    markProcedureDraftsForSave(taskId, "save-a", snapshotA);

    procedureDraftsRef.current = {
      ...procedureDraftsRef.current,
      [key]: harnessDraft(taskId, stepId, "instruction", valueB, 2),
    };

    const saveAConfirmed = confirmProcedureDraftsFromSave(
      taskId,
      "save-a",
      1,
      snapshotA,
      harnessTask(taskId, valueA, "Harness step", 2, 2),
    );
    const afterA = procedureDraftsRef.current[key];

    const snapshotB = cloneProcedureDrafts();
    markProcedureDraftsForSave(taskId, "save-b", snapshotB);
    const saveBConfirmed = confirmProcedureDraftsFromSave(
      taskId,
      "save-b",
      2,
      snapshotB,
      harnessTask(taskId, valueB, "Harness step", 3, 3),
    );
    const afterB = procedureDraftsRef.current[key];

    const pass =
      !saveAConfirmed &&
      afterA.value === valueB &&
      afterA.dirty &&
      saveBConfirmed &&
      afterB.value === valueB &&
      !afterB.dirty;

    return {
      name: "delayed save response",
      pass,
      detail: {
        saveAConfirmed,
        afterAValue: afterA.value,
        afterADirty: afterA.dirty,
        saveBConfirmed,
        afterBValue: afterB.value,
        afterBDirty: afterB.dirty,
      },
    };
  }

  function runRealtimeDirtyRefreshSimulation(): HarnessTestResult {
    const taskId = "task-harness-realtime";
    const stepId = "step-harness";
    const key = makeProcedureDraftKey(taskId, stepId, "instruction");
    const localValue = "local dirty";
    const oldServerValue = "old server";
    const newServerValue = "new server";
    const localTask = harnessTask(taskId, localValue, "Harness step", 4, 4);
    const oldServerTask = harnessTask(taskId, oldServerValue, "Harness step", 1, 1);
    const newerServerTask = harnessTask(taskId, newServerValue, "Harness step", 3, 3);
    const lowerVersionLaterTask = harnessTask(taskId, "lower version later", "Harness step", 2, 2);

    procedureDraftsRef.current = {
      [key]: harnessDraft(taskId, stepId, "instruction", localValue, 1),
    };

    storeDeferredProcedureServerUpdate({
      serverTask: oldServerTask,
      serverVersion: oldServerTask.version,
      receivedAt: 100,
      source: "refreshTasks",
    });
    const mergedDirty = mergeServerTaskIntoLocalTask(localTask, oldServerTask, procedureDraftsRef.current, {
      source: "refreshTasks",
    });
    storeDeferredProcedureServerUpdate({
      serverTask: newerServerTask,
      serverVersion: newerServerTask.version,
      receivedAt: 200,
      source: "realtime",
    });
    storeDeferredProcedureServerUpdate({
      serverTask: lowerVersionLaterTask,
      serverVersion: lowerVersionLaterTask.version,
      receivedAt: 300,
      source: "realtime",
    });

    const deferred = deferredProcedureServerUpdatesRef.current[taskId];
    const staleDiscarded = isDeferredProcedureUpdateOlderThanLocal(harnessTask(taskId, localValue, "Harness step", 4, 4), deferred);
    procedureDraftsRef.current[key] = {
      ...procedureDraftsRef.current[key],
      dirty: false,
      active: false,
      baseValue: localValue,
      value: localValue,
    };
    const cleanMerge = staleDiscarded
      ? localTask
      : mergeServerTaskIntoLocalTask(localTask, deferred.serverTask, procedureDraftsRef.current, { source: "realtime" });

    const pass =
      mergedDirty.manufacturingSteps?.[0]?.instruction === localValue &&
      deferred.serverTask.manufacturingSteps?.[0]?.instruction === newServerValue &&
      staleDiscarded &&
      cleanMerge.manufacturingSteps?.[0]?.instruction === localValue;

    return {
      name: "realtime/task refresh while dirty",
      pass,
      detail: {
        mergedDirtyInstruction: mergedDirty.manufacturingSteps?.[0]?.instruction,
        deferredVersion: deferred.serverVersion,
        deferredInstruction: deferred.serverTask.manufacturingSteps?.[0]?.instruction,
        staleDiscarded,
        cleanMergeInstruction: cleanMerge.manufacturingSteps?.[0]?.instruction,
      },
    };
  }

  function runFullPlannerRefreshSimulation(): HarnessTestResult {
    const taskId = "task-harness-planner-refresh";
    const stepId = "step-harness";
    const key = makeProcedureDraftKey(taskId, stepId, "name");
    const localValue = "local dirty name";
    const serverValue = "old server name";
    const localTask = harnessTask(taskId, "instruction", localValue, 2, 2);
    const serverTask = harnessTask(taskId, "instruction", serverValue, 1, 1);

    procedureDraftsRef.current = {
      [key]: harnessDraft(taskId, stepId, "name", localValue, 1),
    };

    const mergedTask = mergeServerTaskIntoLocalTask(localTask, serverTask, procedureDraftsRef.current, {
      source: "refreshPlanner",
    });
    const pass = mergedTask.manufacturingSteps?.[0]?.name === localValue;

    return {
      name: "full planner refresh while typing",
      pass,
      detail: {
        mergedName: mergedTask.manufacturingSteps?.[0]?.name,
        serverName: serverValue,
      },
    };
  }

  function runServerDeletedDirtyStepSimulation(): HarnessTestResult {
    const taskId = "task-harness-deleted-step";
    const stepId = "step-harness";
    const key = makeProcedureDraftKey(taskId, stepId, "instruction");
    const localValue = "local dirty deleted step";
    const localTask = harnessTask(taskId, localValue, "Harness step", 2, 2);
    const serverTask = harnessTask(taskId, "unused", "Harness step", 3, 3, []);

    procedureDraftsRef.current = {
      [key]: harnessDraft(taskId, stepId, "instruction", localValue, 1),
    };

    const mergedTask = mergeServerTaskIntoLocalTask(localTask, serverTask, procedureDraftsRef.current, {
      source: "refreshTasks",
    });
    const draft = procedureDraftsRef.current[key];
    const pass =
      mergedTask.manufacturingSteps?.some((step) => step.id === stepId && step.instruction === localValue) === true &&
      draft.saveStatus === "conflict" &&
      draft.value === localValue;

    return {
      name: "server-deleted dirty step conflict",
      pass,
      detail: {
        preservedStepCount: mergedTask.manufacturingSteps?.length ?? 0,
        draftStatus: draft.saveStatus,
        draftValue: draft.value,
      },
    };
  }

  function runCleanTaskServerUpdateSimulation(): HarnessTestResult {
    const taskId = "task-harness-clean";
    const serverValue = "server update accepted";
    const localTask = harnessTask(taskId, "local clean", "Harness step", 1, 1);
    const serverTask = harnessTask(taskId, serverValue, "Harness step", 2, 2);
    procedureDraftsRef.current = {};

    const mergedTask = mergeServerTaskIntoLocalTask(localTask, serverTask, procedureDraftsRef.current, {
      source: "refreshTasks",
    });
    const pass = mergedTask.manufacturingSteps?.[0]?.instruction === serverValue && mergedTask.version === 2;

    return {
      name: "clean task server update",
      pass,
      detail: {
        mergedInstruction: mergedTask.manufacturingSteps?.[0]?.instruction,
        mergedVersion: mergedTask.version,
      },
    };
  }

  function runCleanupConfirmationSimulation(): HarnessTestResult {
    const taskId = "task-harness-cleanup";
    const stepId = "step-harness";
    const key = makeProcedureDraftKey(taskId, stepId, "instruction");
    procedureDraftsRef.current = {
      [key]: {
        ...harnessDraft(taskId, stepId, "instruction", "confirmed", 1, false, false),
        baseValue: "confirmed",
        saveStatus: "saved",
      },
    };
    cleanupCleanProcedureDrafts(taskId);
    const removedWhenConfirmed = !procedureDraftsRef.current[key];

    procedureDraftsRef.current = {
      [key]: {
        ...harnessDraft(taskId, stepId, "instruction", "not-confirmed", 2, false, false),
        baseValue: "different-server-value",
        saveStatus: "saved",
      },
    };
    cleanupCleanProcedureDrafts(taskId);
    const keptWhenNotConfirmed = Boolean(procedureDraftsRef.current[key]);

    return {
      name: "cleanup confirmation guard",
      pass: removedWhenConfirmed && keptWhenNotConfirmed,
      detail: {
        removedWhenConfirmed,
        keptWhenNotConfirmed,
      },
    };
  }

  const harnessWindow = window as HarnessWindow;
  const shouldRunHarness = hasAutosaveHarnessParam && !autosaveHarnessRanRef.current;
  const runAllHarnessTests = () =>
      withSyntheticProcedureState(() => [
        runDelayedSaveResponseSimulation(),
        runRealtimeDirtyRefreshSimulation(),
        runFullPlannerRefreshSimulation(),
        runServerDeletedDirtyStepSimulation(),
        runCleanTaskServerUpdateSimulation(),
        runCleanupConfirmationSimulation(),
        {
          name: "updatedAt watch item",
          pass: true,
          detail: {
            status: "Task has no updatedAt field; deferred freshness relies on version first, then serverUpdatedAt if provided, then receivedAt.",
          },
        },
      ]);
  const handleHarnessRun = () => {
    document.documentElement.dataset.pulseProcedureAutosaveHarnessResult = JSON.stringify(runAllHarnessTests());
  };
  harnessWindow.__PULSE_PROCEDURE_AUTOSAVE_HARNESS__ = {
    runAll: runAllHarnessTests,
  };
  document.documentElement.dataset.pulseProcedureAutosaveHarnessReady = "true";
  if (shouldRunHarness) {
    autosaveHarnessRanRef.current = true;
    handleHarnessRun();
  }

  return () => {
    delete harnessWindow.__PULSE_PROCEDURE_AUTOSAVE_HARNESS__;
    autosaveHarnessRanRef.current = false;
    delete document.documentElement.dataset.pulseProcedureAutosaveHarnessReady;
    delete document.documentElement.dataset.pulseProcedureAutosaveHarnessResult;
  };
}
