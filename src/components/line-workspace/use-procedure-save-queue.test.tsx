import { act, renderHook } from "@testing-library/react";
import { useRef, useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { emptyPlannerState } from "@/domain/empty-planner-state";
import { saveProcedureTaskUpdateToSupabase, saveTaskPhotoAnnotationsToSupabase, type SaveState } from "@/domain/supabase-planner";
import type { StepPhotoAnnotationMap } from "@/domain/step-photos";
import type { PlannerState, Task } from "@/domain/types";
import { writeCachedPlannerState } from "@/lib/planner-state-cache";
import { deferredPromise as deferred, procedureTestTask as task } from "./procedure-test-fixtures";
import { useProcedureDrafts } from "./use-procedure-drafts";
import { createProcedureSaveQueueStore, useProcedureSaveQueue } from "./use-procedure-save-queue";

vi.mock("@/domain/supabase-planner", async (original) => ({
  ...await original<typeof import("@/domain/supabase-planner")>(),
  saveProcedureTaskUpdateToSupabase: vi.fn(),
  saveTaskPhotoAnnotationsToSupabase: vi.fn(),
}));
vi.mock("@/lib/planner-state-cache", async (original) => ({
  ...await original<typeof import("@/lib/planner-state-cache")>(),
  writeCachedPlannerState: vi.fn(async () => undefined),
}));

const save = vi.mocked(saveProcedureTaskUpdateToSupabase);
const saveAnnotations = vi.mocked(saveTaskPhotoAnnotationsToSupabase);

const notifyFeedback = vi.fn();
const flushDeferredRemoteRefresh = vi.fn();

const PROJECT_ID = "project-queue";

// A loaded planner state belongs to a project and scenario, as in the workspace.
function plannerStateFor(projectId: string, tasks: Task[]): PlannerState {
  return {
    ...emptyPlannerState,
    product: { ...emptyPlannerState.product, id: `product-${projectId}`, projectId },
    scenario: { ...emptyPlannerState.scenario, id: `scenario-${projectId}` },
    tasks,
  };
}

function renderQueue({ viewOnly = false } = {}) {
  return renderHook(({ projectId }: { projectId: string }) => {
    const [plannerState, setPlannerState] = useState<PlannerState>(() => plannerStateFor(PROJECT_ID, [task("server text")]));
    // Same contract as LineWorkspace: the scope on screen is the current project prop and scenario.
    const foregroundRef = useRef({ projectId, scenarioId: plannerState.scenario.id });
    foregroundRef.current = { projectId, scenarioId: plannerState.scenario.id };
    const [isForegroundSaveScope] = useState(() => (scope: { projectId?: string; scenarioId: string }) =>
      scope.projectId === foregroundRef.current.projectId && scope.scenarioId === foregroundRef.current.scenarioId);
    const latestDerivedStateRef = useRef(plannerState);
    latestDerivedStateRef.current = plannerState;
    const mainScenarioIdRef = useRef<string | undefined>("scenario-main");
    const remoteRefreshAppliedRef = useRef(false);
    const [store] = useState(createProcedureSaveQueueStore);
    const [saveState, setSaveState] = useState<SaveState>("saved");
    const [saveError, setSaveError] = useState<string>();
    const drafts = useProcedureDrafts({
      projectId,
      mainScenarioIdRef,
      latestDerivedStateRef,
      setPlannerState,
      queueProbe: store,
    });
    const queue = useProcedureSaveQueue({
      store,
      drafts,
      projectId,
      mainScenarioIdRef,
      latestDerivedStateRef,
      setPlannerState,
      setSaveState,
      setSaveError,
      notifyFeedback,
      blockViewOnlyWrite: () => viewOnly,
      remoteRefreshAppliedRef,
      flushDeferredRemoteRefresh,
      isForegroundSaveScope,
    });
    return { plannerState, setPlannerState, saveState, saveError, drafts, queue, store, remoteRefreshAppliedRef };
  }, { initialProps: { projectId: PROJECT_ID } });
}

function savedInstruction(callIndex: number) {
  return save.mock.calls[callIndex]?.[0].manufacturingSteps?.[0]?.instruction;
}

beforeEach(() => {
  vi.useFakeTimers();
  save.mockReset();
  saveAnnotations.mockReset();
  vi.mocked(writeCachedPlannerState).mockClear();
  notifyFeedback.mockClear();
  flushDeferredRemoteRefresh.mockClear();
  window.localStorage.clear();
});

afterEach(() => {
  vi.useRealTimers();
});

it("debounces field edits for 750 ms, saves the draft-applied task, and settles clean", async () => {
  save.mockResolvedValueOnce(task("typed", 2));
  const { result } = renderQueue();

  act(() => {
    result.current.queue.updateProcedureStepField("task-1", "step-1", "instruction", "typed");
  });
  expect(result.current.saveState).toBe("draft");
  await act(async () => { await vi.advanceTimersByTimeAsync(749); });
  expect(save).not.toHaveBeenCalled();
  await act(async () => { await vi.advanceTimersByTimeAsync(1); });

  expect(save).toHaveBeenCalledTimes(1);
  expect(savedInstruction(0)).toBe("typed");
  expect(save.mock.calls[0]?.[2]).toBe("project-queue");
  expect(result.current.saveState).toBe("saved");
  expect(result.current.store.procedureSaveActivity()[0]).toMatchObject({ state: "idle", inFlight: false, pending: false });
  // The field is still focused, so its now-clean draft stays until blur.
  expect(Object.values(result.current.drafts.procedureDraftsRef.current)[0]).toMatchObject({
    value: "typed",
    dirty: false,
    saveStatus: "saved",
  });
  expect(result.current.plannerState.tasks[0]?.version).toBe(2);
  expect(flushDeferredRemoteRefresh).toHaveBeenCalled();
});

it("retries a transient failure after 2.5 s with the latest edits", async () => {
  save.mockRejectedValueOnce(new Error("Network down")).mockResolvedValueOnce(task("typed again", 2));
  const { result } = renderQueue();

  act(() => {
    result.current.queue.updateProcedureStepField("task-1", "step-1", "instruction", "typed");
  });
  await act(async () => { await vi.advanceTimersByTimeAsync(750); });
  expect(save).toHaveBeenCalledTimes(1);
  expect(result.current.saveState).toBe("retrying");
  expect(result.current.store.procedureSaveActivity()[0]).toMatchObject({ state: "retrying", pending: true });
  expect(notifyFeedback).toHaveBeenCalledWith(expect.objectContaining({ title: "Save failed - retrying", tone: "warning" }));
  expect(Object.keys(result.current.store.procedureRetryTimersRef.current)).toEqual(["task-1"]);

  act(() => {
    result.current.queue.updateProcedureStepField("task-1", "step-1", "instruction", "typed again");
  });
  // A newer edit replaces the retry with an ordinary debounce.
  expect(result.current.store.procedureRetryTimersRef.current).toEqual({});
  await act(async () => { await vi.advanceTimersByTimeAsync(750); });

  expect(save).toHaveBeenCalledTimes(2);
  expect(savedInstruction(1)).toBe("typed again");
  expect(result.current.saveState).toBe("saved");
  expect(result.current.store.procedureSaveActivity()[0]?.lastError).toBeUndefined();
});

it("waits 2.5 s before retrying when nothing new was typed", async () => {
  save.mockRejectedValueOnce(new Error("Network down")).mockResolvedValueOnce(task("typed", 2));
  const { result } = renderQueue();

  act(() => {
    result.current.queue.updateProcedureStepField("task-1", "step-1", "instruction", "typed");
  });
  await act(async () => { await vi.advanceTimersByTimeAsync(750); });
  await act(async () => { await vi.advanceTimersByTimeAsync(2499); });
  expect(save).toHaveBeenCalledTimes(1);
  await act(async () => { await vi.advanceTimersByTimeAsync(1); });
  // The retry reschedules through the normal 750 ms debounce.
  await act(async () => { await vi.advanceTimersByTimeAsync(749); });
  expect(save).toHaveBeenCalledTimes(1);
  await act(async () => { await vi.advanceTimersByTimeAsync(1); });

  expect(save).toHaveBeenCalledTimes(2);
  expect(savedInstruction(1)).toBe("typed");
  expect(result.current.saveState).toBe("saved");
});

it("stops on a conflict instead of retrying, keeping the draft for the user", async () => {
  save.mockRejectedValueOnce(new Error("Version conflict: the step changed"));
  const { result } = renderQueue();

  act(() => {
    result.current.queue.updateProcedureStepField("task-1", "step-1", "instruction", "mine");
  });
  await act(async () => { await vi.advanceTimersByTimeAsync(750); });
  await act(async () => { await vi.advanceTimersByTimeAsync(10_000); });

  expect(save).toHaveBeenCalledTimes(1);
  expect(result.current.saveState).toBe("error");
  expect(result.current.store.procedureRetryTimersRef.current).toEqual({});
  expect(result.current.store.procedureSaveActivity()[0]).toMatchObject({ state: "conflict", pending: true });
  expect(Object.values(result.current.drafts.procedureDraftsRef.current)[0]).toMatchObject({
    value: "mine",
    dirty: true,
    saveStatus: "conflict",
  });
  expect(notifyFeedback).toHaveBeenCalledWith(expect.objectContaining({ title: "Save conflict", tone: "danger" }));
});

it("drains edits made during a save immediately, rebased on the confirmed versions, without replaying the old timer", async () => {
  const first = deferred<Task>();
  save.mockReturnValueOnce(first.promise).mockResolvedValueOnce(task("B", 3));
  const { result } = renderQueue();

  act(() => {
    result.current.queue.updateProcedureStepField("task-1", "step-1", "instruction", "A");
  });
  await act(async () => { await vi.advanceTimersByTimeAsync(750); });
  expect(save).toHaveBeenCalledTimes(1);

  act(() => {
    result.current.queue.updateProcedureStepField("task-1", "step-1", "instruction", "B");
  });
  expect(Object.keys(result.current.store.procedureSaveTimersRef.current)).toEqual(["task-1"]);

  await act(async () => { first.resolve(task("A", 2)); });

  // The completion does not acknowledge B, and starts B right away using A's confirmed versions.
  expect(save).toHaveBeenCalledTimes(2);
  const second = save.mock.calls[1]?.[0];
  expect(second?.manufacturingSteps?.[0]).toMatchObject({ instruction: "B", version: 2 });
  expect(second?.version).toBe(2);
  expect(result.current.store.procedureSaveTimersRef.current).toEqual({});

  await act(async () => { await vi.advanceTimersByTimeAsync(2_000); });
  expect(save).toHaveBeenCalledTimes(2);
  expect(result.current.plannerState.tasks[0]?.manufacturingSteps?.[0]?.instruction).toBe("B");
  expect(Object.values(result.current.drafts.procedureDraftsRef.current)[0]).toMatchObject({ value: "B", dirty: false });
  expect(result.current.saveState).toBe("saved");
});

it("flushes debounced saves immediately when the scope is left and cancels pending retries", async () => {
  save.mockResolvedValue(task("leaving", 2));
  const { result } = renderQueue();

  act(() => {
    result.current.queue.updateProcedureStepField("task-1", "step-1", "instruction", "leaving");
  });
  result.current.store.procedureRetryTimersRef.current["task-other"] = window.setTimeout(() => {
    throw new Error("cancelled retry must not run");
  }, 2_500);

  await act(async () => {
    result.current.queue.flushScheduledProcedureSaves();
  });

  expect(save).toHaveBeenCalledTimes(1);
  expect(savedInstruction(0)).toBe("leaving");
  expect(result.current.store.procedureSaveTimersRef.current).toEqual({});
  expect(result.current.store.procedureRetryTimersRef.current).toEqual({});
  await act(async () => { await vi.advanceTimersByTimeAsync(5_000); });
  expect(save).toHaveBeenCalledTimes(1);
});

it("drops a queued save without writing when the user only has view access", async () => {
  const { result } = renderQueue({ viewOnly: true });

  act(() => {
    result.current.queue.updateProcedureStepField("task-1", "step-1", "instruction", "not allowed");
  });
  await act(async () => { await vi.advanceTimersByTimeAsync(750); });

  expect(save).not.toHaveBeenCalled();
  expect(result.current.saveState).toBe("idle");
  expect(result.current.store.hasProcedureSaveWork()).toBe(false);
});

it("saves to the project of the render that scheduled the edit after an in-place project switch", async () => {
  save.mockResolvedValue(task("typed before the switch", 2));
  const { result, rerender } = renderQueue();
  act(() => {
    result.current.queue.updateProcedureStepField("task-1", "step-1", "instruction", "typed before the switch");
  });
  rerender({ projectId: "project-other" });
  await act(async () => { await vi.advanceTimersByTimeAsync(750); });

  expect(save).toHaveBeenCalledTimes(1);
  expect(save.mock.calls[0]?.[2]).toBe("project-queue");
});

it("merges rapid edits into one save sent 750 ms after the last keystroke", async () => {
  save.mockResolvedValue(task("ab", 2));
  const { result } = renderQueue();

  act(() => {
    result.current.queue.updateProcedureStepField("task-1", "step-1", "instruction", "a");
  });
  await act(async () => { await vi.advanceTimersByTimeAsync(500); });
  act(() => {
    result.current.queue.updateProcedureStepField("task-1", "step-1", "instruction", "ab");
  });
  expect(Object.keys(result.current.store.procedureSaveTimersRef.current)).toEqual(["task-1"]);
  await act(async () => { await vi.advanceTimersByTimeAsync(749); });
  expect(save).not.toHaveBeenCalled();
  await act(async () => { await vi.advanceTimersByTimeAsync(1); });
  await act(async () => { await vi.advanceTimersByTimeAsync(3_000); });

  expect(save).toHaveBeenCalledTimes(1);
  expect(savedInstruction(0)).toBe("ab");
});

it("retries from the latest task state, not the failed attempt's snapshot", async () => {
  save.mockRejectedValueOnce(new Error("Network down")).mockResolvedValueOnce(task("typed", 6));
  const { result } = renderQueue();

  act(() => {
    result.current.queue.updateProcedureStepField("task-1", "step-1", "instruction", "typed");
  });
  await act(async () => { await vi.advanceTimersByTimeAsync(750); });
  // Another device's change lands through a refresh during the retry wait.
  act(() => {
    result.current.setPlannerState((current) => ({
      ...current,
      tasks: current.tasks.map((entry) => ({ ...entry, version: 5, description: "refreshed elsewhere" })),
    }));
  });
  await act(async () => { await vi.advanceTimersByTimeAsync(2_500 + 750); });

  expect(save).toHaveBeenCalledTimes(2);
  expect(save.mock.calls[1]?.[0]).toMatchObject({ version: 5, description: "refreshed elsewhere" });
  expect(savedInstruction(1)).toBe("typed");
});

it("feeds the live queue state to draft merges through the store probe", async () => {
  const pendingSave = deferred<Task>();
  save.mockReturnValueOnce(pendingSave.promise);
  const { result } = renderQueue();
  const local = task("server text", 1, { description: "local typing" });
  const server = task("server text", 1, { description: "server value" });

  act(() => {
    result.current.queue.updateProcedureStepField("task-1", "step-1", "instruction", "typed");
  });
  expect(Object.keys(result.current.store.pendingDraftSnapshot("task-1") ?? {})).toEqual(["task-1:step-1:instruction"]);
  const merge = () => result.current.drafts.mergeServerTaskIntoLocalTask(local, server, {}, { source: "realtime" });
  expect(merge().description).toBe("local typing");

  await act(async () => { await vi.advanceTimersByTimeAsync(750); });
  expect(merge().description).toBe("local typing");

  await act(async () => { pendingSave.resolve(task("typed", 2)); });
  expect(result.current.store.hasPendingProcedureSaveWork("task-1")).toBe(false);
  expect(merge().description).toBe("server value");
});

describe("annotation-only saves", () => {
  const firstBase: StepPhotoAnnotationMap = {};
  const laterBase: StepPhotoAnnotationMap = {};

  it("coalesce into one annotation merge that keeps the first baseline", async () => {
    saveAnnotations.mockResolvedValue(task("server text", 2));
    const { result } = renderQueue();
    const tasks = result.current.plannerState.tasks;

    act(() => {
      result.current.queue.scheduleProcedureTaskSave(tasks[0]!, tasks, firstBase);
      result.current.queue.scheduleProcedureTaskSave(tasks[0]!, tasks, laterBase);
    });
    await act(async () => { await vi.advanceTimersByTimeAsync(750); });

    expect(save).not.toHaveBeenCalled();
    expect(saveAnnotations).toHaveBeenCalledTimes(1);
    expect(saveAnnotations.mock.calls[0]?.[1]).toBe(firstBase);
    expect(saveAnnotations.mock.calls[0]?.[2]).toBe("project-queue");
  });

  it("fall back to the full procedure save when a field edit joins them", async () => {
    save.mockResolvedValue(task("typed", 2));
    const { result } = renderQueue();
    const tasks = result.current.plannerState.tasks;

    act(() => {
      result.current.queue.scheduleProcedureTaskSave(tasks[0]!, tasks, firstBase);
      result.current.queue.updateProcedureStepField("task-1", "step-1", "instruction", "typed");
    });
    await act(async () => { await vi.advanceTimersByTimeAsync(750); });

    expect(saveAnnotations).not.toHaveBeenCalled();
    expect(save).toHaveBeenCalledTimes(1);
  });

  it("retry with their original baseline after a failure", async () => {
    saveAnnotations.mockRejectedValueOnce(new Error("Network down")).mockResolvedValueOnce(task("server text", 2));
    const { result } = renderQueue();
    const tasks = result.current.plannerState.tasks;

    act(() => {
      result.current.queue.scheduleProcedureTaskSave(tasks[0]!, tasks, firstBase);
    });
    await act(async () => { await vi.advanceTimersByTimeAsync(750 + 2_500 + 750); });

    expect(save).not.toHaveBeenCalled();
    expect(saveAnnotations).toHaveBeenCalledTimes(2);
    expect(saveAnnotations.mock.calls[1]?.[1]).toBe(firstBase);
  });
});

it("writes the confirmed task to the cache of the project that issued the save", async () => {
  const pendingSave = deferred<Task>();
  save.mockReturnValueOnce(pendingSave.promise);
  const { result, rerender } = renderQueue();

  act(() => {
    result.current.queue.updateProcedureStepField("task-1", "step-1", "instruction", "typed");
  });
  await act(async () => { await vi.advanceTimersByTimeAsync(750); });
  rerender({ projectId: "project-other" });
  await act(async () => { pendingSave.resolve(task("typed", 2)); });

  const cacheWrites = vi.mocked(writeCachedPlannerState).mock.calls;
  expect(cacheWrites).toHaveLength(1);
  expect(cacheWrites[0]?.[0]).toBe("project-queue");
  expect(cacheWrites[0]?.[1].tasks[0]).toMatchObject({ version: 2 });
  expect(cacheWrites[0]?.[2]).toBe("scenario-main");
});
