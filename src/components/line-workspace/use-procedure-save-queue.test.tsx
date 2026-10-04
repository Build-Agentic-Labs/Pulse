import { act, renderHook } from "@testing-library/react";
import { useRef, useState } from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { emptyPlannerState } from "@/domain/empty-planner-state";
import { saveProcedureTaskUpdateToSupabase, type SaveState } from "@/domain/supabase-planner";
import type { PlannerState, Task } from "@/domain/types";
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

const notifyFeedback = vi.fn();
const flushDeferredRemoteRefresh = vi.fn();

function renderQueue({ viewOnly = false } = {}) {
  return renderHook(() => {
    const [plannerState, setPlannerState] = useState<PlannerState>({ ...emptyPlannerState, tasks: [task("server text")] });
    const latestDerivedStateRef = useRef(plannerState);
    latestDerivedStateRef.current = plannerState;
    const mainScenarioIdRef = useRef<string | undefined>("scenario-main");
    const remoteRefreshAppliedRef = useRef(false);
    const [store] = useState(createProcedureSaveQueueStore);
    const [saveState, setSaveState] = useState<SaveState>("saved");
    const [saveError, setSaveError] = useState<string>();
    const drafts = useProcedureDrafts({
      projectId: "project-queue",
      mainScenarioIdRef,
      latestDerivedStateRef,
      setPlannerState,
      queueProbe: store,
    });
    const queue = useProcedureSaveQueue({
      store,
      drafts,
      projectId: "project-queue",
      mainScenarioIdRef,
      latestDerivedStateRef,
      setPlannerState,
      setSaveState,
      setSaveError,
      notifyFeedback,
      blockViewOnlyWrite: () => viewOnly,
      remoteRefreshAppliedRef,
      flushDeferredRemoteRefresh,
    });
    return { plannerState, saveState, saveError, drafts, queue, store };
  });
}

function savedInstruction(callIndex: number) {
  return save.mock.calls[callIndex]?.[0].manufacturingSteps?.[0]?.instruction;
}

beforeEach(() => {
  vi.useFakeTimers();
  save.mockReset();
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
