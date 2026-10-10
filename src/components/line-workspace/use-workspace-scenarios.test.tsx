import { act, renderHook } from "@testing-library/react";
import { useEffect, useRef, useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { emptyPlannerState } from "@/domain/empty-planner-state";
import { deleteScenario, loadPlannerStateFromSupabase, loadScenariosForProduct, savePlannerShellToSupabase, type SaveState } from "@/domain/supabase-planner";
import type { PlannerState, ScenarioSummary, Task } from "@/domain/types";
import { assertSaneStateDeletion } from "@/lib/planner/shell-store";
import type { FeedbackConfirm } from "../themed-feedback";
import { procedureTestTask } from "./procedure-test-fixtures";
import { createProcedureSaveQueueStore } from "./use-procedure-save-queue";
import { usePlannerShellAutosave, useWorkspaceSaves } from "./use-workspace-saves";
import { useWorkspaceScenarios } from "./use-workspace-scenarios";

vi.mock("@/domain/supabase-planner", async (original) => ({
  ...await original<typeof import("@/domain/supabase-planner")>(),
  deleteScenario: vi.fn(),
  loadPlannerStateFromSupabase: vi.fn(),
  loadScenariosForProduct: vi.fn(),
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
const deleteScenarioMock = vi.mocked(deleteScenario);
const loadScenarioList = vi.mocked(loadScenariosForProduct);

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
    const [feedbackConfirm, setFeedbackConfirm] = useState<FeedbackConfirm>();
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
      setFeedbackConfirm,
      notifyFeedback: vi.fn(),
      resetProcedureDrafts: vi.fn(),
      hasDirtyProcedureDrafts: () => false,
      recoverProcedureDraftSaves: vi.fn(),
      flushPendingPlannerSave: saves.flushPendingPlannerSave,
      waitForLocalSavesToSettle: () => saves.waitForLocalSavesToSettle(),
    });
    return { plannerState, setPlannerState, saves, scenarioActions, scenarioCacheRef, setScenarios, feedbackConfirm };
  });
}

beforeEach(() => {
  vi.useFakeTimers();
  loadScenario.mockReset();
  saveShell.mockReset();
  deleteScenarioMock.mockReset().mockResolvedValue(undefined);
  loadScenarioList.mockReset();
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

describe("scenario switching cache freshness", () => {
  it(
    "reloads a revisited scenario so its first shell save preserves tasks inserted remotely while away",
    async () => {
      const { result } = renderScenarioWorkspace();

      await switchTo(result, SCENARIO_B); // A -> B: first visit loads B from the server and caches it.
      expect(loadScenario).toHaveBeenCalledTimes(1);
      await switchTo(result, SCENARIO_A); // B -> A: reload Main after leaving it.
      expect(result.current.plannerState.scenario.id).toBe(SCENARIO_A);

      // While A is open, a teammate inserts a task into B. A's realtime scope does not cover B.
      serverTaskIds = { ...serverTaskIds, [SCENARIO_B]: [...serverTaskIds[SCENARIO_B]!, "task-b2-remote"] };

      await switchTo(result, SCENARIO_B); // A -> B: reload B with the remote insertion.
      expect(loadScenario).toHaveBeenCalledTimes(3);
      expect(result.current.plannerState.tasks.map((task) => task.id)).toEqual(["task-b1", "task-b2-remote"]);

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
      expect(saveShell.mock.calls[0]?.[0].tasks.map((task) => task.id)).toEqual(["task-b1", "task-b2-remote"]);
      expect(wouldDelete).toEqual([[]]);
    },
  );

  it("keeps only the active scenario cached after ordinary switches", async () => {
    const { result } = renderScenarioWorkspace();
    expect([...result.current.scenarioCacheRef.current.keys()]).toEqual([SCENARIO_A]);

    await switchTo(result, SCENARIO_B);
    expect([...result.current.scenarioCacheRef.current.keys()]).toEqual([SCENARIO_B]);

    await switchTo(result, SCENARIO_A);
    expect([...result.current.scenarioCacheRef.current.keys()]).toEqual([SCENARIO_A]);
  });

  it("uses a freshly written optimizer seed without reloading it", async () => {
    const { result } = renderScenarioWorkspace();
    const optimizedState = scenarioState("scenario-optimized", [scenarioTask("task-optimized", "scenario-optimized")]);
    // The optimizer caches its freshly persisted result immediately before loading it into view.
    result.current.scenarioCacheRef.current.set(optimizedState.scenario.id, optimizedState);

    await act(async () => {
      await result.current.scenarioActions.loadScenarioIntoView(optimizedState.scenario.id);
    });

    expect(loadScenario).not.toHaveBeenCalled();
    expect(result.current.plannerState.scenario.id).toBe(optimizedState.scenario.id);
    expect(result.current.plannerState.tasks.map((task) => task.id)).toEqual(["task-optimized"]);
  });

  it("reloads Main with remote tasks after confirming deletion of the active scenario", async () => {
    const { result } = renderScenarioWorkspace();
    const scenarioList: ScenarioSummary[] = [SCENARIO_A, SCENARIO_B].map((id) => ({
      id,
      name: id === SCENARIO_A ? "Main Plan" : "Projection B",
      targetOutput: 1,
      targetOutputPeriod: "day",
      createdAt: "2026-10-10T00:00:00Z",
    }));
    act(() => { result.current.setScenarios(scenarioList); });
    loadScenarioList.mockResolvedValue([scenarioList[0]!]);

    await switchTo(result, SCENARIO_B);
    serverTaskIds[SCENARIO_A]!.push("task-a2-remote");

    act(() => { result.current.scenarioActions.requestDeleteScenario(SCENARIO_B); });
    expect(result.current.feedbackConfirm?.confirmLabel).toBe("Delete");
    expect(deleteScenarioMock).not.toHaveBeenCalled();
    await act(async () => { result.current.feedbackConfirm!.onConfirm(); });

    expect(deleteScenarioMock).toHaveBeenCalledWith(SCENARIO_B);
    expect(loadScenarioList).toHaveBeenCalledWith("product-scenarios");
    expect(result.current.feedbackConfirm).toBeUndefined();
    expect(loadScenario).toHaveBeenCalledTimes(2);
    expect(result.current.plannerState.scenario.id).toBe(SCENARIO_A);
    expect(result.current.plannerState.tasks.map((task) => task.id)).toEqual(["task-a1", "task-a2-remote"]);
    expect([...result.current.scenarioCacheRef.current.keys()]).toEqual([SCENARIO_A]);
  });
});
