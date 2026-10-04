"use client";

import type { RefObject } from "react";
import { acknowledgeAnnotationDrafts } from "@/lib/photo-annotation-drafts";
import { writeCachedPlannerState } from "@/lib/planner-state-cache";
import { getTaskStepPhotoAnnotationMap } from "@/domain/step-photos";
import { saveProcedureTaskUpdateToSupabase, saveTaskPhotoAnnotationsToSupabase } from "@/domain/supabase-planner";
import type { Task } from "@/domain/types";
import { procedureDraftLog, rebaseProcedureTaskVersions, type ProcedureDraftMap } from "./state";
import type { ProcedureDraftFieldName } from "./shared";
import type { ProcedureDrafts } from "./use-procedure-drafts";
import type {
  PlannerCacheScope,
  PlannerStateAccess,
  ReportedSaveStatusSetters,
  WorkspaceFeedback,
} from "./workspace-controller-types";

// Per-task procedure save queues: one granular save in flight per task, newer edits queued behind it,
// debounced scheduling, retry after transient failures, and conflict handling that waits for the user.
// updateProcedureStepField (the procedure field-edit entry point) lives here because it schedules a save.
// The queue records are mutated in place and held across awaits, so the store is created once per
// workspace mount and never recreated per update. There is deliberately no queue reset: scenario
// switches drain saves through the save barrier first, as they did before this module existed.

const PROCEDURE_SAVE_DEBOUNCE_MS = 750;

type ProcedureTaskSaveQueueState =
  | "idle"
  | "dirty-pending"
  | "saving"
  | "saving-with-newer-pending"
  | "retrying"
  | "error"
  | "conflict";

export type ProcedureTaskSaveQueue = {
  state: ProcedureTaskSaveQueueState;
  inFlight: boolean;
  inFlightSaveId?: string;
  inFlightSeq?: number;
  pending: boolean;
  pendingTaskSnapshot?: Task;
  annotationOnly?: boolean;
  annotationBase?: ReturnType<typeof getTaskStepPhotoAnnotationMap>;
  pendingTasksSnapshot?: Task[];
  pendingDraftSnapshot?: ProcedureDraftMap;
  latestSeq: number;
  lastError?: unknown;
};

