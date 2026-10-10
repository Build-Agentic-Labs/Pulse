// @vitest-environment jsdom
import { act, renderHook } from "@testing-library/react";
import { useState, type SetStateAction } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AWI_TASK_LINK_FIELD, withLinkedAwiProcedure, type LinkedAwiMaster } from "@/domain/awi-task-link";
import { emptyPlannerState } from "@/domain/empty-planner-state";
import { loadLinkedAwiMasters } from "@/domain/supabase-planner";
import type { PlannerState, Task } from "@/domain/types";
import { useLinkedAwiRefresh } from "./use-linked-awi-refresh";

vi.mock("@/domain/supabase-planner", () => ({ loadLinkedAwiMasters: vi.fn() }));

const base: Task = {
  id: "product-task", scenarioId: "scenario", stationId: "station", rowType: "task", wbs: "1", name: "Assembly",
  plannedStart: "2026-10-01T08:00:00.000Z", plannedFinish: "2026-10-01T08:05:00.000Z",
  plannedDurationMinutes: 5, plannedOperators: 2, plannedManHours: 1 / 6, status: "not_started", percentComplete: 0,
  dependencyIds: [], criticalPath: false, bottleneckFlag: false, qualityGate: false, travelerSignoffRequired: false,
  customFields: {}, manufacturingSteps: [], partReferences: [],
};
const link = { masterId: "master", projectId: "master-project", taskId: "master-task", documentNumber: "AWI-0001" };
const master = (duration: number, noSteps = false): Task => ({
  ...base, id: link.taskId, plannedDurationMinutes: duration,
  manufacturingSteps: noSteps ? [] : [{ id: "step", name: "Fit", sequence: 1, instruction: "Fit part", durationMinutes: duration }],
});
const linked = (id = base.id, source = master(5)): Task => withLinkedAwiProcedure({
  ...base, id, customFields: { [AWI_TASK_LINK_FIELD]: link },
}, source);
const masters = (source: Task): Map<string, LinkedAwiMaster> => new Map([
  [link.masterId, { projectId: link.projectId, taskId: link.taskId, source }],
]);
const state = (tasks = [linked()]): PlannerState => ({
  ...emptyPlannerState, product: { ...emptyPlannerState.product, projectId: "product-project" },
  scenario: { ...emptyPlannerState.scenario, id: "scenario" }, tasks,
});
function setup(initial = state()) {
  return renderHook(() => {
    const [plannerState, setPlannerState] = useState(initial);
    return { plannerState, setPlannerState, ...useLinkedAwiRefresh({ plannerState, setPlannerState }) };
  });
}
function deferredMasters() {
  let resolve!: (value: Map<string, LinkedAwiMaster>) => void;
  const promise = new Promise<Map<string, LinkedAwiMaster>>((done) => { resolve = done; });
  vi.mocked(loadLinkedAwiMasters).mockReturnValueOnce(promise);
  return resolve;
}

describe("useLinkedAwiRefresh", () => {
  beforeEach(() => {
    vi.mocked(loadLinkedAwiMasters).mockReset();
    Object.defineProperty(document, "visibilityState", { configurable: true, value: "visible" });
  });

  it("refreshes two links in one batch on return, without refreshing on mount", async () => {
    const initial = state([linked("first"), linked("second"), base]);
    vi.mocked(loadLinkedAwiMasters).mockResolvedValue(masters(master(20)));
    const { result } = setup(initial);
    expect(loadLinkedAwiMasters).not.toHaveBeenCalled();
    await act(async () => {
      document.dispatchEvent(new Event("visibilitychange"));
      window.dispatchEvent(new Event("focus"));
    });
    expect(loadLinkedAwiMasters).toHaveBeenCalledExactlyOnceWith(initial.tasks.slice(0, 2));
    expect(result.current.plannerState.tasks.map((task) => task.plannedDurationMinutes)).toEqual([20, 20, 5]);
    expect(result.current.plannerState.tasks[0].plannedFinish).toBe("2026-10-01T08:20:00.000Z");
    expect(result.current.plannerState.tasks[0].plannedOperators).toBe(2);
    expect(result.current.plannerState.tasks[2]).toBe(base);
  });

  it.each(["scenario", "project"])("drops a late response after a %s change even when task IDs are reused", async (scope) => {
    const resolve = deferredMasters();
    const { result } = setup();
    let pending!: Promise<void>;
    act(() => { pending = result.current.refreshLinkedAwi(); });
    const next = state();
    if (scope === "scenario") next.scenario = { ...next.scenario, id: "other-scenario" };
    else next.product = { ...next.product, projectId: "other-project" };
    act(() => result.current.setPlannerState(next));
    await act(async () => { resolve(masters(master(20))); await pending; });
    expect(result.current.plannerState).toBe(next);
  });

  it.each([false, true])("keeps a fresher same-scenario procedure or duration-only load (no steps: %s)", async (noSteps) => {
    const resolve = deferredMasters();
    const { result } = setup(state([linked(base.id, master(5, noSteps))]));
    let pending!: Promise<void>;
    act(() => { pending = result.current.refreshLinkedAwi(); });
    const fresher = state([linked(base.id, master(20, noSteps))]);
    act(() => result.current.setPlannerState(fresher));
    await act(async () => { resolve(masters(master(5, noSteps))); await pending; });
    expect(result.current.plannerState).toBe(fresher);
    expect(result.current.plannerState.tasks[0].plannedDurationMinutes).toBe(20);
  });

  it("checks scope again when a queued state updater runs", async () => {
    const initial = state();
    const setPlannerState = vi.fn<(action: SetStateAction<PlannerState>) => void>();
    vi.mocked(loadLinkedAwiMasters).mockResolvedValue(masters(master(20)));
    const { result } = renderHook(() => useLinkedAwiRefresh({ plannerState: initial, setPlannerState }));
    await act(async () => result.current.refreshLinkedAwi());
    const update = setPlannerState.mock.calls[0][0];
    expect(typeof update).toBe("function");
    if (typeof update !== "function") throw new Error("Expected functional update");
    const next = { ...initial, scenario: { ...initial.scenario, id: "other-scenario" } };
    expect(update(next)).toBe(next);
  });

  it("makes no request and keeps state identity when no tasks are linked", async () => {
    const initial = state([base]);
    const { result } = setup(initial);
    await act(async () => {
      await result.current.refreshLinkedAwi();
      window.dispatchEvent(new Event("focus"));
    });
    expect(loadLinkedAwiMasters).not.toHaveBeenCalled();
    expect(result.current.plannerState).toBe(initial);
  });

  it("preserves state identity when the master is unchanged", async () => {
    const initial = state();
    vi.mocked(loadLinkedAwiMasters).mockResolvedValue(masters(master(5)));
    const { result } = setup(initial);
    await act(async () => result.current.refreshLinkedAwi());
    expect(result.current.plannerState).toBe(initial);
  });
});
