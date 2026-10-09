"use client";

import { useEffect, useRef, useState, type Dispatch, type RefObject, type SetStateAction } from "react";
import { workspaceSaveBarrier, workspaceSaveStatus } from "@/domain/workspace-save-status";
import { clearCachedPlannerState, writeCachedPlannerState } from "@/lib/planner-state-cache";
import {
  PRODUCT_MASTER_BOM_FIELD,
  getMasterBom,
  serializeMasterBom,
  type MasterBom,
} from "@/domain/master-bom";
import { saveMasterBomToSupabase, savePlannerShellToSupabase, type SaveState } from "@/domain/supabase-planner";
import type { PlannerState, Product } from "@/domain/types";
import { useWriteTracker } from "./use-write-tracker";
import type { ProcedureSaveQueueStore } from "./use-procedure-save-queue";
import type {
  ForegroundSaveScope,
  PlannerCacheScope,
  PlannerStateAccess,
  ReportedSaveStatusSetters,
  WorkspaceFeedback,
} from "./workspace-controller-types";

// Workspace save ownership: the status users see (derived from the reported status cells LineWorkspace
// owns, the write tracker, and procedure queue activity), the guarded planner-shell save (a destructive
// diff, so it only runs once a remote load confirmed the state), the master BOM save, the save barrier
// that scenario actions and BOM retries wait on, and the navigation guards that keep unsaved work from
// being dropped.

type ChromeStatus = { message: string; error?: boolean } | null;

export type UseWorkspaceSavesOptions = PlannerStateAccess &
  PlannerCacheScope &
  ReportedSaveStatusSetters &
  WorkspaceFeedback &
  ForegroundSaveScope & {
    /**
     * The status the save paths report. LineWorkspace keeps these cells (and plannerDirtyRef) itself
     * because its load and project-switch effects write them and must keep stable dependencies.
     */
    reportedSaveState: SaveState;
    reportedSaveError: string | undefined;
    /**
     * Set by user edits (markDirty). Cleared by a successful or view-only-blocked shell save, a confirmed
     * remote load, and a scenario switch.
     */
    plannerDirtyRef: RefObject<boolean>;
    procedureSaveQueues: Pick<
      ProcedureSaveQueueStore,
      "hasProcedureSaveWork" | "procedureSaveActivity" | "hasScheduledProcedureSaves"
    >;
    /** True only once this project's remote load confirmed the edited state. */
    remoteStateConfirmedRef: RefObject<boolean>;
    scenarioCacheRef: RefObject<Map<string, PlannerState>>;
    /**
     * Runs a realtime refresh that was deferred while local saves were pending. It is owned by the realtime
     * code, which in turn reads hasLocalSaveWork from this hook; see the note at the call site.
     */
    flushDeferredRemoteRefresh: () => void;
    /** Workspace chrome status, used for the blocked-navigation message. */
    setChromeStatus: Dispatch<SetStateAction<ChromeStatus>>;
  };

