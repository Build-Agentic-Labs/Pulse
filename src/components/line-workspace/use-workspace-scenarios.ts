"use client";

import { useState, type Dispatch, type RefObject, type SetStateAction } from "react";
import {
  deleteScenario,
  duplicateScenario,
  loadPlannerStateFromSupabase,
  loadScenariosForProduct,
  renameScenario,
  updateScenarioTarget,
} from "@/domain/supabase-planner";
import { ensureNomenclatureCollections } from "@/domain/task-mutations";
import type { PlannerState, ScenarioSummary, Task } from "@/domain/types";
import type { FeedbackConfirm, FeedbackToast } from "../themed-feedback";
import type {
  PlannerStateAccess,
  ReportedSaveStatusSetters,
  SaveScope,
  TaskDetailHydrationStatus,
} from "./workspace-controller-types";

// Scenario actions: switch (save first, abort on failure), duplicate, delete, rename and projection
// target, and the controlled draft reset when a scenario's state is swapped in. The scenario list, the
// in-memory scenario cache and their effects stay in LineWorkspace (they are read by the saves hook and
// run before it); this hook owns only the switch flags and the actions. Functions are re-declared every
// render like the component code they came from, so in-flight work keeps the values it started with.

export type UseWorkspaceScenariosOptions = PlannerStateAccess &
  ReportedSaveStatusSetters & {
    projectId?: string;
    derivedState: PlannerState;
    isMainScenario: boolean;
    scenarios: ScenarioSummary[];
    setScenarios: Dispatch<SetStateAction<ScenarioSummary[]>>;
    scenarioCacheRef: RefObject<Map<string, PlannerState>>;
    plannerDirtyRef: RefObject<boolean>;
    remoteStateConfirmedRef: RefObject<boolean>;
    fullyHydratedScenarioIdsRef: RefObject<Set<string>>;
    taskDetailHydrationRequestsRef: RefObject<Set<string>>;
    setTaskDetailHydrationStatus: Dispatch<SetStateAction<TaskDetailHydrationStatus>>;
    setSelectedTaskId: Dispatch<SetStateAction<string>>;
    setSelectedStationId: Dispatch<SetStateAction<string>>;
    setActiveZoneId: Dispatch<SetStateAction<string | undefined>>;
    setFocusedProcedureStepId: Dispatch<SetStateAction<string | undefined>>;
    setFeedbackConfirm: Dispatch<SetStateAction<FeedbackConfirm | undefined>>;
    notifyFeedback: (message: Omit<FeedbackToast, "id">) => void;
    resetProcedureDrafts: (leavingTaskIds: string[]) => void;
    hasDirtyProcedureDrafts: (taskId: string) => boolean;
    recoverProcedureDraftSaves: (recoveredTasks: Task[], loadedTasks: Task[], scope: SaveScope) => void;
    flushPendingPlannerSave: () => void;
    waitForLocalSavesToSettle: () => Promise<boolean>;
  };

