import { act, renderHook } from "@testing-library/react";
import { useEffect, useRef, useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { emptyPlannerState } from "@/domain/empty-planner-state";
import { loadPlannerStateFromSupabase, savePlannerShellToSupabase, type SaveState } from "@/domain/supabase-planner";
import type { PlannerState, ScenarioSummary, Task } from "@/domain/types";
import { assertSaneStateDeletion } from "@/lib/planner/shell-store";
import { procedureTestTask } from "./procedure-test-fixtures";
import { createProcedureSaveQueueStore } from "./use-procedure-save-queue";
import { usePlannerShellAutosave, useWorkspaceSaves } from "./use-workspace-saves";
import { useWorkspaceScenarios } from "./use-workspace-scenarios";

// CHARACTERIZATION ONLY (structure audit D5). Records how a switch back to a cached scenario behaves
// today; it does not assert the desired behavior. The fix is deferred to the owner.

vi.mock("@/domain/supabase-planner", async (original) => ({
  ...await original<typeof import("@/domain/supabase-planner")>(),
  loadPlannerStateFromSupabase: vi.fn(),
  savePlannerShellToSupabase: vi.fn(),
}));
vi.mock("@/lib/planner-state-cache", async (original) => ({
  ...await original<typeof import("@/lib/planner-state-cache")>(),
  writeCachedPlannerState: vi.fn(async () => undefined),
  clearCachedPlannerState: vi.fn(async () => undefined),
}));

const PROJECT_ID = "project-scenarios";
const SCENARIO_A = "scenario-a";
const SCENARIO_B = "scenario-b";
const loadScenario = vi.mocked(loadPlannerStateFromSupabase);
const saveShell = vi.mocked(savePlannerShellToSupabase);

function scenarioTask(id: string, scenarioId: string): Task {
  return { ...procedureTestTask(`${id} text`, 1, { id, name: id }), scenarioId };
}

function scenarioState(scenarioId: string, tasks: Task[]): PlannerState {
  return {
    ...emptyPlannerState,
    product: { ...emptyPlannerState.product, id: "product-scenarios", projectId: PROJECT_ID },
    scenario: { ...emptyPlannerState.scenario, id: scenarioId, productId: "product-scenarios", name: scenarioId },
    tasks,
  };
}

// The database's task ids per scenario. savePlannerShellToSupabase deletes every task of the saved scenario
// whose id is missing from the saved state; the mock records that set instead of writing.
let serverTaskIds: Record<string, string[]>;
let wouldDelete: string[][];

function renderScenarioWorkspace() {
  return renderHook(() => {
    const [plannerState, setPlannerState] = useState<PlannerState>(() =>
      scenarioState(SCENARIO_A, [scenarioTask("task-a1", SCENARIO_A)]));
    const latestDerivedStateRef = useRef(plannerState);
    latestDerivedStateRef.current = plannerState;
    const mainScenarioIdRef = useRef<string | undefined>(SCENARIO_A);
    const remoteStateConfirmedRef = useRef(true);
    const remoteRefreshAppliedRef = useRef(false);
    const plannerDirtyRef = useRef(false);
    const scenarioCacheRef = useRef(new Map<string, PlannerState>());
    const [procedureSaveQueues] = useState(createProcedureSaveQueueStore);
    const [, setChromeStatus] = useState<{ message: string; error?: boolean } | null>(null);
    const [reportedSaveState, setSaveState] = useState<SaveState>("saved");
    const [reportedSaveError, setSaveError] = useState<string>();
    const [scenarios, setScenarios] = useState<ScenarioSummary[]>([]);
    const fullyHydratedScenarioIdsRef = useRef(new Set<string>());
    const taskDetailHydrationRequestsRef = useRef(new Set<string>());

    // Mirror of LineWorkspace's cache effect: the active scenario's latest state is kept in the cache.
    useEffect(() => {
      scenarioCacheRef.current.set(plannerState.scenario.id, plannerState);
    }, [plannerState]);

    const saves = useWorkspaceSaves({
      projectId: PROJECT_ID,
      mainScenarioIdRef,
      latestDerivedStateRef,
      setPlannerState,
      notifyFeedback: vi.fn(),
      blockViewOnlyWrite: () => false,
      reportedSaveState,
      reportedSaveError,
      setSaveState,
      setSaveError,
      plannerDirtyRef,
      procedureSaveQueues,
      remoteStateConfirmedRef,
      scenarioCacheRef,
      flushDeferredRemoteRefresh: vi.fn(),
      setChromeStatus,
      isForegroundSaveScope: () => true,
    });
    usePlannerShellAutosave({
      dirtyVersion: saves.dirtyVersion,
      plannerDirtyRef,
      plannerSaveTimerRef: saves.plannerSaveTimerRef,
      persistPlannerState: saves.persistPlannerState,
      derivedState: plannerState,
      hasLoadedRemoteState: true,
      remoteStateConfirmedRef,
      remoteRefreshAppliedRef,
    });
    const scenarioActions = useWorkspaceScenarios({
      projectId: PROJECT_ID,
      derivedState: plannerState,
      isMainScenario: plannerState.scenario.id === SCENARIO_A,
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
      setTaskDetailHydrationStatus: vi.fn(),
      setSelectedTaskId: vi.fn(),
      setSelectedStationId: vi.fn(),
      setActiveZoneId: vi.fn(),
      setFocusedProcedureStepId: vi.fn(),
      setFeedbackConfirm: vi.fn(),
      notifyFeedback: vi.fn(),
      resetProcedureDrafts: vi.fn(),
      hasDirtyProcedureDrafts: () => false,
      recoverProcedureDraftSaves: vi.fn(),
      flushPendingPlannerSave: saves.flushPendingPlannerSave,
      waitForLocalSavesToSettle: () => saves.waitForLocalSavesToSettle(),
    });
    return { plannerState, setPlannerState, saves, scenarioActions };
  });
}

beforeEach(() => {
  vi.useFakeTimers();
  loadScenario.mockReset();
  saveShell.mockReset();
  serverTaskIds = { [SCENARIO_A]: ["task-a1"], [SCENARIO_B]: ["task-b1"] };
  wouldDelete = [];
  loadScenario.mockImplementation(async (_projectId, scenarioId) =>
    scenarioState(scenarioId!, serverTaskIds[scenarioId!]!.map((id) => scenarioTask(id, scenarioId!))));
  saveShell.mockImplementation(async (state) => {
    const existing = serverTaskIds[state.scenario.id] ?? [];
    const savedIds = state.tasks.map((task) => task.id);
    const stale = existing.filter((id) => !savedIds.includes(id));
    // The real save's mass-deletion tripwire, with the same counts it would see.
    assertSaneStateDeletion("tasks", existing.length, stale.length);
    wouldDelete.push(stale);
  });
});

afterEach(() => {
  vi.useRealTimers();
});

async function switchTo(result: ReturnType<typeof renderScenarioWorkspace>["result"], scenarioId: string) {
  await act(async () => {
    const switching = result.current.scenarioActions.switchScenario(scenarioId);
    await vi.advanceTimersByTimeAsync(240);
    await switching;
  });
}

describe("switching back to a cached scenario (D5 characterization)", () => {
  it(
    "OBSERVED: the cached snapshot is applied without a reload, so the first edit's shell save would delete " +
      "a task inserted server-side while another scenario was open (the deletion tripwire does not trip)",
    async () => {
      const { result } = renderScenarioWorkspace();

      await switchTo(result, SCENARIO_B); // A -> B: first visit loads B from the server and caches it.
      expect(loadScenario).toHaveBeenCalledTimes(1);
      await switchTo(result, SCENARIO_A); // B -> A: A is cached (mirror effect), no reload.
      expect(result.current.plannerState.scenario.id).toBe(SCENARIO_A);

      // While A is open, a teammate inserts a task into B. A's realtime scope does not cover B.
      serverTaskIds = { ...serverTaskIds, [SCENARIO_B]: [...serverTaskIds[SCENARIO_B]!, "task-b2-remote"] };

      await switchTo(result, SCENARIO_B); // A -> B: B is cached, applied as is.
      expect(loadScenario).toHaveBeenCalledTimes(1);
      expect(result.current.plannerState.tasks.map((task) => task.id)).toEqual(["task-b1"]);

      // One shell edit on B, then the 900 ms autosave.
      act(() => {
        result.current.saves.markDirty();
        result.current.setPlannerState((current) => ({
          ...current,
          tasks: current.tasks.map((task) => ({ ...task, name: "Renamed on B" })),
        }));
      });
      await act(async () => { await vi.advanceTimersByTimeAsync(900); });

      expect(saveShell).toHaveBeenCalledTimes(1);
      expect(saveShell.mock.calls[0]?.[0].scenario.id).toBe(SCENARIO_B);
      expect(saveShell.mock.calls[0]?.[0].tasks.map((task) => task.id)).toEqual(["task-b1"]);
      expect(wouldDelete).toEqual([["task-b2-remote"]]);
    },
  );
});
