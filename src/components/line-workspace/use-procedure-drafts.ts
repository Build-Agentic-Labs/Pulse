"use client";

import { useRef, useState } from "react";
import { writeCachedPlannerState } from "@/lib/planner-state-cache";
import type { ManufacturingStep, Task } from "@/domain/types";
import {
  getProcedureStepFieldValue,
  makeProcedureDraftKey,
  procedureDraftLog,
  writeProcedureFieldDraftSnapshot,
  type ProcedureDraftField,
  type ProcedureDraftMap,
} from "./state";
import type { ProcedureDraftFieldName } from "./shared";
import type { PlannerCacheScope, PlannerStateAccess } from "./workspace-controller-types";

// Per-field procedure drafts: the local edit layer that survives server echoes, realtime refreshes,
// reloads (via the localStorage snapshot), and conflicting writes. This owner merges server tasks into
// local tasks, defers server updates while a field is dirty or focused, and acknowledges a draft only
// when a save confirms that exact edit. The save queue (including the field-edit entry point) drives
// saves; drafts only read queue state through the probe.

// Top-level free-text task fields a user types into directly (task name, Task Description, Safety
// Notes, QC checklist, general notes, and the reference-link/material inputs). Unlike
// manufacturing-step fields these are NOT tracked by the per-step procedure-draft system, so a stale
// server echo from our own in-flight save — or a remote refresh that lands between keystrokes —
// would otherwise overwrite characters the user just typed. mergeServerTaskIntoLocalTask preserves
// the local value for these when it can only be unsaved local typing. customFields (custom Gantt
// column cells) get the same treatment via a dedicated object-aware guard in
// preserveLocalEditedTaskText, since this list is string-only. sopId is select-driven rather than
// typed, but shares the same echo race: a procedure save whose snapshot predates the SOP pick
// echoes the old sop id back on completion, so it needs the same local-wins protection.
const LOCAL_EDITED_TASK_TEXT_FIELDS = [
  "name",
  "description",
  "safetyNotes",
  "notes",
  "qcChecklist",
  "sopLink",
  "sopId",
  "workInstructionLink",
  "drawingLink",
  "materialKit",
] as const satisfies ReadonlyArray<keyof Task>;

export type DeferredProcedureServerUpdate = {
  serverTask: Task;
  serverVersion?: number;
  serverUpdatedAt?: string;
  receivedAt: number;
  source: "realtime" | "refreshTasks" | "refreshPlanner" | "saveCompletion";
};

/**
 * Read-only view of the procedure save queue. Called at merge/cleanup time so the answer is always
 * current: a captured boolean would go stale across the async gaps between edits and saves.
 */
export type ProcedureQueueProbe = {
  /** True while this task has a debounced, retrying, or in-flight save. */
  hasPendingProcedureSaveWork: (taskId: string) => boolean;
  /** The draft snapshot held by this task's queued (not yet started) save, if any. */
  pendingDraftSnapshot: (taskId: string) => ProcedureDraftMap | undefined;
};

export type UseProcedureDraftsOptions = PlannerStateAccess & PlannerCacheScope & {
  queueProbe: ProcedureQueueProbe;
};