// Re-declared every render like the component code it came from: async continuations keep the
// projectId and write tracker of the render that started the save.
export function useWorkspaceSaves({
  projectId,
  mainScenarioIdRef,
  latestDerivedStateRef,
  setPlannerState,
  notifyFeedback,
  blockViewOnlyWrite,
  reportedSaveState,
  reportedSaveError,
  setSaveState,
  setSaveError,
  plannerDirtyRef,
  procedureSaveQueues,
  remoteStateConfirmedRef,
  scenarioCacheRef,
  flushDeferredRemoteRefresh,
  setChromeStatus,
  isForegroundSaveScope,
}: UseWorkspaceSavesOptions) {
  const { hasProcedureSaveWork, procedureSaveActivity, hasScheduledProcedureSaves } = procedureSaveQueues;

  // Mirror of saveState readable synchronously inside async flows (e.g. save-before-scenario-switch).
  const saveStateRef = useRef<SaveState>("loading");
  const reportedSaveStatusRef = useRef({ state: reportedSaveState, error: reportedSaveError });
  reportedSaveStatusRef.current = { state: reportedSaveState, error: reportedSaveError };
  const { tracker: writeTracker, snapshot: writeSnapshot } = useWriteTracker(projectId);
  const [dirtyVersion, setDirtyVersion] = useState(0);
  const saveInFlightRef = useRef(false);
  const masterBomSaveInFlightRef = useRef(false);
  const queuedSaveStateRef = useRef<PlannerState | null>(null);
  // True only while persistPlannerState's own save loop runs. Media writes share saveInFlightRef, so the
  // lock alone cannot tell releaseShellLock whether that loop is still there to drain the queue.
  const shellSaveLoopActiveRef = useRef(false);
  const plannerSaveTimerRef = useRef<number | null>(null);
  const { state: saveState, error: saveError } = workspaceSaveStatus(
    reportedSaveState,
    reportedSaveError,
    writeSnapshot,
    // Procedure saves issued for another product or scenario finish in the background and never hold
    // the visible status, the save barrier or the navigation guards.
    procedureSaveActivity(isForegroundSaveScope),
    plannerDirtyRef.current || Boolean(plannerSaveTimerRef.current) || Boolean(queuedSaveStateRef.current) ||
      hasScheduledProcedureSaves(isForegroundSaveScope),
  );

  useEffect(() => {
    saveStateRef.current = saveState;
  }, [saveState]);

  function hasPlannerShellSaveWork() {
    return saveInFlightRef.current || plannerDirtyRef.current || Boolean(plannerSaveTimerRef.current) || writeTracker.getSnapshot().pending > 0;
  }

  function hasLocalSaveWork() {
    return masterBomSaveInFlightRef.current || hasPlannerShellSaveWork() || hasProcedureSaveWork(isForegroundSaveScope) || writeTracker.getSnapshot().failures.length > 0;
  }

  function markDirty() {
    plannerDirtyRef.current = true;
    setSaveError(undefined);
    setDirtyVersion((version) => version + 1);
    setSaveState((state) => (state === "loading" || state === "saving" ? state : "idle"));
  }

  function flushPendingPlannerSave() {
    // Until the remote load has confirmed the state we're editing, the shell diff-save must never
    // run: flushing a cache-era snapshot would delete rows added remotely since it was written.
    if (!remoteStateConfirmedRef.current) {
      return;
    }

    if (!plannerDirtyRef.current && !plannerSaveTimerRef.current) {
      return;
    }

    if (plannerSaveTimerRef.current) {
      window.clearTimeout(plannerSaveTimerRef.current);
      plannerSaveTimerRef.current = null;
    }

    void persistPlannerState(latestDerivedStateRef.current);
  }

  // Wait for every local save path (planner-shell autosave + per-field procedure saves) to drain.
  // Returns false if a save errored or it didn't settle in time -- the caller must NOT switch then.
  async function waitForLocalSavesToSettle(timeoutMs = 12000, retryingKey?: string): Promise<boolean> {
    const startedAt = Date.now();
    for (;;) {
      const reported = reportedSaveStatusRef.current;
      const barrier = workspaceSaveBarrier(
        reported.state, reported.error, writeTracker.getSnapshot(),
        procedureSaveActivity(isForegroundSaveScope),
        masterBomSaveInFlightRef.current || hasPlannerShellSaveWork() || hasProcedureSaveWork(isForegroundSaveScope),
        retryingKey,
      );
      if (barrier === "blocked") return false;
      if (barrier === "ready") return true;
      if (Date.now() - startedAt > timeoutMs) {
        return false;
      }
      await new Promise((resolve) => window.setTimeout(resolve, 120));
    }
  }

  async function persistPlannerState(stateToSave: PlannerState) {
    if (blockViewOnlyWrite()) {
      plannerDirtyRef.current = false;
      setSaveState("idle");
      return;
    }

    if (stateToSave.tasks.length === 0) {
      const message = "Refusing to save an empty Gantt. Add at least one task before saving.";
      setSaveError(message);
      setSaveState("error");
      notifyFeedback({
        title: "Save blocked",
        body: message,
        tone: "warning",
      });
      return;
    }

    if (masterBomSaveInFlightRef.current || saveInFlightRef.current) {
      queuedSaveStateRef.current = stateToSave;
      setSaveState("saving");
      return;
    }

    saveInFlightRef.current = true;
    shellSaveLoopActiveRef.current = true;
    const finishWrite = writeTracker.begin("planner");
    setSaveError(undefined);
    setSaveState("saving");

    let nextState: PlannerState | null = stateToSave;
    let lastPersistedState: PlannerState | null = null;

    while (nextState) {
      queuedSaveStateRef.current = null;

      try {
        await savePlannerShellToSupabase(nextState);
        lastPersistedState = nextState;
      } catch (error) {
        finishWrite(error);
        const message = error instanceof Error ? error.message : "Unable to save planner state.";
        setSaveError(message);
        setSaveState("error");
        notifyFeedback({
          title: "Save failed",
          body: message,
          tone: "danger",
        });
        saveInFlightRef.current = false;
        shellSaveLoopActiveRef.current = false;
        return;
      }

      nextState = queuedSaveStateRef.current;
    }

    saveInFlightRef.current = false;
    shellSaveLoopActiveRef.current = false;
    finishWrite();
    plannerDirtyRef.current = false;
    if (lastPersistedState) {
      // Cache the persisted state under its own project: a queued snapshot can belong to the product the
      // workspace switched to while an earlier save held the lock.
      void writeCachedPlannerState(lastPersistedState.product.projectId ?? projectId, lastPersistedState, mainScenarioIdRef.current)
        .catch(() => undefined);
    }
    setSaveState("saved");
    flushDeferredRemoteRefresh();
  }

  // Release the shell-save lock taken by a media or Gantt-order write, and send a shell save that queued
  // behind it through persistPlannerState -- the same drain the BOM save uses. While this hook's own save
  // loop runs, the lock is the loop's: it releases the lock and drains the queue itself when it exits, and
  // freeing it here would let a second, concurrent shell save start.
  function releaseShellLock(reconcileQueuedState?: (state: PlannerState) => PlannerState) {
    if (shellSaveLoopActiveRef.current) {
      return;
    }
    saveInFlightRef.current = false;
    const queuedState = queuedSaveStateRef.current;
    if (!queuedState) {
      return;
    }
    queuedSaveStateRef.current = null;
    void persistPlannerState(reconcileQueuedState ? reconcileQueuedState(queuedState) : queuedState);
  }

  async function updateMasterBom(bom: MasterBom | undefined): Promise<void> {
    if (blockViewOnlyWrite()) {
      throw new Error("You have view-only access to this project.");
    }
    if (!remoteStateConfirmedRef.current) {
      throw new Error("The latest database state is still loading. Wait a moment, then retry the BOM upload.");
    }
    if (!projectId) {
      throw new Error("Select a project before updating the master BOM.");
    }

    flushPendingPlannerSave();
    if (!(await waitForLocalSavesToSettle(12000, "master-bom"))) {
      throw new Error("Other changes could not be saved. Resolve the save error before updating the BOM.");
    }

    masterBomSaveInFlightRef.current = true;
    // The BOM belongs to this product. If the workspace switches products before the save returns,
    // the verified BOM must not be merged into, reported by, or persisted with the other product.
    const issuingProductId = latestDerivedStateRef.current.product.id;
    const isIssuingProduct = (product: Product) => product.id === issuingProductId;
    const finishWrite = writeTracker.begin("master-bom");
    setSaveError(undefined);
    saveStateRef.current = "saving";
    setSaveState("saving");

    let verifiedProduct: Product | undefined;
    try {
      verifiedProduct = await saveMasterBomToSupabase(latestDerivedStateRef.current.product, bom, projectId);
      const verifiedBom = getMasterBom(verifiedProduct.customFields);
      const mergeVerifiedBom = (localProduct: Product): Product => {
        const customFields = { ...(localProduct.customFields ?? {}) };
        if (verifiedBom) {
          customFields[PRODUCT_MASTER_BOM_FIELD] = serializeMasterBom(verifiedBom);
        } else {
          delete customFields[PRODUCT_MASTER_BOM_FIELD];
        }
        return { ...localProduct, customFields, updatedAt: verifiedProduct?.updatedAt ?? localProduct.updatedAt };
      };

      if (isIssuingProduct(latestDerivedStateRef.current.product)) {
        const confirmedState = {
          ...latestDerivedStateRef.current,
          product: mergeVerifiedBom(latestDerivedStateRef.current.product),
        };
        latestDerivedStateRef.current = confirmedState;
        setPlannerState((current) => (isIssuingProduct(current.product) ? { ...current, product: mergeVerifiedBom(current.product) } : current));
        scenarioCacheRef.current.set(confirmedState.scenario.id, confirmedState);
        void writeCachedPlannerState(projectId, confirmedState, mainScenarioIdRef.current).catch(() => undefined);
        saveStateRef.current = "saved";
        setSaveState("saved");
      } else {
        // This project's cached snapshot no longer matches the database; the next open loads it fresh.
        void clearCachedPlannerState(projectId).catch(() => undefined);
      }
    } catch (error) {
      finishWrite(error);
      const message = error instanceof Error ? error.message : "The master BOM could not be saved.";
      if (isIssuingProduct(latestDerivedStateRef.current.product)) {
        setSaveError(message);
        saveStateRef.current = "error";
        setSaveState("error");
      }
      notifyFeedback({ title: "BOM save failed", body: message, tone: "danger" });
      throw error;
    } finally {
      masterBomSaveInFlightRef.current = false;
      finishWrite();
      const queuedState = queuedSaveStateRef.current;
      queuedSaveStateRef.current = null;
      if (queuedState) {
        let nextQueuedState = queuedState;
        // A queued shell snapshot from another product is persisted as it is, never with this BOM.
        if (verifiedProduct && isIssuingProduct(queuedState.product)) {
          const confirmedBom = getMasterBom(verifiedProduct.customFields);
          const customFields = { ...(queuedState.product.customFields ?? {}) };
          if (confirmedBom) {
            customFields[PRODUCT_MASTER_BOM_FIELD] = serializeMasterBom(confirmedBom);
          } else {
            delete customFields[PRODUCT_MASTER_BOM_FIELD];
          }
          nextQueuedState = {
            ...queuedState,
            product: { ...queuedState.product, customFields, updatedAt: verifiedProduct.updatedAt },
          };
        }
        void persistPlannerState(nextQueuedState);
      } else if (isIssuingProduct(latestDerivedStateRef.current.product)) {
        flushDeferredRemoteRefresh();
      }
    }
  }

  function blockMasterBomNavigation(): boolean {
    if (!masterBomSaveInFlightRef.current) {
      return false;
    }
    notifyFeedback({
      title: "BOM is still saving",
      body: "Wait for Saved before leaving this page.",
      tone: "warning",
    });
    return true;
  }

  // Page exit and in-app link guards. Registered once; the handlers read the latest save predicates
  // through refs so they never act on a stale render.
  const hasLocalSaveWorkRef = useRef(hasLocalSaveWork);
  hasLocalSaveWorkRef.current = hasLocalSaveWork;
  const flushPendingPlannerSaveRef = useRef(flushPendingPlannerSave);
  flushPendingPlannerSaveRef.current = flushPendingPlannerSave;
  const setChromeStatusRef = useRef(setChromeStatus);
  setChromeStatusRef.current = setChromeStatus;

  useEffect(() => {
    function handlePageHide() {
      flushPendingPlannerSaveRef.current();
    }

    function handleBeforeUnload(event: BeforeUnloadEvent) {
      if (!hasLocalSaveWorkRef.current()) {
        return;
      }
      event.preventDefault();
      event.returnValue = "";
    }

    function handleLinkNavigation(event: MouseEvent) {
      // Client-side navigation (Settings, the dashboard link) does not fire beforeunload, so
      // without this guard clicking one while a save is pending or failing tears the workspace
      // down and drops the in-memory edits -- the browser cache is not a safe harbour, because
      // the next remote load overwrites it. beforeunload already covers full reloads/tab close;
      // this mirrors that same hasLocalSaveWork predicate for in-app links.
      const bomSaving = masterBomSaveInFlightRef.current;
      if (!bomSaving && !hasLocalSaveWorkRef.current()) {
        return;
      }
      const eventTarget = event.target;
      const anchor = eventTarget instanceof Element ? eventTarget.closest<HTMLAnchorElement>("a[href]") : null;
      if (!anchor || anchor.target === "_blank" || anchor.hasAttribute("download")) {
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      setChromeStatusRef.current({
        message: bomSaving
          ? "BOM is still saving. Wait for Saved before leaving this page."
          : saveStateRef.current === "error" || saveStateRef.current === "conflict"
            ? "Your changes have not saved. Resolve the save error before leaving this page."
            : "Your changes are saving automatically. Wait for Saved before leaving this page.",
        error: true,
      });
    }

    window.addEventListener("pagehide", handlePageHide);
    window.addEventListener("beforeunload", handleBeforeUnload);
    document.addEventListener("click", handleLinkNavigation, true);
    return () => {
      window.removeEventListener("pagehide", handlePageHide);
      window.removeEventListener("beforeunload", handleBeforeUnload);
      document.removeEventListener("click", handleLinkNavigation, true);
      flushPendingPlannerSaveRef.current();
    };
  }, []);

  return {
    saveState,
    saveError,
    writeTracker,
    dirtyVersion,
    markDirty,
    // The shell-save lock. Media and Gantt-order writes in LineWorkspace also take it, so shell saves
    // queue behind them (queuedSaveStateRef) exactly as before the extraction. They release it only
    // through releaseShellLock, which drains a save that queued meanwhile.
    saveInFlightRef,
    releaseShellLock,
    plannerSaveTimerRef,
    hasPlannerShellSaveWork,
    hasLocalSaveWork,
    flushPendingPlannerSave,
    waitForLocalSavesToSettle,
    persistPlannerState,
    updateMasterBom,
    blockMasterBomNavigation,
  };
}

export type WorkspaceSaves = ReturnType<typeof useWorkspaceSaves>;

export type UsePlannerShellAutosaveOptions = Pick<
  WorkspaceSaves,
  "dirtyVersion" | "plannerSaveTimerRef" | "persistPlannerState"
> & {
  plannerDirtyRef: RefObject<boolean>;
  derivedState: PlannerState;
  hasLoadedRemoteState: boolean;
  remoteStateConfirmedRef: RefObject<boolean>;
  /**
   * Set when the latest planner-state change came from the server (realtime refresh, procedure-save
   * acknowledgment). On a clean planner the autosave consumes it as an echo; it never suppresses the
   * save of a dirty planner.
   */
  remoteRefreshAppliedRef: RefObject<boolean>;
};

// Debounced shell autosave after user edits (markDirty). LineWorkspace calls this at the original effect
// position, after its [projectId] load effect: on a project change that effect synchronously clears
// remoteStateConfirmedRef, and this effect must observe that within the same commit.
export function usePlannerShellAutosave({
  dirtyVersion,
  plannerDirtyRef,
  plannerSaveTimerRef,
  persistPlannerState,
  derivedState,
  hasLoadedRemoteState,
  remoteStateConfirmedRef,
  remoteRefreshAppliedRef,
}: UsePlannerShellAutosaveOptions) {
  const persistPlannerStateRef = useRef(persistPlannerState);
  persistPlannerStateRef.current = persistPlannerState;

  useEffect(() => {
    // A server-applied change is an echo only while there is no local edit to save: consume the flag then.
    // With a local edit pending (a Restore, or a shell edit that a procedure-save acknowledgment re-renders)
    // clear it and save on the normal 900 ms path, or the edit would wait for the next one.
    if (remoteRefreshAppliedRef.current) {
      remoteRefreshAppliedRef.current = false;
      if (!plannerDirtyRef.current) {
        return;
      }
    }

    // Procedure edits have their own queue. Once the shell has saved, later
    // procedure renders must not restart a competing full planner save.
    if (!hasLoadedRemoteState || dirtyVersion === 0 || !plannerDirtyRef.current) {
      return;
    }

    // A cached snapshot may be editable before the remote load lands, but it must never autosave:
    // the shell save is a destructive diff, and persisting stale state would delete teammates'
    // newer tasks. The remote apply replaces local state wholesale, so nothing is lost by waiting.
    if (!remoteStateConfirmedRef.current) {
      return;
    }

    const timeout = window.setTimeout(() => {
      if (plannerSaveTimerRef.current === timeout) {
        plannerSaveTimerRef.current = null;
      }
      void persistPlannerStateRef.current(derivedState);
    }, 900);
    plannerSaveTimerRef.current = timeout;

    return () => {
      window.clearTimeout(timeout);
      if (plannerSaveTimerRef.current === timeout) {
        plannerSaveTimerRef.current = null;
      }
    };
  }, [
    dirtyVersion,
    derivedState,
    hasLoadedRemoteState,
    plannerDirtyRef,
    plannerSaveTimerRef,
    remoteRefreshAppliedRef,
    remoteStateConfirmedRef,
  ]);
}
