"use client";

import { useEffect, useRef, type Dispatch, type RefObject, type SetStateAction } from "react";
import { emptyPlannerState } from "@/domain/empty-planner-state";
import { loadPlannerCoreStateFromSupabase, loadTaskPrivateMediaFromSupabase, type SaveState } from "@/domain/supabase-planner";
import { ensureNomenclatureCollections } from "@/domain/task-mutations";
import { mergeTaskPrivateMedia } from "@/domain/task-private-media";
import type { PlannerState, Task } from "@/domain/types";
import { readCachedPlannerState, writeCachedPlannerState, type readCachedMainPlannerStateSync } from "@/lib/planner-state-cache";
import type { FeedbackToast } from "../themed-feedback";
import {
  PROJECT_SWITCH_EVENT,
  PROJECT_SWITCH_SKELETON_MIN_MS,
  buildProjectSwitchTargetContext,
  clearProcedureDraftSnapshot,
  clearProjectSwitchSession,
  mergeProcedureDraftWithServer,
  readProcedureDraftSnapshot,
  readProjectSwitchTarget,
  readWorkspaceSnapshot,
  type ProjectSwitchTarget,
  type WorkspaceSnapshot,
} from "./state";
import type { useProcedureDrafts } from "./use-procedure-drafts";
import type { useProcedureSaveQueue } from "./use-procedure-save-queue";
import type { TaskDetailHydrationStatus } from "./workspace-controller-types";

type ProcedureDrafts = ReturnType<typeof useProcedureDrafts>;

// Project loading and its scope: the server and cache seeds, the remote load that confirms editability
// (and re-applies recovered procedure drafts), project-switch timing, and the selected task's private-
// media hydration with its retry listeners. The effects keep their original order and dependency arrays.
// Values an effect lists as dependencies come from the parameters; every other outside setter or ref is
// read from optionsRef when the effect runs -- the same values the effect captured when this code lived
// in LineWorkspace. Shared state and refs stay in LineWorkspace; the unmount-only skeleton-timer cleanup
// also stays there, after the realtime subscription, to keep effect order.

export type UseWorkspaceDataOptions = {
  projectId?: string;
  initialPlannerState?: PlannerState;
  onReady?: () => void;
  activeModule: string;
  derivedState: PlannerState;
  hasConfirmedRemoteState: boolean;
  hasLoadedRemoteState: boolean;
  selectedTaskId: string;
  taskDetailHydrationStatus: TaskDetailHydrationStatus;
  setProjectSwitchTargetContext: Dispatch<SetStateAction<ReturnType<typeof buildProjectSwitchTargetContext>>>;
  setIsProjectSwitching: Dispatch<SetStateAction<boolean>>;
  setHasLoadedRemoteState: Dispatch<SetStateAction<boolean>>;
  setHasConfirmedRemoteState: Dispatch<SetStateAction<boolean>>;
  setSaveState: Dispatch<SetStateAction<SaveState>>;
  setSaveError: Dispatch<SetStateAction<string | undefined>>;
  setTaskDetailHydrationStatus: Dispatch<SetStateAction<TaskDetailHydrationStatus>>;
  setPlannerState: Dispatch<SetStateAction<PlannerState>>;
  setActiveModule: Dispatch<SetStateAction<string>>;
  setSelectedTaskId: Dispatch<SetStateAction<string>>;
  setSelectedStationId: Dispatch<SetStateAction<string>>;
  setActiveZoneId: Dispatch<SetStateAction<string | undefined>>;
  setDetailDrawerCollapsed: Dispatch<SetStateAction<boolean>>;
  setSidebarCollapsed: Dispatch<SetStateAction<boolean>>;
  setWorkspaceNotice: Dispatch<SetStateAction<Omit<FeedbackToast, "id"> | null>>;
  urlWorkspaceSnapshotRef: RefObject<Partial<WorkspaceSnapshot>>;
  initialCachedPlannerSnapshotRef: RefObject<ReturnType<typeof readCachedMainPlannerStateSync>>;
  hasLoadedAnyProjectRef: RefObject<boolean>;
  loadedProjectIdRef: RefObject<string | undefined>;
  projectSwitchStartedAtRef: RefObject<number | undefined>;
  projectSwitchSkeletonTimerRef: RefObject<number | null>;
  remoteStateConfirmedRef: RefObject<boolean>;
  mainScenarioIdRef: RefObject<string | undefined>;
  taskDetailHydrationRequestsRef: RefObject<Set<string>>;
  fullyHydratedScenarioIdsRef: RefObject<Set<string>>;
  plannerDirtyRef: RefObject<boolean>;
  restoreProcedureDraftFieldsRef: RefObject<ProcedureDrafts["restoreProcedureDraftFields"]>;
  applyProcedureDraftsToTaskRef: RefObject<ProcedureDrafts["applyProcedureDraftsToTask"]>;
  recoverProcedureDraftSavesRef: RefObject<ReturnType<typeof useProcedureSaveQueue>["recoverProcedureDraftSaves"]>;
  latestDerivedStateRef: RefObject<PlannerState>;
};

