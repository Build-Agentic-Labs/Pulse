"use client";

import { useEffect, useMemo, useRef, type Dispatch, type RefObject, type SetStateAction } from "react";
import {
  canPatchTaskFromRealtimePayload,
  loadPlannerStateFromSupabase,
  loadTaskFromSupabase,
  subscribePlannerStateChanges,
  taskIdFromRealtimePayload,
} from "@/domain/supabase-planner";
import type { PlannerState, Task } from "@/domain/types";
import { writeCachedPlannerState } from "@/lib/planner-state-cache";
import type { PresencePeer } from "@/lib/use-planner-presence";
import { procedureDraftLog } from "./state";
import type { useProcedureDrafts } from "./use-procedure-drafts";
import type {
  PlannerStateAccess,
  ReportedSaveStatusSetters,
  TaskDetailHydrationStatus,
  WorkspaceFeedback,
} from "./workspace-controller-types";

type ProcedureDrafts = ReturnType<typeof useProcedureDrafts>;

// Realtime synchronization: per-task and full refreshes from the database, their debounce timers, the
// deferral while local shell saves are pending (flushed by flushDeferredRemoteRefresh), stale-scope
// rejection, the concurrent-edit notice, and the subscription. Functions are re-declared every render
// and close over that render's values; LineWorkspace forwards each render's flush to that render's
// functions, preserving the issuing-scope semantics the code had before Phase 3.

export type UseWorkspaceRealtimeOptions = PlannerStateAccess &
  ReportedSaveStatusSetters &
  Pick<WorkspaceFeedback, "notifyFeedback"> & {
    projectId?: string;
    derivedState: PlannerState;
    hasLoadedRemoteState: boolean;
    mainScenarioIdRef: RefObject<string | undefined>;
    loadedProjectIdRef: RefObject<string | undefined>;
    /** A refresh was deferred while local saves were pending; shared with the saves hook. */
    pendingRemoteRefreshRef: RefObject<boolean>;
    /** Set when a refresh applied, so the shell autosave skips that state change. */
    remoteRefreshAppliedRef: RefObject<boolean>;
    plannerDirtyRef: RefObject<boolean>;
    presencePeersRef: RefObject<PresencePeer[]>;
    fullyHydratedScenarioIdsRef: RefObject<Set<string>>;
    setTaskDetailHydrationStatus: Dispatch<SetStateAction<TaskDetailHydrationStatus>>;
    setSelectedTaskId: Dispatch<SetStateAction<string>>;
    setSelectedStationId: Dispatch<SetStateAction<string>>;
    hasPlannerShellSaveWork: () => boolean;
    hasLocalSaveWork: () => boolean;
    procedureDraftsRef: ProcedureDrafts["procedureDraftsRef"];
    hasDirtyOrActiveProcedureDrafts: ProcedureDrafts["hasDirtyOrActiveProcedureDrafts"];
    storeDeferredProcedureServerUpdate: ProcedureDrafts["storeDeferredProcedureServerUpdate"];
    mergeServerTaskIntoLocalTask: ProcedureDrafts["mergeServerTaskIntoLocalTask"];
    /** Flushes (never drops) debounced procedure saves; called when the subscribed scope is left. */
    flushScheduledProcedureSaves: () => void;
  };