export function useProcedureDrafts({
  projectId,
  mainScenarioIdRef,
  latestDerivedStateRef,
  setPlannerState,
  queueProbe,
}: UseProcedureDraftsOptions) {
  const procedureDraftsRef = useRef<ProcedureDraftMap>({});
  const procedureEditSeqRef = useRef(0);
  const deferredProcedureServerUpdatesRef = useRef<Record<string, DeferredProcedureServerUpdate>>({});
  const [, setProcedureDraftVersion] = useState(0);

  function bumpProcedureDraftVersion() {
    setProcedureDraftVersion((version) => version + 1);
  }

  function cloneProcedureDrafts(drafts: ProcedureDraftMap = procedureDraftsRef.current): ProcedureDraftMap {
    return Object.fromEntries(Object.entries(drafts).map(([key, draft]) => [key, { ...draft }]));
  }

  function getProcedureFieldDraft(taskId: string, stepId: string, fieldName: ProcedureDraftFieldName) {
    return procedureDraftsRef.current[makeProcedureDraftKey(taskId, stepId, fieldName)];
  }

  function getProcedureFieldValue(
    taskId: string,
    stepId: string,
    fieldName: ProcedureDraftFieldName,
    fallbackValue: string,
  ) {
    const draft = getProcedureFieldDraft(taskId, stepId, fieldName);
    return draft?.active || draft?.dirty ? draft.value : fallbackValue;
  }

  function getProcedureDraftsForTask(taskId: string, drafts: ProcedureDraftMap = procedureDraftsRef.current) {
    return Object.values(drafts).filter((draft) => draft.taskId === taskId);
  }

  function hasDirtyProcedureDrafts(taskId: string, drafts: ProcedureDraftMap = procedureDraftsRef.current) {
    return getProcedureDraftsForTask(taskId, drafts).some((draft) => draft.dirty);
  }

  function hasDirtyOrActiveProcedureDrafts(taskId: string, drafts: ProcedureDraftMap = procedureDraftsRef.current) {
    return getProcedureDraftsForTask(taskId, drafts).some((draft) => draft.dirty || draft.active);
  }

  function maxProcedureDraftSeq(taskId: string, drafts: ProcedureDraftMap = procedureDraftsRef.current) {
    return getProcedureDraftsForTask(taskId, drafts).reduce(
      (maxSeq, draft) => Math.max(maxSeq, draft.localEditSeq),
      0,
    );
  }

  // Rebase any in-progress local edits to the top-level free-text fields back onto a freshly merged
  // server task, so an autosave echo or remote refresh can't wipe text the user just typed.
  //
  // A save completion echoes back exactly what we sent, so any field where the local value now differs
  // is necessarily a keystroke made after that save started — local always wins. For remote refreshes
  // we only keep the local value while a save for this task is still pending/in flight (the user is
  // actively editing); otherwise the server value is authoritative.
  function preserveLocalEditedTaskText(localTask: Task, mergedTask: Task, sourceMeta?: { source?: string }): Task {
    const isSaveCompletion = sourceMeta?.source === "saveCompletion";
    const hasNewerLocalSave = queueProbe.hasPendingProcedureSaveWork(localTask.id);
    if (!isSaveCompletion && !hasNewerLocalSave) {
      return mergedTask;
    }

    const preserved: Partial<Record<keyof Task, unknown>> = {};
    for (const field of LOCAL_EDITED_TASK_TEXT_FIELDS) {
      const localValue = localTask[field];
      if (localValue !== undefined && localValue !== mergedTask[field]) {
        preserved[field] = localValue;
      }
    }

    // customFields hold user-typed custom Gantt column values — same echo/refresh race as the text
    // fields, but it is an object, so compare structurally (the map is rebuilt immutably on every
    // keystroke, making reference equality useless). Local wins under the same conditions as above.
    if (
      localTask.customFields !== undefined &&
      localTask.customFields !== mergedTask.customFields &&
      JSON.stringify(localTask.customFields) !== JSON.stringify(mergedTask.customFields)
    ) {
      preserved.customFields = localTask.customFields;
    }

    // A part can be attached while an older procedure save is still in flight. Keep the newer
    // allocation visible until its queued save completes; otherwise the older server echo briefly
    // removes the part and can make a successful Add look like it failed. Rebase step versions from
    // the response so the queued save can still use the freshest optimistic-lock values.
    if (
      hasNewerLocalSave &&
      JSON.stringify(localTask.manufacturingSteps ?? []) !== JSON.stringify(mergedTask.manufacturingSteps ?? [])
    ) {
      const mergedStepById = new Map((mergedTask.manufacturingSteps ?? []).map((step) => [step.id, step]));
      preserved.manufacturingSteps = (localTask.manufacturingSteps ?? []).map((step) => ({
        ...step,
        version: mergedStepById.get(step.id)?.version ?? step.version,
      }));
    }

    if (
      hasNewerLocalSave &&
      JSON.stringify(localTask.partReferences ?? []) !== JSON.stringify(mergedTask.partReferences ?? [])
    ) {
      preserved.partReferences = localTask.partReferences;
    }

    if (Object.keys(preserved).length === 0) {
      return mergedTask;
    }

    procedureDraftLog("merge preserving local task text", {
      taskId: localTask.id,
      source: sourceMeta?.source,
    });
    return { ...mergedTask, ...preserved } as Task;
  }

  function applyProcedureDraftsToTask(task: Task, drafts: ProcedureDraftMap = procedureDraftsRef.current) {
    const taskDrafts = getProcedureDraftsForTask(task.id, drafts).filter((draft) => draft.dirty || draft.active);
    if (taskDrafts.length === 0) {
      return task;
    }

    const draftByStepId = new Map<string, ProcedureDraftField[]>();
    taskDrafts.forEach((draft) => {
      const stepDrafts = draftByStepId.get(draft.stepId) ?? [];
      stepDrafts.push(draft);
      draftByStepId.set(draft.stepId, stepDrafts);
    });

    return {
      ...task,
      manufacturingSteps: (task.manufacturingSteps ?? []).map((step) => {
        const stepDrafts = draftByStepId.get(step.id);
        if (!stepDrafts?.length) {
          return step;
        }

        return stepDrafts.reduce<ManufacturingStep>(
          (nextStep, draft) => ({
            ...nextStep,
            [draft.fieldName]: draft.value,
          }),
          step,
        );
      }),
    };
  }

  function updateProcedureDraftSnapshotStorage() {
    writeProcedureFieldDraftSnapshot(projectId, procedureDraftsRef.current);
  }

  function cleanupCleanProcedureDrafts(taskId?: string) {
    const nextDrafts = { ...procedureDraftsRef.current };
    let changed = false;

    Object.entries(nextDrafts).forEach(([key, draft]) => {
      if (taskId && draft.taskId !== taskId) {
        return;
      }

      const pendingDraftSnapshot = queueProbe.pendingDraftSnapshot(draft.taskId);
      const pendingReferencesDraft =
        pendingDraftSnapshot?.[key]?.localEditSeq === draft.localEditSeq ||
        pendingDraftSnapshot?.[key]?.value === draft.value;

      if (!draft.dirty && !draft.active && !pendingReferencesDraft && draft.baseValue === draft.value) {
        delete nextDrafts[key];
        changed = true;
      }
    });

    if (!changed) {
      return;
    }

    procedureDraftsRef.current = nextDrafts;
    updateProcedureDraftSnapshotStorage();
    bumpProcedureDraftVersion();
  }

  function markProcedureDraftsForTask(
    taskId: string,
    patch: Partial<Pick<ProcedureDraftField, "saveStatus" | "latestSaveId" | "savingSeq" | "error">>,
    onlyDirty = true,
  ) {
    const nextDrafts = { ...procedureDraftsRef.current };
    let changed = false;

    Object.entries(nextDrafts).forEach(([key, draft]) => {
      if (draft.taskId !== taskId || (onlyDirty && !draft.dirty)) {
        return;
      }

      nextDrafts[key] = { ...draft, ...patch };
      changed = true;
    });

    if (changed) {
      procedureDraftsRef.current = nextDrafts;
      updateProcedureDraftSnapshotStorage();
      bumpProcedureDraftVersion();
    }
  }

  function markProcedureDraftsForSave(taskId: string, saveId: string, draftSnapshot: ProcedureDraftMap) {
    const nextDrafts = { ...procedureDraftsRef.current };
    let changed = false;

    Object.entries(draftSnapshot).forEach(([key, sentDraft]) => {
      if (sentDraft.taskId !== taskId || !sentDraft.dirty || !nextDrafts[key]) {
        return;
      }

      nextDrafts[key] = {
        ...nextDrafts[key],
        latestSaveId: saveId,
        savingSeq: sentDraft.localEditSeq,
        saveStatus: "saving",
        error: undefined,
      };
      changed = true;
    });

    if (changed) {
      procedureDraftsRef.current = nextDrafts;
      updateProcedureDraftSnapshotStorage();
      bumpProcedureDraftVersion();
    }
  }

  function markProcedureStepDraftsConflict(taskId: string, stepId: string, error: string) {
    const nextDrafts = { ...procedureDraftsRef.current };
    let changed = false;

    Object.entries(nextDrafts).forEach(([key, draft]) => {
      if (draft.taskId !== taskId || draft.stepId !== stepId || (!draft.dirty && !draft.active)) {
        return;
      }

      nextDrafts[key] = { ...draft, saveStatus: "conflict", error };
      changed = true;
      procedureDraftLog("conflict detected", { ...draft, error });
    });

    if (changed) {
      procedureDraftsRef.current = nextDrafts;
      updateProcedureDraftSnapshotStorage();
      bumpProcedureDraftVersion();
    }
  }

  function mergeServerTaskIntoLocalTask(
    localTask: Task,
    serverTask: Task,
    procedureDrafts: ProcedureDraftMap = procedureDraftsRef.current,
    sourceMeta?: { source?: string },
  ) {
    const protectedDrafts = getProcedureDraftsForTask(localTask.id, procedureDrafts).filter(
      (draft) => draft.dirty || draft.active,
    );

    if (protectedDrafts.length === 0) {
      procedureDraftLog("server update merged", {
        taskId: serverTask.id,
        serverVersion: serverTask.version,
        source: sourceMeta?.source,
      });
      return preserveLocalEditedTaskText(localTask, serverTask, sourceMeta);
    }

    const serverStepById = new Map((serverTask.manufacturingSteps ?? []).map((step) => [step.id, step]));
    const serverStepIds = new Set(serverStepById.keys());
    const protectedDraftsByStepId = new Map<string, ProcedureDraftField[]>();
    protectedDrafts.forEach((draft) => {
      const stepDrafts = protectedDraftsByStepId.get(draft.stepId) ?? [];
      stepDrafts.push(draft);
      protectedDraftsByStepId.set(draft.stepId, stepDrafts);
    });

    const localSteps = localTask.manufacturingSteps ?? [];
    const mergedLocalSteps = localSteps.map((localStep) => {
      const serverStep = serverStepById.get(localStep.id);
      const stepDrafts = protectedDraftsByStepId.get(localStep.id) ?? [];

      if (!serverStep && stepDrafts.length > 0) {
        markProcedureStepDraftsConflict(localTask.id, localStep.id, "Server deleted this step while it had local edits.");
        return localStep;
      }

      const mergedStep = serverStep
        ? {
            ...localStep,
            ...serverStep,
            sequence: localStep.sequence,
          }
        : localStep;

      if (stepDrafts.length === 0) {
        return mergedStep;
      }

      return stepDrafts.reduce<ManufacturingStep>(
        (nextStep, draft) => ({
          ...nextStep,
          [draft.fieldName]: draft.value,
        }),
        mergedStep,
      );
    });

    const localStepIds = new Set(localSteps.map((step) => step.id));
    const insertedServerSteps = (serverTask.manufacturingSteps ?? []).filter((step) => !localStepIds.has(step.id));
    const mergedTask = {
      ...localTask,
      ...serverTask,
      manufacturingSteps: [...mergedLocalSteps, ...insertedServerSteps],
    };

    protectedDrafts.forEach((draft) => {
      if (!serverStepIds.has(draft.stepId)) {
        return;
      }

      procedureDraftLog("merge preserving local field", {
        ...draft,
        serverVersion: serverTask.version,
        source: sourceMeta?.source,
      });
    });

    return preserveLocalEditedTaskText(localTask, mergedTask, sourceMeta);
  }

  function isDeferredProcedureUpdateOlderThanLocal(localTask: Task, update: DeferredProcedureServerUpdate) {
    return (
      typeof update.serverVersion === "number" &&
      typeof localTask.version === "number" &&
      update.serverVersion < localTask.version
    );
  }

  function storeDeferredProcedureServerUpdate(update: DeferredProcedureServerUpdate) {
    const existing = deferredProcedureServerUpdatesRef.current[update.serverTask.id];
    let shouldReplace = !existing;

    if (existing) {
      if (typeof update.serverVersion === "number" && typeof existing.serverVersion === "number") {
        shouldReplace = update.serverVersion >= existing.serverVersion;
      } else if (update.serverUpdatedAt && existing.serverUpdatedAt) {
        shouldReplace = update.serverUpdatedAt >= existing.serverUpdatedAt;
      } else {
        shouldReplace = update.receivedAt >= existing.receivedAt;
      }
    }

    if (!shouldReplace) {
      procedureDraftLog("deferred update discarded", {
        taskId: update.serverTask.id,
        serverVersion: update.serverVersion,
        serverUpdatedAt: update.serverUpdatedAt,
        source: update.source,
      });
      return;
    }

    deferredProcedureServerUpdatesRef.current[update.serverTask.id] = update;
    procedureDraftLog("server update deferred", {
      taskId: update.serverTask.id,
      serverVersion: update.serverVersion,
      serverUpdatedAt: update.serverUpdatedAt,
      source: update.source,
    });
  }

  function applyDeferredProcedureServerUpdate(taskId: string) {
    const deferredUpdate = deferredProcedureServerUpdatesRef.current[taskId];
    if (!deferredUpdate || hasDirtyOrActiveProcedureDrafts(taskId)) {
      return;
    }

    delete deferredProcedureServerUpdatesRef.current[taskId];
    setPlannerState((current) => {
      const localTask = current.tasks.find((task) => task.id === taskId);
      if (!localTask) {
        return current;
      }

      if (isDeferredProcedureUpdateOlderThanLocal(localTask, deferredUpdate)) {
        procedureDraftLog("deferred update discarded", {
          taskId,
          serverVersion: deferredUpdate.serverVersion,
          serverUpdatedAt: deferredUpdate.serverUpdatedAt,
          source: deferredUpdate.source,
        });
        return current;
      }

      const nextState = {
        ...current,
        tasks: current.tasks.map((task) =>
          task.id === taskId
            ? mergeServerTaskIntoLocalTask(task, deferredUpdate.serverTask, procedureDraftsRef.current, {
                source: deferredUpdate.source,
              })
            : task,
        ),
      };
      void writeCachedPlannerState(projectId, nextState, mainScenarioIdRef.current).catch(() => undefined);
      return nextState;
    });
  }

  function markProcedureFieldActive(taskId: string, stepId: string, fieldName: ProcedureDraftFieldName, fallbackValue: string) {
    const key = makeProcedureDraftKey(taskId, stepId, fieldName);
    const existing = procedureDraftsRef.current[key];
    const now = Date.now();
    procedureDraftsRef.current = {
      ...procedureDraftsRef.current,
      [key]: existing
        ? { ...existing, active: true }
        : {
            taskId,
            stepId,
            fieldName,
            value: fallbackValue,
            baseValue: fallbackValue,
            dirty: false,
            active: true,
            localEditSeq: ++procedureEditSeqRef.current,
            lastEditedAt: now,
            saveStatus: "idle",
          },
    };
    procedureDraftLog("draft focused", procedureDraftsRef.current[key]);
    bumpProcedureDraftVersion();
  }

  function markProcedureFieldInactive(taskId: string, stepId: string, fieldName: ProcedureDraftFieldName) {
    const key = makeProcedureDraftKey(taskId, stepId, fieldName);
    const existing = procedureDraftsRef.current[key];
    if (!existing) {
      return;
    }

    procedureDraftsRef.current = {
      ...procedureDraftsRef.current,
      [key]: { ...existing, active: false },
    };
    procedureDraftLog("draft blurred", procedureDraftsRef.current[key]);
    cleanupCleanProcedureDrafts(taskId);
    bumpProcedureDraftVersion();
    applyDeferredProcedureServerUpdate(taskId);
  }

  function setProcedureFieldDraft(taskId: string, stepId: string, fieldName: ProcedureDraftFieldName, value: string) {
    const key = makeProcedureDraftKey(taskId, stepId, fieldName);
    const currentTask = latestDerivedStateRef.current.tasks.find((task) => task.id === taskId);
    const currentStep = currentTask?.manufacturingSteps?.find((step) => step.id === stepId);
    const fallbackValue = getProcedureStepFieldValue(currentStep, fieldName);
    const existing = procedureDraftsRef.current[key];
    const now = Date.now();
    const draft: ProcedureDraftField = {
      taskId,
      stepId,
      fieldName,
      value,
      baseValue: existing?.baseValue ?? fallbackValue,
      baseVersion: existing?.baseVersion ?? currentStep?.version,
      dirty: true,
      active: true,
      localEditSeq: ++procedureEditSeqRef.current,
      lastEditedAt: now,
      saveStatus: "dirty",
    };

    procedureDraftsRef.current = {
      ...procedureDraftsRef.current,
      [key]: draft,
    };
    procedureDraftLog(existing ? "draft edited" : "draft created", draft);
    updateProcedureDraftSnapshotStorage();
    bumpProcedureDraftVersion();
    return draft;
  }

  function confirmProcedureDraftsFromSave(
    taskId: string,
    saveId: string,
    saveSeq: number,
    draftSnapshot: ProcedureDraftMap,
    savedTask: Task,
  ) {
    const nextDrafts = { ...procedureDraftsRef.current };
    let changed = false;
    let staleResponse = false;

    Object.entries(draftSnapshot).forEach(([key, sentDraft]) => {
      if (sentDraft.taskId !== taskId || !sentDraft.dirty) {
        return;
      }

      const currentDraft = nextDrafts[key];
      if (!currentDraft) {
        return;
      }

      const serverStep = savedTask.manufacturingSteps?.find((step) => step.id === sentDraft.stepId);
      const serverValue = getProcedureStepFieldValue(serverStep, sentDraft.fieldName);
      const fieldSaveSeq = sentDraft.localEditSeq;
      const confirmsExactCurrentDraft =
        currentDraft.taskId === sentDraft.taskId &&
        currentDraft.stepId === sentDraft.stepId &&
        currentDraft.fieldName === sentDraft.fieldName &&
        currentDraft.localEditSeq === fieldSaveSeq &&
        currentDraft.value === sentDraft.value &&
        serverValue === currentDraft.value &&
        currentDraft.latestSaveId === saveId &&
        currentDraft.savingSeq === fieldSaveSeq;

      if (!confirmsExactCurrentDraft) {
        staleResponse = true;
        nextDrafts[key] = {
          ...currentDraft,
          dirty: true,
          saveStatus: currentDraft.saveStatus === "saving" ? "dirty" : currentDraft.saveStatus,
        };
        changed = true;
        procedureDraftLog("save returned stale", {
          ...currentDraft,
          saveId,
          saveSeq,
          serverVersion: savedTask.version,
        });
        return;
      }

      nextDrafts[key] = {
        ...currentDraft,
        baseValue: serverValue,
        baseVersion: serverStep?.version,
        dirty: false,
        saveStatus: "saved",
        latestSaveId: undefined,
        savingSeq: undefined,
        error: undefined,
      };
      changed = true;
      procedureDraftLog("field marked clean", {
        ...nextDrafts[key],
        saveId,
        saveSeq,
        serverVersion: savedTask.version,
      });
    });

    if (changed) {
      procedureDraftsRef.current = nextDrafts;
      updateProcedureDraftSnapshotStorage();
      bumpProcedureDraftVersion();
    }

    return !staleResponse;
  }

  // Load-time recovery of the localStorage v2 snapshot. Recovered fields are inactive (nothing is focused
  // after a reload) and keep their dirty flag, so they are re-saved; the edit sequence moves past them so
  // new typing always outranks recovered drafts.
  function restoreProcedureDraftFields(fields: ProcedureDraftField[]): ProcedureDraftMap {
    const recoveredDrafts = { ...procedureDraftsRef.current };
    fields.forEach((field) => {
      const key = makeProcedureDraftKey(field.taskId, field.stepId, field.fieldName);
      recoveredDrafts[key] = {
        ...field,
        active: false,
        dirty: field.dirty !== false,
        saveStatus: field.dirty === false ? "saved" : "dirty",
      };
      procedureEditSeqRef.current = Math.max(procedureEditSeqRef.current, recoveredDrafts[key].localEditSeq);
      procedureDraftLog("recovery restored a draft", recoveredDrafts[key]);
    });
    procedureDraftsRef.current = recoveredDrafts;
    return recoveredDrafts;
  }

  // A successful scenario switch drops the settled drafts of the scenario being left. A task id belongs
  // to exactly one scenario (tasks.id is the table's primary key; duplicated scenarios get new ids), so a
  // kept draft can never apply to another scenario's task. Dirty (unacknowledged) drafts are never
  // dropped here: they stay in memory, and therefore in their project's draft storage, until a save
  // confirms them. Other scopes' drafts are untouched.
  function resetProcedureDrafts(leavingTaskIds: Iterable<string>) {
    const leaving = new Set(leavingTaskIds);
    procedureDraftsRef.current = Object.fromEntries(
      Object.entries(procedureDraftsRef.current).filter(([, draft]) => draft.dirty || !leaving.has(draft.taskId)),
    );
    setProcedureDraftVersion((version) => version + 1);
  }

  return {
    procedureDraftsRef,
    deferredProcedureServerUpdatesRef,
    cloneProcedureDrafts,
    getProcedureFieldValue,
    hasDirtyProcedureDrafts,
    hasDirtyOrActiveProcedureDrafts,
    maxProcedureDraftSeq,
    applyProcedureDraftsToTask,
    updateProcedureDraftSnapshotStorage,
    cleanupCleanProcedureDrafts,
    markProcedureDraftsForTask,
    markProcedureDraftsForSave,
    mergeServerTaskIntoLocalTask,
    isDeferredProcedureUpdateOlderThanLocal,
    storeDeferredProcedureServerUpdate,
    applyDeferredProcedureServerUpdate,
    markProcedureFieldActive,
    markProcedureFieldInactive,
    setProcedureFieldDraft,
    confirmProcedureDraftsFromSave,
    restoreProcedureDraftFields,
    resetProcedureDrafts,
  };
}

export type ProcedureDrafts = ReturnType<typeof useProcedureDrafts>;
