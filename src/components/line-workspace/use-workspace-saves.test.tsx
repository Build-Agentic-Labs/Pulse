import { act, renderHook } from "@testing-library/react";
import { useRef, useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { emptyPlannerState } from "@/domain/empty-planner-state";
import { PRODUCT_MASTER_BOM_FIELD, getMasterBom, type MasterBom } from "@/domain/master-bom";
import { saveMasterBomToSupabase, savePlannerShellToSupabase, type SaveState } from "@/domain/supabase-planner";
import type { PlannerState, Product } from "@/domain/types";
import { writeCachedPlannerState } from "@/lib/planner-state-cache";
import { deferredPromise as deferred, procedureTestTask } from "./procedure-test-fixtures";
import { createProcedureSaveQueueStore } from "./use-procedure-save-queue";
import { usePlannerShellAutosave, useWorkspaceSaves, type UsePlannerShellAutosaveOptions } from "./use-workspace-saves";

vi.mock("@/domain/supabase-planner", async (original) => ({
  ...await original<typeof import("@/domain/supabase-planner")>(),
  saveMasterBomToSupabase: vi.fn(),
  savePlannerShellToSupabase: vi.fn(),
}));
vi.mock("@/lib/planner-state-cache", async (original) => ({
  ...await original<typeof import("@/lib/planner-state-cache")>(),
  writeCachedPlannerState: vi.fn(async () => undefined),
}));

const PROJECT_ID = "project-saves";
const saveBom = vi.mocked(saveMasterBomToSupabase);
const saveShell = vi.mocked(savePlannerShellToSupabase);
const notifyFeedback = vi.fn();
const flushDeferredRemoteRefresh = vi.fn();

const confirmedBom: MasterBom = { fileName: "rev-a.xlsx", columns: ["Part"], rows: [{ Part: "100-1" }] };
const replacementBom: MasterBom = { fileName: "rev-b.xlsx", columns: ["Part"], rows: [{ Part: "200-2" }] };

const plannerTask = procedureTestTask("Fit the bracket", 1, { name: "Assemble" });
const initialState: PlannerState = {
  ...emptyPlannerState,
  product: { ...emptyPlannerState.product, customFields: { [PRODUCT_MASTER_BOM_FIELD]: confirmedBom } },
  tasks: [plannerTask],
};

function productWithBom(bom: MasterBom): Product {
  return {
    ...initialState.product,
    customFields: { ...initialState.product.customFields, [PRODUCT_MASTER_BOM_FIELD]: bom },
    updatedAt: "2026-10-03T12:00:00.000Z",
  };
}

function renderSaves({ confirmed = true } = {}) {
  return renderHook(() => {
    const [plannerState, setPlannerState] = useState<PlannerState>(initialState);
    const latestDerivedStateRef = useRef(plannerState);
    latestDerivedStateRef.current = plannerState;
    const mainScenarioIdRef = useRef<string | undefined>("scenario-main");
    const remoteStateConfirmedRef = useRef(confirmed);
    const scenarioCacheRef = useRef(new Map<string, PlannerState>());
    const [procedureSaveQueues] = useState(createProcedureSaveQueueStore);
    const [chromeStatus, setChromeStatus] = useState<{ message: string; error?: boolean } | null>(null);
    const [reportedSaveState, setSaveState] = useState<SaveState>("loading");
    const [reportedSaveError, setSaveError] = useState<string>();
    const plannerDirtyRef = useRef(false);
    const saves = useWorkspaceSaves({
      projectId: PROJECT_ID,
      mainScenarioIdRef,
      latestDerivedStateRef,
      setPlannerState,
      notifyFeedback,
      blockViewOnlyWrite: () => false,
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
    });
    return { plannerState, saves, procedureSaveQueues, chromeStatus, scenarioCacheRef, setSaveState, setSaveError };
  });
}

beforeEach(() => {
  vi.useFakeTimers();
  saveBom.mockReset();
  saveShell.mockReset();
  notifyFeedback.mockClear();
  flushDeferredRemoteRefresh.mockClear();
  vi.mocked(writeCachedPlannerState).mockClear();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("save barrier", () => {
  it("lets a BOM retry pass its own failure while unrelated failures still block", async () => {
    const { result } = renderSaves();
    act(() => {
      result.current.saves.writeTracker.begin("master-bom")(new Error("BOM failed"));
      result.current.setSaveError("BOM failed");
      result.current.setSaveState("error");
    });

    await expect(result.current.saves.waitForLocalSavesToSettle(1_000, "master-bom")).resolves.toBe(true);
    await expect(result.current.saves.waitForLocalSavesToSettle(1_000)).resolves.toBe(false);

    act(() => {
      result.current.saves.writeTracker.begin("tool:step-1:wrench")(new Error("Tool failed"));
    });
    await expect(result.current.saves.waitForLocalSavesToSettle(1_000, "master-bom")).resolves.toBe(false);
  });

  it("waits for active writes and procedure queues to drain, and gives up at the timeout", async () => {
    const { result } = renderSaves();
    let finishPhoto!: (error?: unknown) => void;
    act(() => {
      finishPhoto = result.current.saves.writeTracker.begin("photo-upload:task-1:step-1");
    });

    const settled = result.current.saves.waitForLocalSavesToSettle(1_000, "master-bom");
    await vi.advanceTimersByTimeAsync(360);
    act(() => finishPhoto());
    await vi.advanceTimersByTimeAsync(120);
    await expect(settled).resolves.toBe(true);

    // A debounced procedure save that has not started yet still holds the barrier.
    result.current.procedureSaveQueues.procedureSaveTimersRef.current["task-1"] = 1;
    const debounced = result.current.saves.waitForLocalSavesToSettle(500);
    await vi.advanceTimersByTimeAsync(700);
    await expect(debounced).resolves.toBe(false);
    result.current.procedureSaveQueues.procedureSaveTimersRef.current = {};

    result.current.procedureSaveQueues.getProcedureTaskSaveQueue("task-1").inFlight = true;
    const timedOut = result.current.saves.waitForLocalSavesToSettle(500);
    await vi.advanceTimersByTimeAsync(700);
    await expect(timedOut).resolves.toBe(false);
  });
});

describe("master BOM", () => {
  it("keeps the confirmed BOM after a failure and applies the verified one on retry", async () => {
    saveBom.mockRejectedValueOnce(new Error("Storage offline")).mockResolvedValueOnce(productWithBom(replacementBom));
    const { result } = renderSaves();

    await act(async () => {
      await expect(result.current.saves.updateMasterBom(replacementBom)).rejects.toThrow("Storage offline");
    });
    expect(getMasterBom(result.current.plannerState.product.customFields)?.fileName).toBe("rev-a.xlsx");
    expect(result.current.saves.saveState).toBe("error");
    expect(notifyFeedback).toHaveBeenCalledWith(expect.objectContaining({ title: "BOM save failed" }));

    await act(async () => {
      await result.current.saves.updateMasterBom(replacementBom);
    });
    expect(getMasterBom(result.current.plannerState.product.customFields)?.fileName).toBe("rev-b.xlsx");
    expect(result.current.saves.saveState).toBe("saved");
    expect(result.current.saves.writeTracker.getSnapshot()).toEqual({ pending: 0, failures: [] });
    expect(getMasterBom(result.current.scenarioCacheRef.current.get(initialState.scenario.id)?.product.customFields)?.fileName)
      .toBe("rev-b.xlsx");
    expect(writeCachedPlannerState).toHaveBeenCalledWith(PROJECT_ID, expect.anything(), "scenario-main");
  });

  it("queues shell saves behind the BOM save and sends them with the verified BOM", async () => {
    const bomSave = deferred<Product>();
    saveBom.mockReturnValueOnce(bomSave.promise);
    saveShell.mockResolvedValue(undefined as never);
    const { result } = renderSaves();

    let bomDone!: Promise<void>;
    await act(async () => {
      bomDone = result.current.saves.updateMasterBom(replacementBom);
    });
    const editedState = { ...initialState, tasks: [{ ...plannerTask, name: "Assemble frame" }] };
    await act(async () => {
      await result.current.saves.persistPlannerState(editedState);
    });
    expect(saveShell).not.toHaveBeenCalled();
    expect(result.current.saves.blockMasterBomNavigation()).toBe(true);

    await act(async () => {
      bomSave.resolve(productWithBom(replacementBom));
      await bomDone;
    });
    expect(saveShell).toHaveBeenCalledTimes(1);
    const shellState = saveShell.mock.calls[0]?.[0];
    expect(shellState?.tasks[0]?.name).toBe("Assemble frame");
    expect(getMasterBom(shellState?.product.customFields)?.fileName).toBe("rev-b.xlsx");
    expect(result.current.saves.blockMasterBomNavigation()).toBe(false);
  });

  it("refuses to save before the remote load confirms the state", async () => {
    const { result } = renderSaves({ confirmed: false });
    await expect(result.current.saves.updateMasterBom(replacementBom)).rejects.toThrow(/still loading/);
    act(() => result.current.saves.markDirty());
    act(() => result.current.saves.flushPendingPlannerSave());
    expect(saveBom).not.toHaveBeenCalled();
    expect(saveShell).not.toHaveBeenCalled();
  });
});

describe("navigation guards", () => {
  it("blocks in-app links and unload only while local work is unsaved, and flushes on page hide", async () => {
    saveShell.mockResolvedValue(undefined as never);
    const { result } = renderSaves();
    const link = document.createElement("a");
    link.href = "#settings";
    document.body.append(link);

    const freeClick = new MouseEvent("click", { bubbles: true, cancelable: true });
    link.dispatchEvent(freeClick);
    expect(freeClick.defaultPrevented).toBe(false);

    act(() => result.current.saves.markDirty());
    const blockedClick = new MouseEvent("click", { bubbles: true, cancelable: true });
    act(() => {
      link.dispatchEvent(blockedClick);
    });
    expect(blockedClick.defaultPrevented).toBe(true);
    expect(result.current.chromeStatus).toEqual({
      message: "Your changes are saving automatically. Wait for Saved before leaving this page.",
      error: true,
    });

    const unload = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(unload);
    expect(unload.defaultPrevented).toBe(true);

    await act(async () => {
      window.dispatchEvent(new Event("pagehide"));
    });
    expect(saveShell).toHaveBeenCalledWith(result.current.plannerState);
    link.remove();
  });
});

describe("shell autosave", () => {
  function renderAutosave(overrides: Partial<UsePlannerShellAutosaveOptions> = {}) {
    const persistPlannerState = vi.fn(async () => undefined);
    const options: UsePlannerShellAutosaveOptions = {
      dirtyVersion: 0,
      plannerDirtyRef: { current: true },
      plannerSaveTimerRef: { current: null },
      persistPlannerState,
      derivedState: initialState,
      hasLoadedRemoteState: true,
      remoteStateConfirmedRef: { current: true },
      remoteRefreshAppliedRef: { current: false },
      ...overrides,
    };
    const hook = renderHook((props: UsePlannerShellAutosaveOptions) => usePlannerShellAutosave(props), { initialProps: options });
    return { ...hook, options, persistPlannerState };
  }

  it("debounces user edits for 900 ms and saves only the latest state", async () => {
    const { options, rerender, persistPlannerState } = renderAutosave();
    const firstEdit = { ...initialState, tasks: [{ ...plannerTask, name: "One" }] };
    const secondEdit = { ...initialState, tasks: [{ ...plannerTask, name: "Two" }] };
    rerender({ ...options, dirtyVersion: 1, derivedState: firstEdit });
    await vi.advanceTimersByTimeAsync(899);
    rerender({ ...options, dirtyVersion: 2, derivedState: secondEdit });
    expect(options.plannerSaveTimerRef.current).not.toBeNull();
    await vi.advanceTimersByTimeAsync(900);

    expect(persistPlannerState).toHaveBeenCalledTimes(1);
    expect(persistPlannerState).toHaveBeenCalledWith(secondEdit);
    expect(options.plannerSaveTimerRef.current).toBeNull();
  });

  it("never saves an unconfirmed snapshot, and skips one server-applied change", async () => {
    const unconfirmed = renderAutosave({ remoteStateConfirmedRef: { current: false } });
    unconfirmed.rerender({ ...unconfirmed.options, dirtyVersion: 1 });
    await vi.advanceTimersByTimeAsync(2_000);
    expect(unconfirmed.persistPlannerState).not.toHaveBeenCalled();

    const echoed = renderAutosave({ remoteRefreshAppliedRef: { current: true } });
    echoed.rerender({ ...echoed.options, dirtyVersion: 1 });
    await vi.advanceTimersByTimeAsync(2_000);
    expect(echoed.persistPlannerState).not.toHaveBeenCalled();
    expect(echoed.options.remoteRefreshAppliedRef.current).toBe(false);
    echoed.rerender({ ...echoed.options, dirtyVersion: 2 });
    await vi.advanceTimersByTimeAsync(900);
    expect(echoed.persistPlannerState).toHaveBeenCalledTimes(1);
  });
});
