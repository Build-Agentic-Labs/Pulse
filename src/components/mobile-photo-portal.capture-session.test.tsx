// @vitest-environment jsdom
// Characterization of the mobile capture-session behaviour (timer start/stop/lap, park on task switch,
// resume, localStorage session persistence, legacy-key recovery, malformed data, storage failures) as
// observed through the rendered portal. Written before the capture-session utilities were extracted
// (docs/edit-reliability-baseline-2026-10-04.md §4) and kept unchanged across the move. These tests
// describe current behaviour; where that behaviour is a known gap, the test says so and does not assert
// the desirable outcome.
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { emptyPlannerState } from "@/domain/empty-planner-state";
import type { PlannerState, Task } from "@/domain/types";
import { mobileAuth } from "@/test-support/mobile-auth";
import { MobilePhotoPortal } from "./mobile-photo-portal";
import { loadPlannerStateFromSupabase, saveMobileStepToSupabase } from "@/domain/supabase-planner";

vi.mock("@/components/app-flow-panels", () => ({ AppLoadingShell: () => <div>Loading</div> }));
vi.mock("@/domain/supabase-planner", async (original) => ({
  ...await original<typeof import("@/domain/supabase-planner")>(),
  createPlannerSupabaseClient: () => mobileAuth.client,
  loadPlannerStateFromSupabase: vi.fn(),
  loadTaskFromSupabase: vi.fn(),
  loadToolLibraryFromSupabase: vi.fn(async () => []),
  subscribePlannerStateChanges: vi.fn(() => () => undefined),
  saveMobileStepToSupabase: vi.fn(),
  syncStepToolsForStepToSupabase: vi.fn(async () => undefined),
  saveTaskToSupabase: vi.fn(),
  deletePlannerTask: vi.fn(async () => undefined),
}));

const SESSION_KEY = "pulse:mobile-capture-session-v2:user-test:p";
const LEGACY_KEY = "pulse:capture-timer:p";
const baseTask: Task = {
  id: "task-a", scenarioId: "scenario-empty", stationId: "", wbs: "1", rowType: "task", name: "Alpha process",
  plannedStart: "2026-10-01T10:00:00Z", plannedFinish: "2026-10-01T10:00:00Z", plannedDurationMinutes: 0,
  plannedOperators: 1, plannedManHours: 0, status: "not_started", percentComplete: 0, dependencyIds: [],
  criticalPath: false, bottleneckFlag: false, qualityGate: false, travelerSignoffRequired: false,
  manufacturingSteps: [], customFields: {},
};
const taskB: Task = { ...baseTask, id: "task-b", wbs: "2", name: "Beta process" };
const state: PlannerState = {
  ...emptyPlannerState,
  product: { ...emptyPlannerState.product, projectId: "p", name: "Test project" },
  tasks: [baseTask, taskB],
};

let nowMs = 1_700_000_000_000;
const advance = (ms: number) => { nowMs += ms; };
const session = () => JSON.parse(localStorage.getItem(SESSION_KEY) ?? "null");