export function useWorkspaceData(options: UseWorkspaceDataOptions) {
  const { projectId, initialPlannerState, onReady, activeModule, derivedState, hasConfirmedRemoteState, hasLoadedRemoteState, selectedTaskId, taskDetailHydrationStatus } = options;
  const optionsRef = useRef(options);
  optionsRef.current = options;

  function finishProjectSwitch() {
    const { setProjectSwitchTargetContext, setIsProjectSwitching, projectSwitchStartedAtRef, projectSwitchSkeletonTimerRef } = optionsRef.current;
    const startedAt = projectSwitchStartedAtRef.current;
    const elapsed = startedAt ? Date.now() - startedAt : PROJECT_SWITCH_SKELETON_MIN_MS;
    const remaining = Math.max(PROJECT_SWITCH_SKELETON_MIN_MS - elapsed, 0);

    if (projectSwitchSkeletonTimerRef.current) {
      window.clearTimeout(projectSwitchSkeletonTimerRef.current);
      projectSwitchSkeletonTimerRef.current = null;
    }

    projectSwitchSkeletonTimerRef.current = window.setTimeout(() => {
      clearProjectSwitchSession();
      projectSwitchStartedAtRef.current = undefined;
      projectSwitchSkeletonTimerRef.current = null;
      setProjectSwitchTargetContext(undefined);
      setIsProjectSwitching(false);
    }, remaining);
  }
  // The load effect calls the finishProjectSwitch of the render it runs in, as it did before.
  const finishProjectSwitchRef = useRef(finishProjectSwitch);
  finishProjectSwitchRef.current = finishProjectSwitch;

  // Ref-captured so the load effect keys on [projectId] alone: a new RSC render of
  // the same page must not restart the whole load flow just for a new prop identity.
  const initialPlannerStateRef = useRef(initialPlannerState);
  initialPlannerStateRef.current = initialPlannerState;
  // Seed once per project: a project switch re-renders the server page with the new
  // project's state, which is a legitimate fresh seed.
  const consumedInitialPlannerStateForRef = useRef<string | undefined>(undefined);
  const consumedInitialCachedPlannerStateForRef = useRef<string | undefined>(undefined);

  useEffect(() => {
    const { setProjectSwitchTargetContext, setIsProjectSwitching, setHasLoadedRemoteState, setHasConfirmedRemoteState, setSaveState, setSaveError, setTaskDetailHydrationStatus, setPlannerState, setActiveModule, setSelectedTaskId, setSelectedStationId, setActiveZoneId, setDetailDrawerCollapsed, setSidebarCollapsed, urlWorkspaceSnapshotRef, initialCachedPlannerSnapshotRef, hasLoadedAnyProjectRef, loadedProjectIdRef, projectSwitchStartedAtRef, remoteStateConfirmedRef, mainScenarioIdRef, taskDetailHydrationRequestsRef, fullyHydratedScenarioIdsRef, plannerDirtyRef, restoreProcedureDraftFieldsRef, applyProcedureDraftsToTaskRef, recoverProcedureDraftSavesRef } = optionsRef.current;
    const finishProjectSwitch = finishProjectSwitchRef.current;
    let mounted = true;
    let remoteLoaded = false;
    let serverSeededThisLoad = false;
    const currentProjectId = projectId ?? "";
    const initialUrlWorkspaceSnapshot = urlWorkspaceSnapshotRef.current;
    const cachedSeedSnapshot = initialCachedPlannerSnapshotRef.current;
    const hasWarmCachedProject = Boolean(
      cachedSeedSnapshot &&
        String(cachedSeedSnapshot.state.product.projectId ?? "") === currentProjectId &&
        cachedSeedSnapshot.scenarioId &&
        cachedSeedSnapshot.mainScenarioId &&
        cachedSeedSnapshot.scenarioId === cachedSeedSnapshot.mainScenarioId,
    );
    const isSwitchingProject = hasLoadedAnyProjectRef.current && loadedProjectIdRef.current !== currentProjectId;

    if (isSwitchingProject && !projectSwitchStartedAtRef.current) {
      projectSwitchStartedAtRef.current = Date.now();
    }
    if (isSwitchingProject) {
      setProjectSwitchTargetContext(buildProjectSwitchTargetContext(readProjectSwitchTarget()));
    }
    setIsProjectSwitching(isSwitchingProject && !hasWarmCachedProject);
    setHasLoadedRemoteState((loaded) => (hasWarmCachedProject || (isSwitchingProject && loaded) ? true : false));
    setHasConfirmedRemoteState(false);
    setSaveState("loading");
    // The shell autosave stays disabled until THIS project's remote load confirms the state; a
    // cached snapshot alone must never be diff-saved back to the database.
    remoteStateConfirmedRef.current = false;
    mainScenarioIdRef.current = undefined;
    taskDetailHydrationRequestsRef.current.clear();
    fullyHydratedScenarioIdsRef.current.clear();
    setTaskDetailHydrationStatus({});

    function applyLoadedPlannerState(savedState: PlannerState, source: "cache" | "remote") {
      const normalizedSavedState = ensureNomenclatureCollections(savedState);
      const procedureDraft = readProcedureDraftSnapshot(projectId);
      const workspaceSnapshot = readWorkspaceSnapshot(projectId);
      let recoveredTaskIds: string[] = [];
      let recoveredTask: Task | undefined;
      let hasUnmatchedRecoveredDrafts = false;
      let hydratedState = normalizedSavedState;

      if (procedureDraft && "version" in procedureDraft && procedureDraft.version === 2) {
        const recoveredDrafts = restoreProcedureDraftFieldsRef.current(procedureDraft.fields);
        // Only drafts whose task exists in this load can be re-saved here. Others (e.g. another
        // scenario's tasks) stay in storage for a later load instead of flagging a phantom draft.
        const recoveredDraftTaskIds = [...new Set(procedureDraft.fields.map((field) => field.taskId))];
        recoveredTaskIds = recoveredDraftTaskIds.filter((taskId) =>
          normalizedSavedState.tasks.some((task) => task.id === taskId),
        );
        hasUnmatchedRecoveredDrafts = recoveredTaskIds.length < recoveredDraftTaskIds.length;
        hydratedState = {
          ...normalizedSavedState,
          tasks: normalizedSavedState.tasks.map((task) => applyProcedureDraftsToTaskRef.current(task, recoveredDrafts)),
        };
        recoveredTask = hydratedState.tasks.find((task) => recoveredTaskIds.includes(task.id));
      } else if (procedureDraft && "taskId" in procedureDraft) {
        const draftTask = normalizedSavedState.tasks.find((task) => task.id === procedureDraft.taskId);
        const mergedDraftTask = draftTask ? mergeProcedureDraftWithServer(draftTask, procedureDraft.task) : undefined;
        if (mergedDraftTask) {
          recoveredTaskIds = [mergedDraftTask.id];
          recoveredTask = mergedDraftTask;
          hydratedState = {
            ...normalizedSavedState,
            tasks: normalizedSavedState.tasks.map((task) => (task.id === mergedDraftTask.id ? mergedDraftTask : task)),
          };
        } else {
          hasUnmatchedRecoveredDrafts = true;
        }
      }
      const snapshotTask = workspaceSnapshot?.selectedTaskId
        ? hydratedState.tasks.find((task) => task.id === workspaceSnapshot.selectedTaskId)
        : undefined;
      const urlTask = initialUrlWorkspaceSnapshot.selectedTaskId
        ? hydratedState.tasks.find((task) => task.id === initialUrlWorkspaceSnapshot.selectedTaskId)
        : undefined;
      const selectedTask = recoveredTask ?? urlTask ?? snapshotTask ?? hydratedState.tasks[0];
      const snapshotStation = workspaceSnapshot?.selectedStationId
        ? hydratedState.stations.find((station) => station.id === workspaceSnapshot.selectedStationId)
        : undefined;
      const urlStation = initialUrlWorkspaceSnapshot.selectedStationId
        ? hydratedState.stations.find((station) => station.id === initialUrlWorkspaceSnapshot.selectedStationId)
        : undefined;
      const snapshotZone = workspaceSnapshot?.activeZoneId
        ? hydratedState.zones.find((zone) => zone.id === workspaceSnapshot.activeZoneId)
        : undefined;
      const urlZone = initialUrlWorkspaceSnapshot.activeZoneId
        ? hydratedState.zones.find((zone) => zone.id === initialUrlWorkspaceSnapshot.activeZoneId)
        : undefined;

      setPlannerState(hydratedState);
      // Restore the view that was active when this load started -- but only if the
      // user has not navigated away since. The remote load can resolve seconds
      // later; without this guard it yanks the user back to the view they were on
      // at (re)load time. The live URL is kept in sync with the active view by the
      // view-sync effect, so a mismatch means the user has since navigated.
      const capturedView = initialUrlWorkspaceSnapshot.activeModule ?? workspaceSnapshot?.activeModule;
      if (capturedView) {
        const currentUrlView =
          typeof window !== "undefined" ? new URLSearchParams(window.location.search).get("view") : null;
        const userNavigatedAway = !!currentUrlView && currentUrlView !== capturedView;
        if (!userNavigatedAway) {
          setActiveModule(capturedView);
        }
      }
      setSelectedTaskId(selectedTask?.id ?? "");
      setSelectedStationId(urlStation?.id ?? snapshotStation?.id ?? selectedTask?.stationId ?? hydratedState.tasks[0]?.stationId ?? "");
      setActiveZoneId(urlZone?.id ?? snapshotZone?.id);
      setDetailDrawerCollapsed(workspaceSnapshot?.detailDrawerCollapsed ?? true);
      setSidebarCollapsed(workspaceSnapshot?.sidebarCollapsed ?? false);
      loadedProjectIdRef.current = currentProjectId;
      hasLoadedAnyProjectRef.current = true;
      setHasLoadedRemoteState(true);

      if (source === "cache") {
        setHasConfirmedRemoteState(false);
        setSaveState("loading");
        return;
      }

      // Only a confirmed remote load may enable the shell autosave. An unqualified remote load
      // always returns the product's Main scenario, so record its id for future cache writes.
      remoteStateConfirmedRef.current = true;
      setHasConfirmedRemoteState(true);
      mainScenarioIdRef.current = hydratedState.scenario.id;
      // The remote state just replaced whatever was on screen (including any cache-era edits, by
      // design), so no unsaved shell work remains; a dangling dirty flag would defer realtime
      // refreshes forever since the gated autosave never ran to clear it.
      plannerDirtyRef.current = false;

      finishProjectSwitch();

      void writeCachedPlannerState(projectId, hydratedState, mainScenarioIdRef.current).catch(() => undefined);

      if (recoveredTaskIds.length > 0) {
        setSaveState("draft");
        // Registered as pending work now; re-saved after the recovery delay while this project and
        // scenario are still on screen. Otherwise (an in-place switch) the drafts stay stored for the next
        // open; a route change unmounts the workspace, and this instance still re-saves them.
        recoverProcedureDraftSavesRef.current(
          hydratedState.tasks.filter((task) => recoveredTaskIds.includes(task.id)),
          hydratedState.tasks,
          { projectId, scenarioId: hydratedState.scenario.id },
        );
        return;
      }

      // Keep drafts that matched no task in this load (they belong to a different scenario);
      // clearing them here would destroy recoverable typing.
      if (!hasUnmatchedRecoveredDrafts) {
        clearProcedureDraftSnapshot(projectId);
      }
      setSaveState("saved");
    }

    // Server-fetched state paints first when it matches this project (Stage 5).
    // "cache" source: the destructive shell autosave stays disabled until the
    // client's own editable-core load below confirms — that load also closes the
    // window between the server snapshot and the realtime subscription.
    if (
      cachedSeedSnapshot &&
      hasWarmCachedProject &&
      consumedInitialCachedPlannerStateForRef.current !== currentProjectId
    ) {
      consumedInitialCachedPlannerStateForRef.current = currentProjectId;
      serverSeededThisLoad = true;
      applyLoadedPlannerState(cachedSeedSnapshot.state, "cache");
      clearProjectSwitchSession();
      projectSwitchStartedAtRef.current = undefined;
      setProjectSwitchTargetContext(undefined);
      setIsProjectSwitching(false);
    }

    const serverSeedState = initialPlannerStateRef.current;
    if (
      !serverSeededThisLoad &&
      serverSeedState &&
      consumedInitialPlannerStateForRef.current !== currentProjectId &&
      String(serverSeedState.product.projectId ?? "") === currentProjectId
    ) {
      consumedInitialPlannerStateForRef.current = currentProjectId;
      serverSeededThisLoad = true;
      applyLoadedPlannerState(serverSeedState, "cache");
    }

    void readCachedPlannerState(projectId)
      .then((cachedSnapshot) => {
        // Server-seeded data outranks any local cache snapshot — never repaint older data over it.
        if (!mounted || remoteLoaded || !cachedSnapshot || serverSeededThisLoad) {
          return;
        }

        // The remote load below fetches the product's Main scenario. Painting a cached snapshot of
        // a different -- or unknown (older cache records) -- scenario would flash the wrong Gantt
        // until the remote result replaces it, so skip straight to the skeleton in that case.
        const { state: cachedState, scenarioId, mainScenarioId } = cachedSnapshot;
        if (!scenarioId || !mainScenarioId || scenarioId !== mainScenarioId) {
          return;
        }

        applyLoadedPlannerState(cachedState, "cache");
      })
      .catch(() => undefined);

    loadPlannerCoreStateFromSupabase(projectId)
      .then((savedState) => {
        if (!mounted) {
          return;
        }
        remoteLoaded = true;

        if (savedState) {
          applyLoadedPlannerState(savedState, "remote");
          return;
        }

        if (initialUrlWorkspaceSnapshot.activeModule) {
          setActiveModule(initialUrlWorkspaceSnapshot.activeModule);
        }
        const urlTask = initialUrlWorkspaceSnapshot.selectedTaskId
          ? emptyPlannerState.tasks.find((task) => task.id === initialUrlWorkspaceSnapshot.selectedTaskId)
          : undefined;
        const urlStation = initialUrlWorkspaceSnapshot.selectedStationId
          ? emptyPlannerState.stations.find((station) => station.id === initialUrlWorkspaceSnapshot.selectedStationId)
          : undefined;
        if (urlTask) {
          setSelectedTaskId(urlTask.id);
        }
        if (urlStation || urlTask) {
          setSelectedStationId(urlStation?.id ?? urlTask?.stationId ?? "");
        }
        loadedProjectIdRef.current = currentProjectId;
        hasLoadedAnyProjectRef.current = true;
        // The remote answered (an empty project); local edits from here start from confirmed state.
        remoteStateConfirmedRef.current = true;
        setHasConfirmedRemoteState(true);
        finishProjectSwitch();
        setHasLoadedRemoteState(true);
        setSaveState("idle");
      })
      .catch((error: unknown) => {
        if (!mounted) {
          return;
        }
        remoteLoaded = true;

        // The remote load failed, so the on-screen state (possibly a stale cache) is unconfirmed:
        // remoteStateConfirmedRef stays false, keeping the destructive shell autosave disabled, and
        // the save indicator stays in "error" instead of pretending a cache-only state is saved.
        setSaveError(error instanceof Error ? error.message : "Unable to load database state.");
        finishProjectSwitch();
        setHasLoadedRemoteState(true);
        setSaveState("error");
      });

    return () => {
      mounted = false;
    };
  }, [projectId]);

  useEffect(() => {
    const { setTaskDetailHydrationStatus } = optionsRef.current;
    const retryFailedMedia = () => {
      if (document.visibilityState === "hidden") return;
      setTaskDetailHydrationStatus(current => Object.fromEntries(
        Object.entries(current).filter(([, status]) => status !== "error"),
      ));
    };
    window.addEventListener("online", retryFailedMedia);
    window.addEventListener("focus", retryFailedMedia);
    document.addEventListener("visibilitychange", retryFailedMedia);
    return () => {
      window.removeEventListener("online", retryFailedMedia);
      window.removeEventListener("focus", retryFailedMedia);
      document.removeEventListener("visibilitychange", retryFailedMedia);
    };
  }, []);

  // The confirmed Product shell includes procedure steps, parts and tools, but
  // intentionally excludes private media. Hydrate one task at a time only when
  // Procedure needs it, avoiding three all-task media reads and URL signing on
  // every Product entry. Keep the confirmed procedure mounted during this read
  // and merge only private media so a late response cannot replace active edits.
  useEffect(() => {
    const { setTaskDetailHydrationStatus, setPlannerState, setWorkspaceNotice, loadedProjectIdRef, mainScenarioIdRef, taskDetailHydrationRequestsRef, latestDerivedStateRef } = optionsRef.current;
    if (
      activeModule !== "procedure" ||
      !hasConfirmedRemoteState ||
      !selectedTaskId ||
      taskDetailHydrationStatus[selectedTaskId] === "loaded" ||
      taskDetailHydrationStatus[selectedTaskId] === "error" ||
      taskDetailHydrationRequestsRef.current.has(selectedTaskId)
    ) {
      return;
    }

    const taskId = selectedTaskId;
    const forProjectId = projectId ?? "";
    const forScenarioId = derivedState.scenario.id;
    taskDetailHydrationRequestsRef.current.add(taskId);
    setTaskDetailHydrationStatus((current) => ({ ...current, [taskId]: "loading" }));

    void loadTaskPrivateMediaFromSupabase(taskId, projectId)
      .then((serverTask) => {
        if (!serverTask) {
          throw new Error("This procedure task is no longer available.");
        }
        if (
          loadedProjectIdRef.current !== forProjectId ||
          latestDerivedStateRef.current.scenario.id !== forScenarioId
        ) {
          return;
        }

        setPlannerState((current) => {
          const localTask = current.tasks.find((task) => task.id === taskId);
          if (!localTask) {
            return current;
          }
          const hydratedTask = mergeTaskPrivateMedia(localTask, serverTask);
          const nextState = {
            ...current,
            tasks: current.tasks.map((task) => (task.id === taskId ? hydratedTask : task)),
          };
          void writeCachedPlannerState(projectId, nextState, mainScenarioIdRef.current).catch(() => undefined);
          return nextState;
        });
        setTaskDetailHydrationStatus((current) => ({ ...current, [taskId]: "loaded" }));
      })
      .catch((error: unknown) => {
        if (
          loadedProjectIdRef.current !== forProjectId ||
          latestDerivedStateRef.current.scenario.id !== forScenarioId
        ) {
          return;
        }
        setTaskDetailHydrationStatus((current) => ({ ...current, [taskId]: "error" }));
        setWorkspaceNotice({
          title: "Procedure media couldn't be loaded",
          body: error instanceof Error
            ? error.message
            : "Steps remain available, but this task's photos and videos could not be refreshed.",
          tone: "warning",
        });
      })
      .finally(() => {
        taskDetailHydrationRequestsRef.current.delete(taskId);
      });
  }, [activeModule, derivedState.scenario.id, hasConfirmedRemoteState, projectId, selectedTaskId, taskDetailHydrationStatus]);

  useEffect(() => {
    if (hasLoadedRemoteState) {
      onReady?.();
    }
  }, [hasLoadedRemoteState, onReady]);

  useEffect(() => {
    const { setProjectSwitchTargetContext, setIsProjectSwitching, setSaveState, setActiveModule, hasLoadedAnyProjectRef, projectSwitchStartedAtRef } = optionsRef.current;
    function handleProjectSwitchStart(event: Event) {
      if (hasLoadedAnyProjectRef.current) {
        projectSwitchStartedAtRef.current = Date.now();
        const target = event instanceof CustomEvent
          ? event.detail as ProjectSwitchTarget | undefined
          : readProjectSwitchTarget();
        setProjectSwitchTargetContext(buildProjectSwitchTargetContext(target));
        setActiveModule("dashboard");
        // A project switch is a context change, so acknowledge it immediately in
        // the canvas even when the target has a warm cache. The cache still makes
        // the transition brief, but the previous project's canvas is never left
        // looking active while the new route commits.
        setIsProjectSwitching(true);
        setSaveState("loading");
      }
    }

    window.addEventListener(PROJECT_SWITCH_EVENT, handleProjectSwitchStart);
    return () => window.removeEventListener(PROJECT_SWITCH_EVENT, handleProjectSwitchStart);
  }, []);
}