export function useWorkspaceRealtime({
  projectId,
  derivedState,
  hasLoadedRemoteState,
  latestDerivedStateRef,
  setPlannerState,
  setSaveState,
  setSaveError,
  mainScenarioIdRef,
  loadedProjectIdRef,
  pendingRemoteRefreshRef,
  remoteRefreshAppliedRef,
  plannerDirtyRef,
  presencePeersRef,
  fullyHydratedScenarioIdsRef,
  setTaskDetailHydrationStatus,
  setSelectedTaskId,
  setSelectedStationId,
  notifyFeedback,
  hasPlannerShellSaveWork,
  hasLocalSaveWork,
  procedureDraftsRef,
  hasDirtyOrActiveProcedureDrafts,
  storeDeferredProcedureServerUpdate,
  mergeServerTaskIntoLocalTask,
  flushScheduledProcedureSaves,
}: UseWorkspaceRealtimeOptions) {
  const remoteRefreshTimerRef = useRef<number | null>(null);
  const remoteTaskRefreshTimerRef = useRef<number | null>(null);
  const pendingRemoteTaskIdsRef = useRef<Set<string>>(new Set());
  const lastConflictNoticeAtRef = useRef(0);
  // The subscription cleanup calls the latest flush, read at cleanup time.
  const flushProcedureSavesOnScopeExitRef = useRef(flushScheduledProcedureSaves);
  flushProcedureSavesOnScopeExitRef.current = flushScheduledProcedureSaves;
  const realtimeTaskIdSet = useMemo(
    () => new Set(derivedState.tasks.map((task) => task.id)),
    [derivedState.tasks],
  );
  // Keep the latest set readable from the (deliberately stable) realtime subscription without making
  // it a dependency -- otherwise the channel would tear down and re-subscribe on every task add/remove.
  const realtimeTaskIdSetRef = useRef(realtimeTaskIdSet);
  realtimeTaskIdSetRef.current = realtimeTaskIdSet;

  // Whether the workspace still shows the project + scenario a refresh was started for. Refreshes
  // resolve asynchronously; by then the user may have switched, and applying (or caching) the
  // fetched result would contaminate the newly loaded view. Reads live values from refs so that
  // in-flight promise callbacks are not fooled by their captured render's scope.
  function isRefreshTargetCurrent(forProjectId: string, forScenarioId: string) {
    return (
      latestDerivedStateRef.current.scenario.id === forScenarioId && loadedProjectIdRef.current === forProjectId
    );
  }

  function refreshTasksFromSupabase(taskIds: string[]) {
    if (hasPlannerShellSaveWork()) {
      pendingRemoteRefreshRef.current = true;
      return;
    }

    const forProjectId = projectId ?? "";
    const forScenarioId = latestDerivedStateRef.current.scenario.id;

    void Promise.all(taskIds.map((taskId) => loadTaskFromSupabase(taskId, projectId)))
      .then((latestTasks) => {
        if (!isRefreshTargetCurrent(forProjectId, forScenarioId)) {
          return;
        }

        if (hasPlannerShellSaveWork()) {
          pendingRemoteRefreshRef.current = true;
          return;
        }

        const taskById = new Map(
          latestTasks
            .filter((task): task is Task => Boolean(task))
            .map((task) => [task.id, task]),
        );
        if (taskById.size === 0) {
          return;
        }

        setTaskDetailHydrationStatus((current) => ({
          ...current,
          ...Object.fromEntries([...taskById.keys()].map((taskId) => [taskId, "loaded" as const])),
        }));

        remoteRefreshAppliedRef.current = true;
        setPlannerState((current) => {
          const existingTaskIds = new Set(current.tasks.map((task) => task.id));
          const insertedTasks = [...taskById.values()].filter((task) => !existingTaskIds.has(task.id));
          const mergedTasks = current.tasks.map((task) => {
            const serverTask = taskById.get(task.id);
            if (!serverTask) {
              return task;
            }

            if (hasDirtyOrActiveProcedureDrafts(task.id)) {
              storeDeferredProcedureServerUpdate({
                serverTask,
                serverVersion: serverTask.version,
                receivedAt: Date.now(),
                source: "refreshTasks",
              });
              return mergeServerTaskIntoLocalTask(task, serverTask, procedureDraftsRef.current, { source: "refreshTasks" });
            }

            return mergeServerTaskIntoLocalTask(task, serverTask, procedureDraftsRef.current, { source: "refreshTasks" });
          });
          const nextState = {
            ...current,
            tasks: [...mergedTasks, ...insertedTasks],
          };
          void writeCachedPlannerState(projectId, nextState, mainScenarioIdRef.current).catch(() => undefined);
          return nextState;
        });
        setSaveError(undefined);
        setSaveState("saved");
      })
      .catch(() => {
        if (!isRefreshTargetCurrent(forProjectId, forScenarioId)) {
          return;
        }
        requestRemotePlannerRefresh();
      });
  }

  function requestRemoteTaskRefresh(taskId: string) {
    if (hasPlannerShellSaveWork()) {
      pendingRemoteRefreshRef.current = true;
      maybeNotifyConcurrentEdit();
      return;
    }

    pendingRemoteTaskIdsRef.current.add(taskId);

    if (remoteTaskRefreshTimerRef.current) {
      window.clearTimeout(remoteTaskRefreshTimerRef.current);
    }

    remoteTaskRefreshTimerRef.current = window.setTimeout(() => {
      remoteTaskRefreshTimerRef.current = null;
      const taskIds = [...pendingRemoteTaskIdsRef.current];
      pendingRemoteTaskIdsRef.current.clear();
      refreshTasksFromSupabase(taskIds);
    }, 250);
  }

  function refreshPlannerFromSupabase() {
    if (hasPlannerShellSaveWork()) {
      pendingRemoteRefreshRef.current = true;
      return;
    }

    // Refresh the ACTIVE scenario, not the product's default. Without the scenario id this reloads the
    // earliest (Main) scenario and overwrites whichever projection is open -- the "switch bounces back
    // to Main" bug. The active scenario id is read live from the derived-state ref.
    const forProjectId = projectId ?? "";
    const forScenarioId = latestDerivedStateRef.current.scenario.id;

    void loadPlannerStateFromSupabase(projectId, forScenarioId)
      .then((savedState) => {
        if (!isRefreshTargetCurrent(forProjectId, forScenarioId)) {
          return;
        }

        if (!savedState || hasPlannerShellSaveWork()) {
          pendingRemoteRefreshRef.current = true;
          return;
        }

        pendingRemoteRefreshRef.current = false;
        remoteRefreshAppliedRef.current = true;
        fullyHydratedScenarioIdsRef.current.add(savedState.scenario.id);
        setTaskDetailHydrationStatus(
          Object.fromEntries(savedState.tasks.map((task) => [task.id, "loaded" as const])),
        );
        setPlannerState((current) => {
          const localTaskById = new Map(current.tasks.map((task) => [task.id, task]));
          const savedTaskIds = new Set(savedState.tasks.map((task) => task.id));
          const mergedTasks = savedState.tasks.map((serverTask) => {
            const localTask = localTaskById.get(serverTask.id);
            if (!localTask) {
              return serverTask;
            }

            if (hasDirtyOrActiveProcedureDrafts(serverTask.id)) {
              storeDeferredProcedureServerUpdate({
                serverTask,
                serverVersion: serverTask.version,
                receivedAt: Date.now(),
                source: "refreshPlanner",
              });
              procedureDraftLog("full planner refresh protected a field", {
                taskId: serverTask.id,
                serverVersion: serverTask.version,
                source: "refreshPlanner",
              });
            }

            return mergeServerTaskIntoLocalTask(localTask, serverTask, procedureDraftsRef.current, {
              source: "refreshPlanner",
            });
          });
          const nextState = {
            ...savedState,
            tasks: [
              ...mergedTasks,
              ...current.tasks.filter((task) => !savedTaskIds.has(task.id) && hasDirtyOrActiveProcedureDrafts(task.id)),
            ],
          };
          void writeCachedPlannerState(projectId, nextState, mainScenarioIdRef.current).catch(() => undefined);
          return nextState;
        });
        setSelectedTaskId((currentTaskId) =>
          savedState.tasks.some((task) => task.id === currentTaskId)
            ? currentTaskId
            : savedState.tasks[0]?.id ?? "",
        );
        setSelectedStationId((currentStationId) =>
          savedState.stations.some((station) => station.id === currentStationId)
            ? currentStationId
            : savedState.stations[0]?.id ?? savedState.tasks[0]?.stationId ?? "",
        );
        setSaveError(undefined);
        setSaveState("saved");
      })
      .catch((error: unknown) => {
        if (!isRefreshTargetCurrent(forProjectId, forScenarioId)) {
          return;
        }
        setSaveError(error instanceof Error ? error.message : "Unable to refresh database changes.");
        setSaveState("error");
      });
  }

  // A realtime change landed while this user has unsaved local edits. Authorship isn't
  // in the payload, so gate on presence (someone else is actually in this project) to
  // avoid firing on the echo of our own saves, and throttle to one notice a minute.
  function maybeNotifyConcurrentEdit() {
    const peers = presencePeersRef.current;
    if (!peers.length || !plannerDirtyRef.current) {
      return;
    }
    const now = Date.now();
    if (now - lastConflictNoticeAtRef.current < 60_000) {
      return;
    }
    lastConflictNoticeAtRef.current = now;
    notifyFeedback({
      title: `Editing alongside ${peers.map((peer) => peer.name).join(", ")}`,
      body: "This scenario just changed while you have unsaved edits. The latest save wins — coordinate to avoid overwriting each other's work.",
      tone: "warning",
    });
  }

  function requestRemotePlannerRefresh() {
    if (hasPlannerShellSaveWork()) {
      pendingRemoteRefreshRef.current = true;
      maybeNotifyConcurrentEdit();
      return;
    }

    if (remoteRefreshTimerRef.current) {
      window.clearTimeout(remoteRefreshTimerRef.current);
    }

    remoteRefreshTimerRef.current = window.setTimeout(() => {
      remoteRefreshTimerRef.current = null;
      refreshPlannerFromSupabase();
    }, 350);
  }

  function flushDeferredRemoteRefresh() {
    if (!pendingRemoteRefreshRef.current || hasLocalSaveWork()) {
      return;
    }

    pendingRemoteRefreshRef.current = false;
    requestRemotePlannerRefresh();
  }

  // The subscription reads the latest request functions through refs, so it is never re-created for them.
  const requestRemotePlannerRefreshRef = useRef(requestRemotePlannerRefresh);
  const requestRemoteTaskRefreshRef = useRef(requestRemoteTaskRefresh);
  requestRemotePlannerRefreshRef.current = requestRemotePlannerRefresh;
  requestRemoteTaskRefreshRef.current = requestRemoteTaskRefresh;

  useEffect(() => {
    if (!hasLoadedRemoteState) {
      return undefined;
    }
    const pendingRemoteTaskIds = pendingRemoteTaskIdsRef.current;

    const unsubscribe = subscribePlannerStateChanges(
      (payload) => {
        const taskId = taskIdFromRealtimePayload(payload);
        if (taskId && canPatchTaskFromRealtimePayload(payload)) {
          requestRemoteTaskRefreshRef.current(taskId);
          return;
        }

        requestRemotePlannerRefreshRef.current();
      },
      {
        productId: derivedState.product.id,
        scenarioId: derivedState.scenario.id,
        isTaskInScope: (taskId) => realtimeTaskIdSetRef.current.has(taskId),
      },
    );

    return () => {
      if (remoteRefreshTimerRef.current) {
        window.clearTimeout(remoteRefreshTimerRef.current);
      }
      if (remoteTaskRefreshTimerRef.current) {
        window.clearTimeout(remoteTaskRefreshTimerRef.current);
        remoteTaskRefreshTimerRef.current = null;
      }
      // Drop any task ids still queued for the scenario we're leaving -- otherwise a same-project
      // scenario switch would refresh them into (and contaminate) the next scenario's task list.
      pendingRemoteTaskIds.clear();
      // FLUSH -- don't drop -- debounced procedure saves for the scope we're leaving, and cancel
      // pending retries. (Scenario switches drain saves beforehand, so this mostly fires on unmount.)
      flushProcedureSavesOnScopeExitRef.current();
      // NOTE: the project-switch skeleton timer is intentionally NOT cleared here. This cleanup
      // re-runs on every product/scenario change -- exactly when finishProjectSwitch has just armed
      // the timer -- and clearing it wedged the workspace on the switch skeleton forever. It is
      // cleared by a dedicated unmount-only effect below instead.
      unsubscribe();
    };
  }, [derivedState.product.id, derivedState.scenario.id, hasLoadedRemoteState]);

  return { flushDeferredRemoteRefresh };
}