export function useWorkspaceScenarios({
  projectId,
  derivedState,
  isMainScenario,
  latestDerivedStateRef,
  setPlannerState,
  setSaveState,
  setSaveError,
  scenarios,
  setScenarios,
  scenarioCacheRef,
  plannerDirtyRef,
  remoteStateConfirmedRef,
  fullyHydratedScenarioIdsRef,
  taskDetailHydrationRequestsRef,
  setTaskDetailHydrationStatus,
  setSelectedTaskId,
  setSelectedStationId,
  setActiveZoneId,
  setFocusedProcedureStepId,
  setFeedbackConfirm,
  notifyFeedback,
  resetProcedureDrafts,
  hasDirtyProcedureDrafts,
  recoverProcedureDraftSaves,
  flushPendingPlannerSave,
  waitForLocalSavesToSettle,
}: UseWorkspaceScenariosOptions) {
  const [isSwitchingScenario, setIsSwitchingScenario] = useState(false);
  // The scenario id being switched to, set immediately on click so the target tab highlights right
  // away (instant feedback) even while the reload is in flight.
  const [switchTargetId, setSwitchTargetId] = useState<string | undefined>();

  // Apply a freshly-loaded scenario for a switch. We only reach here AFTER a successful save, so any
  // procedure drafts from the previous scenario are stale and must be dropped (never carried across).
  function applyScenarioSwitch(loaded: PlannerState) {
    const normalized = ensureNomenclatureCollections(loaded);
    resetProcedureDrafts(latestDerivedStateRef.current.tasks.map((task) => task.id));
    // Unsaved drafts recovered for this scenario's tasks (from storage at project load, or kept from an
    // earlier visit) are re-saved the same way project load re-saves them.
    const recoveredTasks = normalized.tasks.filter((task) => hasDirtyProcedureDrafts(task.id));
    plannerDirtyRef.current = false;
    setPlannerState(normalized);
    setSelectedTaskId(normalized.tasks[0]?.id);
    setSelectedStationId(normalized.stations[0]?.id ?? "");
    setActiveZoneId(undefined);
    setFocusedProcedureStepId(undefined);
    if (recoveredTasks.length > 0) {
      recoverProcedureDraftSaves(recoveredTasks, normalized.tasks, { projectId, scenarioId: normalized.scenario.id });
    }
    setTaskDetailHydrationStatus(
      fullyHydratedScenarioIdsRef.current.has(normalized.scenario.id)
        ? Object.fromEntries(normalized.tasks.map((task) => [task.id, "loaded" as const]))
        : {},
    );
    taskDetailHydrationRequestsRef.current.clear();
  }

  // Switch the Gantt to another scenario. Hard rule (spec §4.2 / §7.4): save first; if the save fails
  // or doesn't settle, ABORT -- show the error and stay on the current scenario. Never switch on a
  // failed/partial save. Realtime re-subscribes automatically via the derivedState.scenario.id effect.
  // Flush + await all local saves before a scenario action; on failure show a warning and return false.
  async function ensureSavedBeforeScenarioAction(failTitle: string, failBody: string): Promise<boolean> {
    // Without a confirmed remote load there is no safe way to persist local changes (the shell save
    // stays disabled); surface an error instead of waiting for a save that can never run.
    if (!remoteStateConfirmedRef.current) {
      notifyFeedback({
        title: failTitle,
        body: "The latest database state hasn't finished loading, so local changes can't be saved safely yet. Try again in a moment.",
        tone: "warning",
      });
      return false;
    }

    flushPendingPlannerSave();
    const saved = await waitForLocalSavesToSettle();
    if (!saved) {
      notifyFeedback({ title: failTitle, body: failBody, tone: "warning" });
      return false;
    }
    return true;
  }

  // Load a scenario into the active view: instant from the in-memory cache, else load once and cache
  // it. Throws if it can't be loaded. The caller owns the surrounding save-state / busy messaging.
  async function loadScenarioIntoView(scenarioId: string) {
    const cached = scenarioCacheRef.current.get(scenarioId);
    if (cached) {
      applyScenarioSwitch(cached);
      return;
    }
    setSaveState("loading");
    const loaded = await loadPlannerStateFromSupabase(projectId, scenarioId);
    if (!loaded) {
      throw new Error("That scenario could not be loaded.");
    }
    fullyHydratedScenarioIdsRef.current.add(loaded.scenario.id);
    scenarioCacheRef.current.set(scenarioId, loaded);
    applyScenarioSwitch(loaded);
  }

  // Reload the scenario tab list for the current product and return it.
  async function refreshScenarioList(): Promise<ScenarioSummary[]> {
    const list = await loadScenariosForProduct(derivedState.product.id);
    setScenarios(list);
    return list;
  }

  async function switchScenario(targetScenarioId: string) {
    if (isSwitchingScenario || targetScenarioId === derivedState.scenario.id) {
      return;
    }

    // Highlight the target tab immediately (instant feedback) for the whole save+load duration.
    setSwitchTargetId(targetScenarioId);
    setIsSwitchingScenario(true);
    try {
      const ok = await ensureSavedBeforeScenarioAction(
        "Can't switch scenarios",
        "Your changes couldn't be saved, so the scenario was not switched. Resolve the save error and try again.",
      );
      if (!ok) {
        return;
      }
      await loadScenarioIntoView(targetScenarioId);
      setSaveState("saved");
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unable to load that scenario.";
      setSaveError(message);
      setSaveState("error");
      notifyFeedback({ title: "Scenario load failed", body: message, tone: "danger" });
    } finally {
      setIsSwitchingScenario(false);
      setSwitchTargetId(undefined);
    }
  }

  // Rename a (non-main) scenario. Optimistically updates local state, then persists; reverts on failure.
  async function renameScenarioById(scenarioId: string, name: string) {
    const trimmed = name.trim();
    if (!trimmed || scenarioId === scenarios[0]?.id) {
      return;
    }
    const previousName = scenarios.find((scenario) => scenario.id === scenarioId)?.name;
    const applyName = (value: string) => {
      setScenarios((current) =>
        current.map((scenario) => (scenario.id === scenarioId ? { ...scenario, name: value } : scenario)),
      );
      if (scenarioId === latestDerivedStateRef.current.scenario.id) {
        setPlannerState((current) => ({ ...current, scenario: { ...current.scenario, name: value } }));
      }
    };
    applyName(trimmed);
    try {
      await renameScenario(scenarioId, trimmed);
    } catch (error) {
      if (previousName !== undefined) {
        applyName(previousName);
      }
      notifyFeedback({
        title: "Couldn't rename scenario",
        body: error instanceof Error ? error.message : "The scenario could not be renamed.",
        tone: "danger",
      });
    }
  }

  // Confirm, then delete a (non-main) projection scenario.
  function requestDeleteScenario(scenarioId: string) {
    const scenario = scenarios.find((entry) => entry.id === scenarioId);
    if (!scenario || scenarioId === scenarios[0]?.id) {
      return;
    }
    setFeedbackConfirm({
      title: `Delete "${scenario.name || "this scenario"}"?`,
      body: "This permanently removes this projection and its Gantt. Main Plan and other scenarios are unaffected. This can't be undone.",
      tone: "danger",
      confirmLabel: "Delete",
      cancelLabel: "Cancel",
      onConfirm: () => {
        setFeedbackConfirm(undefined);
        void deleteScenarioById(scenarioId);
      },
    });
  }

  async function deleteScenarioById(scenarioId: string) {
    if (isSwitchingScenario || scenarioId === scenarios[0]?.id) {
      return;
    }
    const wasActive = scenarioId === latestDerivedStateRef.current.scenario.id;
    setIsSwitchingScenario(true);
    setSaveState("loading");
    try {
      await deleteScenario(scenarioId);
      scenarioCacheRef.current.delete(scenarioId);
      const list = await refreshScenarioList();

      // If the deleted scenario was the one on screen, fall back to Main (instant from cache).
      if (wasActive && list[0]?.id) {
        await loadScenarioIntoView(list[0].id);
      }
      setSaveState("saved");
      notifyFeedback({
        title: "Scenario deleted",
        body: "The projection was removed. Main Plan is unaffected.",
        tone: "success",
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unable to delete the scenario.";
      setSaveError(message);
      setSaveState("error");
      notifyFeedback({ title: "Delete failed", body: message, tone: "danger" });
    } finally {
      setIsSwitchingScenario(false);
    }
  }

  // Duplicate the active scenario into a new independent high-level projection, then switch to it.
  async function duplicateActiveScenario() {
    if (isSwitchingScenario) {
      return;
    }
    // The RPC copies from the DB, so flush local edits first (same guard as switching).
    const ok = await ensureSavedBeforeScenarioAction(
      "Can't duplicate yet",
      "Your changes couldn't be saved, so the scenario was not duplicated. Resolve the save error and try again.",
    );
    if (!ok) {
      return;
    }

    setIsSwitchingScenario(true);
    setSaveState("loading");
    try {
      const sourceLabel = isMainScenario ? "Main Plan" : derivedState.scenario.name || "Scenario";
      const newId = await duplicateScenario(derivedState.scenario.id, `${sourceLabel} copy`);
      await refreshScenarioList();
      await loadScenarioIntoView(newId);
      setSaveState("saved");
      notifyFeedback({
        title: "Scenario duplicated",
        body: `Created "${sourceLabel} copy" as an independent projection (high-level Gantt, no progress).`,
        tone: "success",
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unable to duplicate the scenario.";
      setSaveError(message);
      setSaveState("error");
      notifyFeedback({ title: "Duplicate failed", body: message, tone: "danger" });
    } finally {
      setIsSwitchingScenario(false);
    }
  }

  // Edit a (non-main) scenario's projection target. Optimistically updates local state so the active
  // scenario's takt re-flags the Gantt immediately, then persists.
  async function editScenarioTarget(scenarioId: string, targetOutput: number, targetOutputPeriod: string) {
    const previous = scenarios.find((scenario) => scenario.id === scenarioId);
    const applyTarget = (units: number, period: string) => {
      setScenarios((current) =>
        current.map((scenario) =>
          scenario.id === scenarioId ? { ...scenario, targetOutput: units, targetOutputPeriod: period } : scenario,
        ),
      );
      if (scenarioId === latestDerivedStateRef.current.scenario.id) {
        setPlannerState((current) => ({
          ...current,
          scenario: { ...current.scenario, targetOutput: units, targetOutputPeriod: period },
        }));
      }
    };
    applyTarget(targetOutput, targetOutputPeriod);
    try {
      await updateScenarioTarget(scenarioId, targetOutput, targetOutputPeriod);
    } catch (error) {
      if (previous) {
        applyTarget(previous.targetOutput, previous.targetOutputPeriod);
      }
      notifyFeedback({
        title: "Couldn't save target",
        body: error instanceof Error ? error.message : "The scenario target could not be saved.",
        tone: "danger",
      });
    }
  }

  return {
    isSwitchingScenario,
    setIsSwitchingScenario,
    switchTargetId,
    ensureSavedBeforeScenarioAction,
    loadScenarioIntoView,
    refreshScenarioList,
    switchScenario,
    renameScenarioById,
    requestDeleteScenario,
    editScenarioTarget,
    duplicateActiveScenario,
  };
}