beforeEach(() => {
  mobileAuth.userId = "user-test";
  vi.clearAllMocks();
  localStorage.clear();
  nowMs = 1_700_000_000_000;
  vi.spyOn(Date, "now").mockImplementation(() => nowMs);
  vi.mocked(loadPlannerStateFromSupabase).mockResolvedValue(state);
  vi.mocked(saveMobileStepToSupabase).mockImplementation(async (_task, step) => ({ ...step, version: 1 }));
  window.scrollTo = vi.fn();
  window.scrollBy = vi.fn();
  HTMLElement.prototype.scrollTo = vi.fn();
  HTMLElement.prototype.scrollIntoView = vi.fn();
  window.matchMedia = vi.fn(() => ({ matches: true, addEventListener: vi.fn(), removeEventListener: vi.fn() })) as unknown as typeof window.matchMedia;
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

async function openTask(name: RegExp) {
  fireEvent.click(await screen.findByRole("button", { name }));
}
const startTimer = () => fireEvent.click(screen.getByTitle(/^Start timer for /));
const stopTimer = () => fireEvent.click(screen.getByTitle(/^Stop timer for /));
const backToList = () => fireEvent.click(screen.getByRole("button", { name: "Process list" }));
const durationInput = () => screen.getByLabelText(/^Duration/).closest("label")!.querySelector("input") as HTMLInputElement;
const processName = () => (screen.getByLabelText("Process name") as HTMLInputElement).value;

describe("capture timer: start, stop and lap", () => {
  it("starting a timer persists a running session with the elapsed time frozen into storedElapsedMs", async () => {
    render(<MobilePhotoPortal projectId="p" initialPlannerState={state} />);
    await openTask(/Alpha process 0 steps/);
    startTimer();
    expect(session().captureTimer).toMatchObject({ running: true, taskId: "task-a", taskName: "Alpha process", startedAt: null, storedElapsedMs: 0 });
    expect(session()).toMatchObject({ activeScreen: "detail", selectedTaskId: "task-a" });
    expect(localStorage.getItem(LEGACY_KEY)).toBeNull();
  });

  it("binds the timer to the open draft step and shows the lap", async () => {
    render(<MobilePhotoPortal projectId="p" initialPlannerState={state} />);
    await openTask(/Alpha process 0 steps/);
    fireEvent.click(screen.getByRole("button", { name: "Add step" }));
  await screen.findByRole("textbox", { name: "New step name" });
    startTimer();
    expect(session().captureTimer.activeStepId).toEqual(expect.any(String));
    expect(session().newStepId).toBe(session().captureTimer.activeStepId);
    expect(screen.getByText(/Step lap 0:00/)).toBeInTheDocument();
  });

  it("stopping applies the lap, rounded up to whole minutes, to the timed draft step and clears the timer", async () => {
    render(<MobilePhotoPortal projectId="p" initialPlannerState={state} />);
    await openTask(/Alpha process 0 steps/);
    fireEvent.click(screen.getByRole("button", { name: "Add step" }));
  await screen.findByRole("textbox", { name: "New step name" });
    startTimer();
    advance(125_000); // 2 min 5 s → ceil → 3
    stopTimer();
    await waitFor(() => expect(saveMobileStepToSupabase).toHaveBeenCalled());
    expect(vi.mocked(saveMobileStepToSupabase).mock.calls.at(-1)?.[2]).toMatchObject({ durationMinutes: 3 });
    expect(durationInput().value).toBe("3");
    expect(session().captureTimer).toMatchObject({ running: false, taskId: null, activeStepId: null, storedElapsedMs: 0 });
    expect(screen.queryByTitle(/^Stop timer for /)).toBeNull();
  });

  it("a lap under one minute still records one minute", async () => {
    render(<MobilePhotoPortal projectId="p" initialPlannerState={state} />);
    await openTask(/Alpha process 0 steps/);
    fireEvent.click(screen.getByRole("button", { name: "Add step" }));
  await screen.findByRole("textbox", { name: "New step name" });
    startTimer();
    advance(4_000);
    stopTimer();
    await waitFor(() => expect(saveMobileStepToSupabase).toHaveBeenCalled());
    expect(vi.mocked(saveMobileStepToSupabase).mock.calls.at(-1)?.[2]).toMatchObject({ durationMinutes: 1 });
  });

  it("stopping a timer with no elapsed time writes nothing", async () => {
    render(<MobilePhotoPortal projectId="p" initialPlannerState={state} />);
    await openTask(/Alpha process 0 steps/);
    fireEvent.click(screen.getByRole("button", { name: "Add step" }));
  await screen.findByRole("textbox", { name: "New step name" });
    startTimer();
    stopTimer();
    await act(async () => {});
    expect(saveMobileStepToSupabase).not.toHaveBeenCalled();
  });

  it("stopping the timer while Save & start next lap is in flight does not re-arm a lap on the stopped timer", async () => {
    render(<MobilePhotoPortal projectId="p" initialPlannerState={state} />);
    await openTask(/Alpha process 0 steps/);
    fireEvent.click(screen.getByRole("button", { name: "Add step" }));
    await screen.findByRole("textbox", { name: "New step name" });
    fireEvent.change(screen.getByRole("textbox", { name: "New step name" }), { target: { value: "Timed step" } });
    await waitFor(() => expect(screen.getByRole("status").textContent).toBe("Saved"));
    startTimer();
    let releaseSave: () => void = () => undefined;
    vi.mocked(saveMobileStepToSupabase).mockImplementationOnce((_task, step) =>
      new Promise((resolve) => { releaseSave = () => resolve({ ...step, version: 2 }); }));
    fireEvent.click(screen.getByRole("button", { name: "Save & start next lap" }));
    stopTimer();
    expect(session().captureTimer).toMatchObject({ running: false, taskId: null, activeStepId: null });
    await waitFor(() => expect(saveMobileStepToSupabase).toHaveBeenCalledTimes(2)); // the held Save & next write
    await act(async () => { releaseSave(); });
    await screen.findByPlaceholderText("New step 2");
    // The stopped timer stays cleared: no step-bound lap on a timer that belongs to no task.
    expect(session().captureTimer).toMatchObject({ running: false, taskId: null, activeStepId: null });
  });
});

describe("capture timer: park on task switch and resume", () => {
  it("switching tasks parks the running timer with its draft and shows a header chip for it", async () => {
    render(<MobilePhotoPortal projectId="p" initialPlannerState={state} />);
    await openTask(/Alpha process 0 steps/);
    fireEvent.click(screen.getByRole("button", { name: "Add step" }));
  await screen.findByRole("textbox", { name: "New step name" });
    fireEvent.change(screen.getByRole("textbox", { name: "New step name" }), { target: { value: "Timed step" } });
    startTimer();
    advance(65_000);
    backToList();
    await openTask(/Beta process 0 steps/);
    const parked = session().parkedCaptureByTaskId["task-a"];
    expect(parked).toMatchObject({ showNewStepForm: true, draftName: "Timed step", draftDurationText: "5" });
    expect(parked.timer).toMatchObject({ running: true, taskId: "task-a", startedAt: null, storedElapsedMs: 65_000 });
    expect(session().captureTimer).toMatchObject({ running: false, taskId: null });
    expect(screen.getByTitle("Open Alpha process · timer running")).toHaveTextContent("1:05");
    expect(screen.queryByRole("textbox", { name: "New step name" })).toBeNull();
  });

  it("returning to the parked task resumes its timer and draft and empties the parked map", async () => {
    render(<MobilePhotoPortal projectId="p" initialPlannerState={state} />);
    await openTask(/Alpha process 0 steps/);
    fireEvent.click(screen.getByRole("button", { name: "Add step" }));
  await screen.findByRole("textbox", { name: "New step name" });
    fireEvent.change(screen.getByRole("textbox", { name: "New step name" }), { target: { value: "Timed step" } });
    startTimer();
    advance(65_000);
    backToList();
    await openTask(/Beta process 0 steps/);
    advance(10_000);
    fireEvent.click(screen.getByTitle("Open Alpha process · timer running"));
    await screen.findByRole("textbox", { name: "New step name" });
    expect((screen.getByRole("textbox", { name: "New step name" }) as HTMLInputElement).value).toBe("Timed step");
    expect(session().parkedCaptureByTaskId).toEqual({});
    expect(session().captureTimer).toMatchObject({ running: true, taskId: "task-a", storedElapsedMs: 75_000 });
    expect(screen.getByTitle(/^Stop timer for Alpha process/)).toBeInTheDocument();
  });

  it("Timer on a task whose timer is stopped but still bound resumes rather than restarting", async () => {
    render(<MobilePhotoPortal projectId="p" initialPlannerState={state} />);
    await openTask(/Alpha process 0 steps/);
    fireEvent.click(screen.getByRole("button", { name: "Add step" }));
  await screen.findByRole("textbox", { name: "New step name" });
    startTimer();
    advance(30_000);
    backToList();
    await openTask(/Beta process 0 steps/);
    advance(30_000);
    await openTask(/Alpha process/);
    // The parked timer kept running while away: 60 s total, not reset to 0.
    expect(session().captureTimer).toMatchObject({ running: true, taskId: "task-a", storedElapsedMs: 60_000 });
  });

  it("a timer started without an open draft is bound to no step: it persists but shows no header chip on the list", async () => {
    render(<MobilePhotoPortal projectId="p" initialPlannerState={state} />);
    await openTask(/Alpha process 0 steps/);
    startTimer();
    expect(session().captureTimer).toMatchObject({ running: true, taskId: "task-a", activeStepId: null });
    // Without a bound step there is no chip and no Stop control even on the detail screen.
    expect(screen.queryByTitle(/^Stop timer for /)).toBeNull();
    backToList();
    expect(session()).toMatchObject({ activeScreen: "list" });
    expect(session().captureTimer).toMatchObject({ running: true, taskId: "task-a" });
    expect(screen.queryByTitle(/Open Alpha process/)).toBeNull();
  });

  it("leaving to the process list keeps a step-bound timer running and its header chip reopens the task", async () => {
    render(<MobilePhotoPortal projectId="p" initialPlannerState={state} />);
    await openTask(/Alpha process 0 steps/);
    fireEvent.click(screen.getByRole("button", { name: "Add step" }));
  await screen.findByRole("textbox", { name: "New step name" });
    startTimer();
    backToList();
    expect(session()).toMatchObject({ activeScreen: "list" });
    expect(session().captureTimer).toMatchObject({ running: true, taskId: "task-a" });
    fireEvent.click(screen.getByTitle("Open Alpha process · timer running"));
    expect(session()).toMatchObject({ activeScreen: "detail", selectedTaskId: "task-a" });
    expect(processName()).toBe("Alpha process");
  });
});

describe("capture session: reload hydration", () => {
  it("restores a running timer, the detail screen and the open draft from the session key", async () => {
    localStorage.setItem(SESSION_KEY, JSON.stringify({
      captureTimer: { running: true, startedAt: null, storedElapsedMs: 30_000, lapMarkerMs: 0, activeStepId: "step-x", taskId: "task-a", taskName: "Alpha process" },
      parkedCaptureByTaskId: {},
      activeScreen: "detail", selectedTaskId: "task-a", showNewStepForm: true, newStepId: "step-x",
    }));
    render(<MobilePhotoPortal projectId="p" initialPlannerState={state} />);
    await screen.findByRole("textbox", { name: "New step name" });
    expect(screen.getByRole("button", { name: "Process list" })).toBeInTheDocument();
    expect(screen.getByTitle(/^Stop timer for Alpha process/)).toBeInTheDocument();
    expect(screen.getByText("0:30")).toBeInTheDocument();
    expect(session().captureTimer).toMatchObject({ running: true, storedElapsedMs: 30_000, startedAt: null });
  });

  it("restores parked timers as running and keeps counting from the stored elapsed", async () => {
    localStorage.setItem(SESSION_KEY, JSON.stringify({
      captureTimer: { running: false, startedAt: null, storedElapsedMs: 0, lapMarkerMs: 0, activeStepId: null, taskId: null, taskName: "" },
      parkedCaptureByTaskId: {
        "task-b": {
          timer: { running: true, startedAt: null, storedElapsedMs: 120_000, lapMarkerMs: 0, activeStepId: "step-y", taskId: "task-b", taskName: "Beta process" },
          showNewStepForm: true, newStepId: "step-y", draftInstruction: "", draftDurationText: "5", draftTools: [], draftPhotos: [], draftChecks: [],
        },
      },
      activeScreen: "list", selectedTaskId: "task-a", showNewStepForm: false, newStepId: null,
    }));
    render(<MobilePhotoPortal projectId="p" initialPlannerState={state} />);
    await screen.findByTitle("Open Beta process · timer running");
    expect(screen.getByTitle("Open Beta process · timer running")).toHaveTextContent("2:00");
    await act(async () => {});
    advance(5_000);
    await waitFor(() => expect(screen.getByTitle("Open Beta process · timer running")).toHaveTextContent("2:05"), { timeout: 2000 });
    fireEvent(window, new Event("pagehide"));
    expect(session().parkedCaptureByTaskId["task-b"].timer.storedElapsedMs).toBe(125_000);
  });

  it("a deleted task selection never opens its draft on the fallback task", async () => {
    localStorage.setItem(SESSION_KEY, JSON.stringify({
      captureTimer: { running: false, startedAt: null, storedElapsedMs: 0, lapMarkerMs: 0, activeStepId: null, taskId: null, taskName: "" },
      parkedCaptureByTaskId: {}, activeScreen: "detail", selectedTaskId: "task-gone", showNewStepForm: true, newStepId: "step-z",
    }));
    render(<MobilePhotoPortal projectId="p" initialPlannerState={state} />);
    await screen.findByRole("button", { name: "Process list" });
    expect(processName()).toBe("Alpha process");
    expect(screen.queryByRole("textbox", { name: "New step name" })).toBeNull();
    expect(session()).toMatchObject({ selectedTaskId: "task-a", showNewStepForm: false, newStepId: null });
  });
});

describe("capture session: legacy key, malformed data and storage failures", () => {
  it("preserves an unowned legacy timer without automatically hydrating it into an account", async () => {
    const legacy = JSON.stringify({ running: true, startedAt: null, storedElapsedMs: 45_000, lapMarkerMs: 0, activeStepId: "step-legacy", taskId: "task-a", taskName: "Alpha process" });
    localStorage.setItem(LEGACY_KEY, legacy);
    render(<MobilePhotoPortal projectId="p" initialPlannerState={state} />);
    await screen.findByRole("button", { name: /Alpha process 0 steps/ });
    expect(screen.queryByRole("textbox", { name: "New step name" })).toBeNull();
    expect(localStorage.getItem(LEGACY_KEY)).toBe(legacy);
  });

  it("a legacy timer without a task opens the list with no draft", async () => {
    localStorage.setItem(LEGACY_KEY, JSON.stringify({ running: false, storedElapsedMs: 10_000, taskId: null, activeStepId: null }));
    render(<MobilePhotoPortal projectId="p" initialPlannerState={state} />);
    await screen.findByRole("button", { name: /Alpha process 0 steps/ });
    expect(screen.queryByRole("button", { name: "Process list" })).toBeNull();
    expect(screen.queryByRole("textbox", { name: "New step name" })).toBeNull();
  });

  it("malformed session JSON is ignored and replaced by the next state write", async () => {
    localStorage.setItem(SESSION_KEY, "{not json");
    render(<MobilePhotoPortal projectId="p" initialPlannerState={state} />);
    await screen.findByRole("button", { name: /Alpha process 0 steps/ });
    expect(screen.queryByRole("button", { name: "Process list" })).toBeNull();
    await openTask(/Alpha process 0 steps/);
    expect(session()).toMatchObject({ activeScreen: "detail", selectedTaskId: "task-a" });
  });

  it("a session whose timer lacks a boolean running flag is treated as absent", async () => {
    localStorage.setItem(SESSION_KEY, JSON.stringify({ captureTimer: { storedElapsedMs: 9_000 }, activeScreen: "detail", selectedTaskId: "task-a" }));
    render(<MobilePhotoPortal projectId="p" initialPlannerState={state} />);
    await screen.findByRole("button", { name: /Alpha process 0 steps/ });
    expect(screen.queryByRole("button", { name: "Process list" })).toBeNull();
  });

  it("a parked entry without a task or step id is dropped; other entries keep defaults", async () => {
    localStorage.setItem(SESSION_KEY, JSON.stringify({
      captureTimer: { running: false, storedElapsedMs: 0 },
      parkedCaptureByTaskId: {
        "task-a": { timer: { running: false, storedElapsedMs: 5_000 } },
        "task-b": { timer: { running: false, storedElapsedMs: 5_000, taskId: "task-b", activeStepId: "step-b" }, draftTools: ["T", 7], draftChecks: "no" },
      },
      activeScreen: "list", selectedTaskId: "task-a",
    }));
    render(<MobilePhotoPortal projectId="p" initialPlannerState={state} />);
    await screen.findByRole("button", { name: /Alpha process 0 steps/ });
    await waitFor(() => expect(session().parkedCaptureByTaskId["task-b"]).toBeTruthy());
    expect(session().parkedCaptureByTaskId["task-a"]).toBeUndefined();
    expect(session().parkedCaptureByTaskId["task-b"]).toMatchObject({ newStepId: "step-b", draftDurationText: "5", draftTools: ["T"], draftChecks: [], draftInstruction: "", showNewStepForm: false });
  });

  it("a storage write failure is swallowed and the timer keeps working in memory", async () => {
    render(<MobilePhotoPortal projectId="p" initialPlannerState={state} />);
    await openTask(/Alpha process 0 steps/);
    fireEvent.click(screen.getByRole("button", { name: "Add step" }));
  await screen.findByRole("textbox", { name: "New step name" });
    const setItem = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new DOMException("quota", "QuotaExceededError"); });
    startTimer();
    expect(screen.getByTitle(/^Stop timer for Alpha process/)).toBeInTheDocument();
    expect(screen.queryByRole("alert")).toBeNull();
    expect(setItem).toHaveBeenCalled();
    setItem.mockRestore();
  });

  it("a selected task alone keeps the session persisted after returning to the list", async () => {
    render(<MobilePhotoPortal projectId="p" initialPlannerState={state} />);
    await openTask(/Alpha process 0 steps/);
    backToList();
    expect(session()).toMatchObject({ activeScreen: "list", selectedTaskId: "task-a", showNewStepForm: false });
  });

  it("an absent task does not delete the previous session or an unowned legacy timer", async () => {
    // The stored selection points at a task the loaded project does not have; the load resolves the
    // selection to "" and the resulting empty session is removed along with the legacy key.
    const empty: PlannerState = { ...state, tasks: [] };
    vi.mocked(loadPlannerStateFromSupabase).mockResolvedValue(empty);
    localStorage.setItem(LEGACY_KEY, "{}");
    localStorage.setItem(SESSION_KEY, JSON.stringify({ captureTimer: { running: false, storedElapsedMs: 0 }, activeScreen: "list", selectedTaskId: "task-gone" }));
    render(<MobilePhotoPortal projectId="p" />);
    await screen.findByRole("button", { name: "Add process" });
    expect(localStorage.getItem(SESSION_KEY)).not.toBeNull();
    expect(localStorage.getItem(LEGACY_KEY)).toBe("{}");
  });
});