function generateProcedureSaveId() {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }

  return `procedure-save-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

export type ProcedureSaveQueueStore = ReturnType<typeof createProcedureSaveQueueStore>;

/** Queue records and timers for every task. Methods read the boxes at call time, never a snapshot. */
export function createProcedureSaveQueueStore() {
  const procedureSaveQueuesRef: RefObject<Record<string, ProcedureTaskSaveQueue>> = { current: {} };
  const procedureSaveTimersRef: RefObject<Record<string, number>> = { current: {} };
  const procedureRetryTimersRef: RefObject<Record<string, number>> = { current: {} };

  function getProcedureTaskSaveQueue(taskId: string) {
    const existing = procedureSaveQueuesRef.current[taskId];
    if (existing) {
      return existing;
    }

    const queue: ProcedureTaskSaveQueue = {
      state: "idle",
      inFlight: false,
      pending: false,
      latestSeq: 0,
    };
    procedureSaveQueuesRef.current[taskId] = queue;
    return queue;
  }

  function hasProcedureSaveWork() {
    return (
      Object.keys(procedureSaveTimersRef.current).length > 0 ||
      Object.keys(procedureRetryTimersRef.current).length > 0 ||
      Object.values(procedureSaveQueuesRef.current).some((queue) => queue.inFlight || queue.pending)
    );
  }

  // Whether a specific task has unconfirmed local edits (a debounced/retrying save pending, or a save
  // in flight). Used to decide whether a remote refresh may safely overwrite the task's top-level
  // free-text fields, or whether the user is actively editing and the local value must be kept.
  function hasPendingProcedureSaveWork(taskId: string) {
    const queue = procedureSaveQueuesRef.current[taskId];
    return Boolean(
      procedureSaveTimersRef.current[taskId] ||
        procedureRetryTimersRef.current[taskId] ||
        (queue && (queue.inFlight || queue.pending)),
    );
  }

  function pendingDraftSnapshot(taskId: string) {
    return procedureSaveQueuesRef.current[taskId]?.pendingDraftSnapshot;
  }

  // Activity records for the aggregate save status and the save barrier.
  function procedureSaveActivity() {
    return Object.values(procedureSaveQueuesRef.current);
  }

  // Debounced or retrying work that has not started yet still counts as unsaved.
  function hasScheduledProcedureSaves() {
    return Object.keys(procedureSaveTimersRef.current).length > 0 || Object.keys(procedureRetryTimersRef.current).length > 0;
  }

  return {
    procedureSaveQueuesRef,
    procedureSaveTimersRef,
    procedureRetryTimersRef,
    getProcedureTaskSaveQueue,
    hasProcedureSaveWork,
    hasPendingProcedureSaveWork,
    pendingDraftSnapshot,
    procedureSaveActivity,
    hasScheduledProcedureSaves,
  };
}

export type ProcedureDraftsForQueue = Pick<
  ProcedureDrafts,
  | "procedureDraftsRef"
  | "applyProcedureDraftsToTask"
  | "cloneProcedureDrafts"
  | "maxProcedureDraftSeq"
  | "updateProcedureDraftSnapshotStorage"
  | "cleanupCleanProcedureDrafts"
  | "markProcedureDraftsForTask"
  | "markProcedureDraftsForSave"
  | "mergeServerTaskIntoLocalTask"
  | "applyDeferredProcedureServerUpdate"
  | "setProcedureFieldDraft"
  | "confirmProcedureDraftsFromSave"
>;

export type UseProcedureSaveQueueOptions = PlannerStateAccess &
  PlannerCacheScope &
  ReportedSaveStatusSetters &
  WorkspaceFeedback & {
    store: ProcedureSaveQueueStore;
    drafts: ProcedureDraftsForQueue;
    /** Marks the next planner-state change as a server echo so the shell autosave skips it. */
    remoteRefreshAppliedRef: RefObject<boolean>;
    /** Runs a realtime refresh that was deferred while local saves were pending. */
    flushDeferredRemoteRefresh: () => void;
  };

// Re-declared every render like the component code it came from: async continuations keep the
// projectId and callbacks of the render that started the save.
export function useProcedureSaveQueue({
  store,
  drafts,
  projectId,
  mainScenarioIdRef,
  latestDerivedStateRef,
  setPlannerState,
  setSaveState,
  setSaveError,
  notifyFeedback,
  blockViewOnlyWrite,
  remoteRefreshAppliedRef,
  flushDeferredRemoteRefresh,
}: UseProcedureSaveQueueOptions) {
  const { procedureSaveTimersRef, procedureRetryTimersRef, getProcedureTaskSaveQueue } = store;
  const {
    procedureDraftsRef,
    applyProcedureDraftsToTask,
    cloneProcedureDrafts,
    maxProcedureDraftSeq,
    updateProcedureDraftSnapshotStorage,
    cleanupCleanProcedureDrafts,
    markProcedureDraftsForTask,
    markProcedureDraftsForSave,
    mergeServerTaskIntoLocalTask,
    applyDeferredProcedureServerUpdate,
    setProcedureFieldDraft,
    confirmProcedureDraftsFromSave,
  } = drafts;

  function updateProcedureStepField(
    taskId: string,
    stepId: string,
    fieldName: ProcedureDraftFieldName,
    value: string,
  ) {
    setSaveError(undefined);
    setSaveState((state) => (state === "loading" || state === "saving" ? state : "draft"));
    setProcedureFieldDraft(taskId, stepId, fieldName, value);

    setPlannerState((current) => {
      const patchedTasks = current.tasks.map((task) => {
        if (task.id !== taskId) {
          return task;
        }

        return {
          ...task,
          manufacturingSteps: (task.manufacturingSteps ?? []).map((step) =>
            step.id === stepId ? { ...step, [fieldName]: value } : step,
          ),
        };
      });
      const taskToSave = patchedTasks.find((task) => task.id === taskId);

      if (taskToSave) {
        scheduleProcedureTaskSave(applyProcedureDraftsToTask(taskToSave), patchedTasks);
      }

      return {
        ...current,
        tasks: patchedTasks,
      };
    });
  }

  async function startProcedureTaskSave(taskId: string) {
    const queue = getProcedureTaskSaveQueue(taskId);
    if (queue.inFlight || !queue.pendingTaskSnapshot || !queue.pendingTasksSnapshot) {
      return;
    }

    // A save completion may immediately drain newer edits before their debounce
    // timer fires. The current queue is being consumed now; that old timer must
    // not replay its stale snapshot or keep the status pending afterward.
    if (procedureSaveTimersRef.current[taskId]) {
      window.clearTimeout(procedureSaveTimersRef.current[taskId]);
      delete procedureSaveTimersRef.current[taskId];
    }

    if (blockViewOnlyWrite()) {
      queue.pending = false;
      queue.pendingTaskSnapshot = undefined;
      queue.pendingTasksSnapshot = undefined;
      queue.pendingDraftSnapshot = undefined;
      setSaveState("idle");
      return;
    }

    const saveId = generateProcedureSaveId();
    const draftSnapshot = queue.pendingDraftSnapshot ?? cloneProcedureDrafts();
    const saveSeq = maxProcedureDraftSeq(taskId, draftSnapshot);
    const taskSnapshot = applyProcedureDraftsToTask(queue.pendingTaskSnapshot, draftSnapshot);
    const tasksSnapshot = queue.pendingTasksSnapshot.map((task) => (task.id === taskId ? taskSnapshot : task));

    const annotationOnly = queue.annotationOnly;
    const annotationBase = queue.annotationBase;
    queue.annotationOnly = undefined;
    queue.annotationBase = undefined;
    queue.inFlight = true;
    queue.pending = false;
    queue.inFlightSaveId = saveId;
    queue.inFlightSeq = saveSeq;
    queue.state = "saving";
    queue.pendingTaskSnapshot = undefined;
    queue.pendingTasksSnapshot = undefined;
    queue.pendingDraftSnapshot = undefined;
    setSaveError(undefined);
    setSaveState("saving");
    markProcedureDraftsForSave(taskId, saveId, draftSnapshot);
    procedureDraftLog("save started", { taskId, saveId, saveSeq });

    let savedTask: Task | null = null;

    try {
      savedTask = annotationOnly
        ? await saveTaskPhotoAnnotationsToSupabase(taskSnapshot, annotationBase ?? {}, projectId)
        : await saveProcedureTaskUpdateToSupabase(taskSnapshot, tasksSnapshot, projectId);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unable to save procedure task.";
      const isConflict = message.toLowerCase().includes("conflict");
      queue.inFlight = false;
      if (!queue.pending) {
        queue.pending = true;
        queue.pendingTaskSnapshot = taskSnapshot;
        queue.pendingTasksSnapshot = tasksSnapshot;
        queue.pendingDraftSnapshot = draftSnapshot;
        queue.annotationOnly = annotationOnly;
        queue.annotationBase = annotationBase;
      }
      queue.state = isConflict ? "conflict" : "retrying";
      queue.lastError = error;
      markProcedureDraftsForTask(taskId, {
        saveStatus: isConflict ? "conflict" : "retrying",
        error: message,
      });
      updateProcedureDraftSnapshotStorage();
      setSaveError(message);
      setSaveState(isConflict ? "error" : "retrying");
      notifyFeedback({
        title: isConflict ? "Save conflict" : "Save failed - retrying",
        body: message,
        tone: isConflict ? "danger" : "warning",
      });
      flushDeferredRemoteRefresh();

      if (!isConflict && !procedureRetryTimersRef.current[taskId]) {
        procedureRetryTimersRef.current[taskId] = window.setTimeout(() => {
          delete procedureRetryTimersRef.current[taskId];
          const latestTask = latestDerivedStateRef.current.tasks.find((task) => task.id === taskId);
          if (!latestTask) {
            return;
          }

          const latestTaskSnapshot = applyProcedureDraftsToTask(latestTask);
          const latestTasksSnapshot = latestDerivedStateRef.current.tasks.map((task) =>
            task.id === taskId ? latestTaskSnapshot : task,
          );
          scheduleProcedureTaskSave(latestTaskSnapshot, latestTasksSnapshot, annotationOnly ? annotationBase : undefined);
        }, 2500);
      }
      return;
    }

    queue.inFlight = false;
    queue.inFlightSaveId = undefined;
    queue.inFlightSeq = undefined;

    let confirmedCurrent = true;
    if (savedTask) {
      acknowledgeAnnotationDrafts(taskId, getTaskStepPhotoAnnotationMap(savedTask));
      confirmedCurrent = confirmProcedureDraftsFromSave(taskId, saveId, saveSeq, draftSnapshot, savedTask);
      remoteRefreshAppliedRef.current = true;
      setPlannerState((current) => {
        const nextState = {
          ...current,
          tasks: current.tasks.map((task) =>
            task.id === savedTask?.id
              ? mergeServerTaskIntoLocalTask(task, savedTask, procedureDraftsRef.current, { source: "saveCompletion" })
              : task,
          ),
        };
        void writeCachedPlannerState(projectId, nextState, mainScenarioIdRef.current).catch(() => undefined);
        return nextState;
      });

      if (confirmedCurrent) {
        cleanupCleanProcedureDrafts(taskId);
      }
    }

    const hasNewerPending = !confirmedCurrent || queue.pending || maxProcedureDraftSeq(taskId) > saveSeq;
    if (hasNewerPending) {
      // Read again after awaiting the save: edits may have filled the queue in flight.
      const pendingQueue = getProcedureTaskSaveQueue(taskId);
      if (pendingQueue.pending && pendingQueue.pendingTaskSnapshot && pendingQueue.pendingTasksSnapshot) {
        if (savedTask) {
          const rebasedTask = rebaseProcedureTaskVersions(pendingQueue.pendingTaskSnapshot, savedTask);
          pendingQueue.pendingTaskSnapshot = rebasedTask;
          pendingQueue.pendingTasksSnapshot = pendingQueue.pendingTasksSnapshot.map((task) =>
            task.id === taskId ? rebasedTask : task,
          );
        }
        queue.state = "saving-with-newer-pending";
        void startProcedureTaskSave(taskId);
        return;
      }

      const latestTask = latestDerivedStateRef.current.tasks.find((task) => task.id === taskId);
      if (latestTask) {
        const latestTaskSnapshot = applyProcedureDraftsToTask(
          savedTask ? rebaseProcedureTaskVersions(latestTask, savedTask) : latestTask,
        );
        const latestTasksSnapshot = latestDerivedStateRef.current.tasks.map((task) =>
          task.id === taskId ? latestTaskSnapshot : task,
        );
        queue.pending = true;
        queue.pendingTaskSnapshot = latestTaskSnapshot;
        queue.pendingTasksSnapshot = latestTasksSnapshot;
        queue.pendingDraftSnapshot = cloneProcedureDrafts();
        queue.latestSeq = maxProcedureDraftSeq(taskId);
        queue.state = "saving-with-newer-pending";
        void startProcedureTaskSave(taskId);
        return;
      }
    }

    queue.state = "idle";
    queue.lastError = undefined;
    setSaveState("saved");
    applyDeferredProcedureServerUpdate(taskId);
    flushDeferredRemoteRefresh();
  }

  async function persistProcedureTaskUpdate(taskToSave: Task, tasksToSave: Task[]) {
    const taskId = taskToSave.id;
    const queue = getProcedureTaskSaveQueue(taskId);
    queue.pending = true;
    queue.pendingTaskSnapshot = applyProcedureDraftsToTask(taskToSave);
    queue.pendingTasksSnapshot = tasksToSave.map((task) => (task.id === taskId ? queue.pendingTaskSnapshot ?? task : task));
    queue.pendingDraftSnapshot = cloneProcedureDrafts();
    queue.latestSeq = maxProcedureDraftSeq(taskId);
    queue.state = queue.inFlight ? "saving-with-newer-pending" : "dirty-pending";
    procedureDraftLog("save scheduled", { taskId, saveSeq: queue.latestSeq });
    await startProcedureTaskSave(taskId);
  }

  function scheduleProcedureTaskSave(taskToSave: Task, tasksToSave: Task[], annotationBase?: ReturnType<typeof getTaskStepPhotoAnnotationMap>) {
    const taskId = taskToSave.id;
    const queue = getProcedureTaskSaveQueue(taskId);
    const taskSnapshot = applyProcedureDraftsToTask(taskToSave);
    const onlyAnnotations = annotationBase !== undefined;
    queue.annotationOnly = queue.pending ? Boolean(queue.annotationOnly && onlyAnnotations) : onlyAnnotations;
    if (onlyAnnotations) queue.annotationBase = queue.annotationBase ?? annotationBase;

    queue.pending = true;
    queue.pendingTaskSnapshot = taskSnapshot;
    queue.pendingTasksSnapshot = tasksToSave.map((task) => (task.id === taskId ? taskSnapshot : task));
    queue.pendingDraftSnapshot = cloneProcedureDrafts();
    queue.latestSeq = maxProcedureDraftSeq(taskId);
    queue.state = queue.inFlight ? "saving-with-newer-pending" : "dirty-pending";
    updateProcedureDraftSnapshotStorage();
    procedureDraftLog("save scheduled", { taskId, saveSeq: queue.latestSeq });
    setSaveState((state) => state === "loading" || state === "saving" ? state : "draft");

    if (procedureSaveTimersRef.current[taskId]) {
      window.clearTimeout(procedureSaveTimersRef.current[taskId]);
    }

    if (procedureRetryTimersRef.current[taskId]) {
      window.clearTimeout(procedureRetryTimersRef.current[taskId]);
      delete procedureRetryTimersRef.current[taskId];
    }

    procedureSaveTimersRef.current[taskId] = window.setTimeout(() => {
      delete procedureSaveTimersRef.current[taskId];
      void persistProcedureTaskUpdate(taskSnapshot, queue.pendingTasksSnapshot ?? tasksToSave);
    }, PROCEDURE_SAVE_DEBOUNCE_MS);
  }

  // Scope exit (scenario/product change or unmount): FLUSH -- don't drop -- debounced saves for the
  // scope being left; clearing the timers alone would silently discard the user's last keystrokes. Best
  // effort: the queue snapshots were prepared when the save was scheduled, and startProcedureTaskSave
  // no-ops if they are gone. Pending retries are cancelled.
  function flushScheduledProcedureSaves() {
    Object.entries(procedureSaveTimersRef.current).forEach(([taskId, timerId]) => {
      window.clearTimeout(timerId);
      void startProcedureTaskSave(taskId);
    });
    procedureSaveTimersRef.current = {};
    Object.values(procedureRetryTimersRef.current).forEach((timerId) => window.clearTimeout(timerId));
    procedureRetryTimersRef.current = {};
  }

  return {
    scheduleProcedureTaskSave,
    updateProcedureStepField,
    flushScheduledProcedureSaves,
  };
}