describe("capture session: lifecycle around task switches and unmount", () => {
  it("typing in the draft and switching tasks flushes exactly one save before the switch", async () => {
    render(<MobilePhotoPortal projectId="p" initialPlannerState={state} />);
    await openTask(/Alpha process 0 steps/);
    fireEvent.click(screen.getByRole("button", { name: "Add step" }));
  await screen.findByRole("textbox", { name: "New step name" });
    fireEvent.change(screen.getByRole("textbox", { name: "New step name" }), { target: { value: "Fit bracket" } });
    backToList();
    await waitFor(() => expect(saveMobileStepToSupabase).toHaveBeenCalledTimes(1));
    expect(vi.mocked(saveMobileStepToSupabase).mock.calls[0][0]).toMatchObject({ id: "task-a" });
    await openTask(/Beta process 0 steps/);
    await act(async () => {});
    expect(saveMobileStepToSupabase).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("textbox", { name: "New step name" })).toBeNull();
  });

  it("unmounting cancels an unsent autosave instead of sending through a changed account", async () => {
    const view = render(<MobilePhotoPortal projectId="p" initialPlannerState={state} />);
    await openTask(/Alpha process 0 steps/);
    fireEvent.click(screen.getByRole("button", { name: "Add step" }));
  await screen.findByRole("textbox", { name: "New step name" });
    fireEvent.change(screen.getByRole("textbox", { name: "New step name" }), { target: { value: "Fit bracket" } });
    view.unmount();
    await new Promise((resolve) => setTimeout(resolve, 600));
    expect(saveMobileStepToSupabase).not.toHaveBeenCalled();
  });

  it("a late save response after switching tasks does not open a draft on the new task", async () => {
    let release!: () => void;
    vi.mocked(saveMobileStepToSupabase).mockImplementationOnce((_task, step) => new Promise((resolve) => { release = () => resolve({ ...step, version: 1 }); }));
    render(<MobilePhotoPortal projectId="p" initialPlannerState={state} />);
    await openTask(/Alpha process 0 steps/);
    fireEvent.click(screen.getByRole("button", { name: "Add step" }));
  await screen.findByRole("textbox", { name: "New step name" });
    fireEvent.change(screen.getByRole("textbox", { name: "New step name" }), { target: { value: "Fit bracket" } });
    backToList();
    await waitFor(() => expect(saveMobileStepToSupabase).toHaveBeenCalledTimes(1));
    await openTask(/Beta process 0 steps/);
    await act(async () => { release(); });
    expect(processName()).toBe("Beta process");
    expect(screen.queryByRole("textbox", { name: "New step name" })).toBeNull();
    expect(screen.getByRole("button", { name: "Add step" })).toBeInTheDocument();
  });

  it("a timer parked while its task switch is in progress is not written to the wrong task on stop", async () => {
    render(<MobilePhotoPortal projectId="p" initialPlannerState={state} />);
    await openTask(/Alpha process 0 steps/);
    fireEvent.click(screen.getByRole("button", { name: "Add step" }));
  await screen.findByRole("textbox", { name: "New step name" });
    startTimer();
    advance(70_000);
    backToList();
    await openTask(/Beta process 0 steps/);
    fireEvent.click(screen.getByTitle("Open Alpha process · timer running"));
    await screen.findByTitle(/^Stop timer for Alpha process/);
    stopTimer();
    await waitFor(() => expect(saveMobileStepToSupabase).toHaveBeenCalled());
    const lastCall = vi.mocked(saveMobileStepToSupabase).mock.calls.at(-1)!;
    expect(lastCall[0]).toMatchObject({ id: "task-a" });
    expect(lastCall[2]).toMatchObject({ durationMinutes: 2 });
  });
});


describe("linked AWI restored capture sessions", () => {
  const link = { awiMasterLink: { masterId: "m", projectId: "master-project", taskId: "master-task", documentNumber: "AWI-42" } };
  it("freezes a linked active timer without restoring its editor or header chip", async () => {
    const linkedState = { ...state, tasks: [{ ...baseTask, customFields: link }, taskB] };
    vi.mocked(loadPlannerStateFromSupabase).mockResolvedValue(linkedState);
    localStorage.setItem(SESSION_KEY, JSON.stringify({ captureTimer: { running: true, startedAt: null, storedElapsedMs: 30_000, lapMarkerMs: 0, activeStepId: "linked-step", taskId: "task-a", taskName: "Alpha process" }, parkedCaptureByTaskId: {}, activeScreen: "detail", selectedTaskId: "task-a", showNewStepForm: true, newStepId: "linked-step" }));
    render(<MobilePhotoPortal projectId="p" initialPlannerState={linkedState} />);
    await screen.findByText(/These steps come from master AWI AWI-42/);
    expect(screen.queryByTitle(/Open Alpha process/)).toBeNull();
    expect(screen.queryByTitle(/^Stop timer/)).toBeNull();
    expect(screen.queryByRole("textbox", { name: "New step name" })).toBeNull();
    advance(5_000);
    act(() => { window.dispatchEvent(new Event("pagehide")); });
    expect(session().captureTimer).toMatchObject({ running: false, startedAt: null, storedElapsedMs: 30_000, taskId: "task-a", activeStepId: "linked-step" });
    expect(saveMobileStepToSupabase).not.toHaveBeenCalled();
  });
  it("keeps linked parked text and frozen time when opening its task", async () => {
    const linkedState = { ...state, tasks: [baseTask, { ...taskB, customFields: link }] };
    vi.mocked(loadPlannerStateFromSupabase).mockResolvedValue(linkedState);
    localStorage.setItem(SESSION_KEY, JSON.stringify({ captureTimer: { running: false, startedAt: null, storedElapsedMs: 0, lapMarkerMs: 0, activeStepId: null, taskId: null, taskName: "" }, parkedCaptureByTaskId: { "task-b": { timer: { running: true, startedAt: null, storedElapsedMs: 120_000, lapMarkerMs: 0, activeStepId: "parked-step", taskId: "task-b", taskName: "Beta process" }, showNewStepForm: true, newStepId: "parked-step", draftName: "Parked draft", draftInstruction: "Keep me", draftDurationText: "5", draftTools: [], draftPhotos: [], draftChecks: [] } }, activeScreen: "list", selectedTaskId: "task-a", showNewStepForm: false, newStepId: null }));
    render(<MobilePhotoPortal projectId="p" initialPlannerState={linkedState} />);
    await screen.findByRole("button", { name: /Beta process 0 steps/ });
    expect(screen.queryByTitle(/Open Beta process/)).toBeNull();
    advance(5_000);
    await openTask(/Beta process 0 steps/);
    await screen.findByText(/An unsaved step from this phone is kept here:.*Parked draft.*Keep me/);
    expect(screen.queryByRole("textbox", { name: "New step name" })).toBeNull();
    expect(screen.queryByTitle(/^Stop timer/)).toBeNull();
    act(() => { window.dispatchEvent(new Event("pagehide")); });
    expect(session().parkedCaptureByTaskId["task-b"]).toMatchObject({ draftName: "Parked draft", draftInstruction: "Keep me", timer: { running: false, startedAt: null, storedElapsedMs: 120_000, activeStepId: "parked-step" } });
    expect(session().captureTimer.taskId).toBeNull();
    expect(saveMobileStepToSupabase).not.toHaveBeenCalled();
  });
});
