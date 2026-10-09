// @vitest-environment jsdom
// Black-box characterization of LineWorkspace's loading, realtime and scenario lifecycle, written against
// the implementation BEFORE the Phase 3 extraction (docs/history/workspace-structure-plan.md) and kept unchanged
// through it: deferred refresh and its issuing scope, subscription stability, delayed-response isolation,
// selected-task media loading and retries, save-before-switch, unmount cleanup, and read counts.
import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { emptyPlannerState } from "@/domain/empty-planner-state";
import type { PlannerRealtimePayload } from "@/domain/supabase-planner";
import type { PlannerState, ScenarioSummary, Task } from "@/domain/types";
import type { AwiMaster } from "@/lib/awi/store";
import { reorderTasksInSupabase } from "@/lib/planner/task-order-store";
import {
  loadPlannerCoreStateFromSupabase,
  loadPlannerStateFromSupabase,
  loadScenariosForProduct,
  loadTaskFromSupabase,
  loadTaskPrivateMediaFromSupabase,
  loadToolLibraryFromSupabase,
  savePlannerShellToSupabase,
  subscribePlannerStateChanges,
} from "@/domain/supabase-planner";
import { LineWorkspace } from "./line-workspace";

type PlannerRealtimeScope = NonNullable<Parameters<typeof subscribePlannerStateChanges>[1]>;
import { PROJECT_SWITCH_EVENT, PROJECT_SWITCH_SESSION_KEY } from "./line-workspace/state";

const { router, fakeSupabaseClient } = vi.hoisted(() => {
  const empty = { data: null, error: null, count: 0 };
  const chain: unknown = new Proxy(() => undefined, {
    get: (_target, prop) => (prop === "then" ? (resolve: (value: typeof empty) => void) => resolve(empty) : chain),
    apply: () => chain,
  });
  return {
    router: { push: vi.fn(), replace: vi.fn(), prefetch: vi.fn(), back: vi.fn(), forward: vi.fn(), refresh: vi.fn() },
    fakeSupabaseClient: {
      auth: {
        getSession: async () => ({ data: { session: null }, error: null }),
        getUser: async () => ({ data: { user: null }, error: null }),
        onAuthStateChange: () => ({ data: { subscription: { unsubscribe: () => undefined } } }),
      },
      from: () => chain,
      rpc: () => chain,
      channel: () => chain,
      removeChannel: async () => "ok",
      storage: { from: () => chain },
    },
  };
});

vi.mock("next/navigation", () => ({
  useRouter: () => router,
  usePathname: () => "/projects/sync",
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock("@/lib/use-planner-presence", () => ({ usePlannerPresence: () => [] }));
vi.mock("@/lib/planner-state-cache", async (original) => ({
  ...await original<typeof import("@/lib/planner-state-cache")>(),
  readCachedMainPlannerStateSync: vi.fn(() => undefined),
  readCachedPlannerState: vi.fn(async () => undefined),
  writeCachedPlannerState: vi.fn(async () => undefined),
  clearCachedPlannerState: vi.fn(async () => undefined),
}));
vi.mock("@/lib/planner/task-order-store", async (original) => ({
  ...await original<typeof import("@/lib/planner/task-order-store")>(),
  reorderTasksInSupabase: vi.fn(),
}));
vi.mock("@/domain/supabase-planner", async (original) => ({
  ...await original<typeof import("@/domain/supabase-planner")>(),
  createPlannerSupabaseClient: vi.fn(() => fakeSupabaseClient),
  loadPlannerCoreStateFromSupabase: vi.fn(),
  loadPlannerStateFromSupabase: vi.fn(),
  loadScenariosForProduct: vi.fn(),
  loadToolLibraryFromSupabase: vi.fn(async () => []),
  loadTaskPrivateMediaFromSupabase: vi.fn(),
  loadTaskFromSupabase: vi.fn(),
  subscribePlannerStateChanges: vi.fn(),
  saveProcedureTaskUpdateToSupabase: vi.fn(async (task) => task),
  savePlannerShellToSupabase: vi.fn(async () => undefined),
}));

const PROJECT_A = "project-sync-a";
const PROJECT_B = "project-sync-b";
const MAIN_SCENARIO = "scenario-sync-main";
const NIGHT_SCENARIO = "scenario-sync-night";
const TASK_A = "task-sync-a";
const TASK_B = "task-sync-b";
const REALTIME_TASK_DEBOUNCE_MS = 250;
const REALTIME_FULL_DEBOUNCE_MS = 350;
const SHELL_AUTOSAVE_MS = 900;

function buildTask(id: string, scenarioId: string, instruction: string, overrides: Partial<Task> = {}): Task {
  return {
    id,
    scenarioId,
    stationId: "",
    rowType: "task",
    wbs: "1",
    name: `Task ${id}`,
    description: "",
    plannedStart: "0h",
    plannedFinish: "1h",
    plannedDurationMinutes: 60,
    plannedOperators: 1,
    plannedManHours: 1,
    status: "not_started",
    percentComplete: 0,
    dependencyIds: [],
    criticalPath: false,
    bottleneckFlag: false,
    qualityGate: false,
    travelerSignoffRequired: false,
    safetyNotes: "",
    manufacturingSteps: [{ id: `${id}-step`, sequence: 1, name: "Step", instruction, durationMinutes: 1, qualityCheck: "", version: 1 }],
    partReferences: [],
    customFields: {},
    version: 1,
    ...overrides,
  };
}

function buildState(projectId: string, scenarioId = MAIN_SCENARIO, taskId = projectId === PROJECT_B ? TASK_B : TASK_A): PlannerState {
  const productId = `product-${projectId}`;
  return {
    ...emptyPlannerState,
    product: { ...emptyPlannerState.product, id: productId, projectId, name: `Product ${projectId}` },
    scenario: { ...emptyPlannerState.scenario, id: projectId === PROJECT_B ? `${scenarioId}-b` : scenarioId, productId, name: "Main Plan" },
    tasks: [buildTask(taskId, scenarioId, `Server text for ${taskId}`)],
  };
}

function buildAwiMaster(projectId: string, taskId: string): AwiMaster {
  return {
    id: `awi-${projectId}`,
    workspace_id: "workspace-sync",
    project_id: projectId,
    task_id: taskId,
    title: "Sync AWI",
    category: "",
    document_number: `AWI-${projectId}`,
    created_at: "2026-10-01T00:00:00.000Z",
    draft_updated_at: "2026-10-01T00:00:00.000Z",
    published_at: null,
    published_release_id: null,
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((onResolve, onReject) => {
    resolve = onResolve;
    reject = onReject;
  });
  return { promise, resolve, reject };
}

type Subscription = { onChange: (payload: PlannerRealtimePayload) => void; scope?: PlannerRealtimeScope; unsubscribed: boolean };
let subscriptions: Subscription[] = [];
const liveSubscription = () => subscriptions.filter((subscription) => !subscription.unsubscribed);
const fullRefreshPayload: PlannerRealtimePayload = { table: "zones", eventType: "UPDATE", new: { id: "zone-1" }, old: {} };
const taskPayload = (taskId: string): PlannerRealtimePayload => ({ table: "manufacturing_steps", eventType: "UPDATE", new: { task_id: taskId }, old: {} });
function emit(payload: PlannerRealtimePayload) {
  const [subscription] = liveSubscription();
  act(() => subscription!.onChange(payload));
}

async function advance(ms: number) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}
async function flushMicrotasks() {
  for (let pass = 0; pass < 5; pass += 1) {
    await advance(0);
  }
}
async function openModule(name: string) {
  fireEvent.click(screen.getByRole("button", { name }));
  await flushMicrotasks();
}
// A shell edit: adds a task through the Gantt toolbar (marks the planner dirty; the shell autosave follows).
function addTaskInGantt() {
  fireEvent.click(screen.getByRole("button", { name: "Task" }));
}
function scenarioSummary(id: string, name: string, createdAt: string): ScenarioSummary {
  return { id, name, targetOutput: 1, targetOutputPeriod: "day", createdAt };
}

async function mountPlanner(projectId = PROJECT_A) {
  const view = render(<LineWorkspace projectId={projectId} />);
  await flushMicrotasks();
  return view;
}

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: false });
  vi.clearAllMocks();
  localStorage.clear();
  sessionStorage.clear();
  window.history.replaceState(null, "", "/");
  subscriptions = [];
  vi.mocked(subscribePlannerStateChanges).mockImplementation((onChange, scope) => {
    const subscription: Subscription = { onChange, scope, unsubscribed: false };
    subscriptions.push(subscription);
    return () => {
      subscription.unsubscribed = true;
    };
  });
  vi.mocked(loadPlannerCoreStateFromSupabase).mockImplementation(async (projectId) => buildState(projectId ?? PROJECT_A));
  vi.mocked(loadScenariosForProduct).mockImplementation(async () => []);
  vi.mocked(loadPlannerStateFromSupabase).mockImplementation(async (projectId, scenarioId) => buildState(projectId ?? PROJECT_A, scenarioId ?? MAIN_SCENARIO));
  vi.mocked(loadTaskPrivateMediaFromSupabase).mockImplementation(async (taskId) => ({ id: taskId, customFields: {} }));
  vi.mocked(loadTaskFromSupabase).mockImplementation(async () => null);
  window.scrollTo = vi.fn() as unknown as typeof window.scrollTo;
  window.scrollBy = vi.fn() as unknown as typeof window.scrollBy;
  HTMLElement.prototype.scrollTo = vi.fn() as unknown as typeof HTMLElement.prototype.scrollTo;
  HTMLElement.prototype.scrollIntoView = vi.fn();
  window.matchMedia = vi.fn(() => ({
    matches: false,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    addListener: vi.fn(),
    removeListener: vi.fn(),
  })) as unknown as typeof window.matchMedia;
  globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
});

afterEach(() => {
  vi.useRealTimers();
});

describe("deferred remote refresh", () => {
  it("defers a realtime refresh while a shell save is pending and runs it 350 ms after the save settles", async () => {
    await mountPlanner();
    await openModule("Gantt");
    const shellSave = deferred<void>();
    vi.mocked(savePlannerShellToSupabase).mockReturnValueOnce(shellSave.promise);

    addTaskInGantt();
    emit(fullRefreshPayload);
    await advance(SHELL_AUTOSAVE_MS);
    expect(savePlannerShellToSupabase).toHaveBeenCalledTimes(1);
    emit(fullRefreshPayload);
    await advance(REALTIME_FULL_DEBOUNCE_MS * 3);
    expect(loadPlannerStateFromSupabase).not.toHaveBeenCalled();

    await act(async () => { shellSave.resolve(); });
    await advance(REALTIME_FULL_DEBOUNCE_MS - 1);
    expect(loadPlannerStateFromSupabase).not.toHaveBeenCalled();
    await advance(1);
    expect(loadPlannerStateFromSupabase).toHaveBeenCalledTimes(1);
    expect(loadPlannerStateFromSupabase).toHaveBeenCalledWith(PROJECT_A, MAIN_SCENARIO);
  });

  it("a deferred refresh flushed by a save issued in product A keeps A's scope after an in-place switch to B, and never reaches B", async () => {
    const view = await mountPlanner(PROJECT_A);
    await openModule("Gantt");
    const shellSave = deferred<void>();
    vi.mocked(savePlannerShellToSupabase).mockReturnValueOnce(shellSave.promise);
    addTaskInGantt();
    await advance(SHELL_AUTOSAVE_MS);
    emit(fullRefreshPayload);
    expect(loadPlannerStateFromSupabase).not.toHaveBeenCalled();

    vi.mocked(loadPlannerStateFromSupabase).mockImplementation(async (projectId, scenarioId) => ({
      ...buildState(projectId ?? PROJECT_A, scenarioId ?? MAIN_SCENARIO),
      tasks: [buildTask(TASK_A, scenarioId ?? MAIN_SCENARIO, "x", { name: "Refreshed from A" })],
    }));
    view.rerender(<LineWorkspace projectId={PROJECT_B} />);
    await flushMicrotasks();
    await act(async () => { shellSave.resolve(); });
    await advance(REALTIME_FULL_DEBOUNCE_MS);

    // Issuing-scope semantics: the refresh is requested for A (the save's product) against the live
    // scenario, and the stale-scope check then discards it.
    expect(loadPlannerStateFromSupabase).toHaveBeenCalledTimes(1);
    expect(vi.mocked(loadPlannerStateFromSupabase).mock.calls[0]![0]).toBe(PROJECT_A);
    await flushMicrotasks();
    expect(screen.queryAllByText(/Refreshed from A/)).toHaveLength(0);
    expect(screen.queryAllByText(`Task ${TASK_B}`).length).toBeGreaterThan(0);
  });
});

describe("shell lock release and restore autosave", () => {
  // Two process groups (WBS 1 and 2) so the Gantt can reorder one onto the other.
  const twoGroupState = (projectId: string) => {
    const base = buildState(projectId);
    const scenarioId = base.scenario.id;
    return {
      ...base,
      tasks: [
        buildTask(`${projectId}-first`, scenarioId, "First", { wbs: "1", name: "First group" }),
        buildTask(`${projectId}-second`, scenarioId, "Second", { wbs: "2", name: "Second group" }),
      ],
    };
  };
  const groupRow = (wbs: string) => screen.getByRole("button", { name: `Delete task ${wbs}` }).closest("[draggable]")!;
  // The Gantt timeline is code-split; wait for its chunk the first time it is opened.
  async function openGanttTimeline() {
    await openModule("Gantt");
    await act(async () => { await vi.dynamicImportSettled(); });
    await flushMicrotasks();
  }
  function dragGroupOnto(sourceWbs: string, targetWbs: string) {
    const data = new Map<string, string>();
    const dataTransfer = {
      setData: (type: string, value: string) => { data.set(type, value); },
      getData: (type: string) => data.get(type) ?? "",
      effectAllowed: "move",
      dropEffect: "move",
    };
    fireEvent.dragStart(groupRow(sourceWbs), { dataTransfer });
    fireEvent.drop(groupRow(targetWbs), { dataTransfer, clientY: 0 });
  }

  it("releases the shell lock when the product switches while a Gantt reorder is in flight", async () => {
    vi.mocked(loadPlannerCoreStateFromSupabase).mockImplementation(async (projectId) => twoGroupState(projectId ?? PROJECT_A));
    const reorder = deferred<Awaited<ReturnType<typeof reorderTasksInSupabase>>>();
    vi.mocked(reorderTasksInSupabase).mockReturnValueOnce(reorder.promise);
    const view = await mountPlanner(PROJECT_A);
    await openGanttTimeline();

    // jsdom reports zero-height rows, so the drop lands "after" the target: group 1 moves below group 2.
    dragGroupOnto("1", "2");
    // The reorder waits on the save barrier (120 ms polls) before calling the RPC.
    await advance(240);
    expect(reorderTasksInSupabase).toHaveBeenCalledTimes(1);

    view.rerender(<LineWorkspace projectId={PROJECT_B} />);
    await flushMicrotasks();
    await advance(400);
    await openModule("Gantt");
    await act(async () => { reorder.reject(new Error("Task reorder scope changed.")); });
    await flushMicrotasks();

    // An edit in product B autosaves on the normal 900 ms path: the reorder did not keep the lock.
    addTaskInGantt();
    await advance(SHELL_AUTOSAVE_MS);
    await flushMicrotasks();
    expect(savePlannerShellToSupabase).toHaveBeenCalledTimes(1);
    expect(vi.mocked(savePlannerShellToSupabase).mock.calls[0]![0].product.projectId).toBe(PROJECT_B);
  });

  it("autosaves Restore Task 900 ms later without any further edit", async () => {
    vi.mocked(loadPlannerCoreStateFromSupabase).mockImplementation(async (projectId) => twoGroupState(projectId ?? PROJECT_A));
    await mountPlanner(PROJECT_A);
    await openGanttTimeline();

    fireEvent.click(screen.getByRole("button", { name: "Delete task 2" }));
    fireEvent.click(screen.getByRole("button", { name: "Delete Task" }));
    await advance(SHELL_AUTOSAVE_MS);
    await flushMicrotasks();
    expect(savePlannerShellToSupabase).toHaveBeenCalledTimes(1);
    expect(vi.mocked(savePlannerShellToSupabase).mock.calls[0]![0].tasks).toHaveLength(1);

    fireEvent.click(screen.getByRole("button", { name: "Restore Task" }));
    await advance(SHELL_AUTOSAVE_MS);
    await flushMicrotasks();
    expect(savePlannerShellToSupabase).toHaveBeenCalledTimes(2);
    expect(vi.mocked(savePlannerShellToSupabase).mock.calls[1]![0].tasks.map((task) => task.id))
      .toEqual([`${PROJECT_A}-first`, `${PROJECT_A}-second`]);
  });
});

describe("realtime subscription", () => {
  it("adding a task keeps the same subscription and extends its task scope", async () => {
    await mountPlanner();
    await openModule("Gantt");
    expect(subscriptions).toHaveLength(1);

    addTaskInGantt();
    await advance(SHELL_AUTOSAVE_MS);
    await flushMicrotasks();
    const savedTasks = vi.mocked(savePlannerShellToSupabase).mock.calls.at(-1)?.[0].tasks ?? [];
    const addedTask = savedTasks.find((task) => task.id !== TASK_A);
    expect(addedTask).toBeDefined();

    expect(subscriptions).toHaveLength(1);
    expect(subscriptions[0]!.unsubscribed).toBe(false);
    expect(subscriptions[0]!.scope?.isTaskInScope?.(addedTask!.id)).toBe(true);
    expect(subscriptions[0]!.scope?.isTaskInScope?.("some-other-task")).toBe(false);
  });
});

describe("scenario switching", () => {
  const nightState = (name = "Night task") => ({
    ...buildState(PROJECT_A, NIGHT_SCENARIO),
    scenario: { ...buildState(PROJECT_A, NIGHT_SCENARIO).scenario, name: "Night shift" },
    tasks: [buildTask("task-sync-night", NIGHT_SCENARIO, "Night text", { name })],
  });
  beforeEach(() => {
    vi.mocked(loadScenariosForProduct).mockImplementation(async () => [
      scenarioSummary(MAIN_SCENARIO, "Main", "2026-09-01T00:00:00.000Z"),
      scenarioSummary(NIGHT_SCENARIO, "Night shift", "2026-09-02T00:00:00.000Z"),
    ]);
    vi.mocked(loadPlannerStateFromSupabase).mockImplementation(async () => nightState());
  });
  const switchToNight = async () => {
    fireEvent.click(screen.getByRole("tab", { name: "Night shift" }));
    await flushMicrotasks();
  };

  it("re-subscribes once for the new scenario and drops a task refresh queued for the old one", async () => {
    await mountPlanner();
    await openModule("Gantt");
    emit(taskPayload(TASK_A));
    await switchToNight();
    await advance(REALTIME_TASK_DEBOUNCE_MS * 4);

    expect(loadTaskFromSupabase).not.toHaveBeenCalled();
    expect(subscriptions).toHaveLength(2);
    expect(subscriptions[0]!.unsubscribed).toBe(true);
    expect(subscriptions[1]!.scope?.scenarioId).toBe(NIGHT_SCENARIO);

    // The old scenario's queued task id is gone too: the next refresh loads only the new scenario's task.
    emit(taskPayload("task-sync-night"));
    await advance(REALTIME_TASK_DEBOUNCE_MS);
    expect(vi.mocked(loadTaskFromSupabase).mock.calls).toEqual([["task-sync-night", PROJECT_A]]);
  });

  it("flushes a pending shell edit and saves it before loading the target scenario", async () => {
    await mountPlanner();
    await openModule("Gantt");
    addTaskInGantt();
    await switchToNight();
    // The save barrier polls every 120 ms until the flushed save settles.
    await advance(1_000);

    expect(savePlannerShellToSupabase).toHaveBeenCalledTimes(1);
    expect(loadPlannerStateFromSupabase).toHaveBeenCalledTimes(1);
    expect(vi.mocked(savePlannerShellToSupabase).mock.invocationCallOrder[0]!)
      .toBeLessThan(vi.mocked(loadPlannerStateFromSupabase).mock.invocationCallOrder[0]!);
    expect(screen.getByRole("tab", { name: "Night shift" })).toHaveAttribute("aria-selected", "true");
  });

  it("stays on the current scenario when its changes cannot be saved", async () => {
    await mountPlanner();
    await openModule("Gantt");
    vi.mocked(savePlannerShellToSupabase).mockRejectedValue(new Error("Shell save failed"));
    addTaskInGantt();
    await advance(SHELL_AUTOSAVE_MS);
    await switchToNight();
    await advance(1_000);

    expect(screen.getAllByText("Can't switch scenarios").length).toBeGreaterThan(0);
    await advance(15_000);
    expect(loadPlannerStateFromSupabase).not.toHaveBeenCalled();
    expect(screen.getByRole("tab", { name: "Main Plan" })).toHaveAttribute("aria-selected", "true");
  });

  it("discards a full refresh that resolves after the scenario was switched", async () => {
    await mountPlanner();
    await openModule("Gantt");
    const lateRefresh = deferred<PlannerState | null>();
    vi.mocked(loadPlannerStateFromSupabase).mockReturnValueOnce(lateRefresh.promise);
    emit(fullRefreshPayload);
    await advance(REALTIME_FULL_DEBOUNCE_MS);
    expect(loadPlannerStateFromSupabase).toHaveBeenCalledWith(PROJECT_A, MAIN_SCENARIO);

    await switchToNight();
    expect(screen.getAllByText("Night task").length).toBeGreaterThan(0);
    await act(async () => {
      lateRefresh.resolve({ ...buildState(PROJECT_A), tasks: [buildTask(TASK_A, MAIN_SCENARIO, "x", { name: "Late main refresh" })] });
    });
    await flushMicrotasks();

    expect(screen.queryAllByText("Late main refresh")).toHaveLength(0);
    expect(screen.getAllByText("Night task").length).toBeGreaterThan(0);
  });
});

describe("delayed responses across an in-place product switch", () => {
  it("discards a task refresh that resolves after the product changed", async () => {
    const view = await mountPlanner(PROJECT_A);
    await openModule("Gantt");
    const lateTask = deferred<Task | null>();
    vi.mocked(loadTaskFromSupabase).mockReturnValueOnce(lateTask.promise);
    emit(taskPayload(TASK_A));
    await advance(REALTIME_TASK_DEBOUNCE_MS);
    expect(loadTaskFromSupabase).toHaveBeenCalledWith(TASK_A, PROJECT_A);

    view.rerender(<LineWorkspace projectId={PROJECT_B} />);
    await flushMicrotasks();
    await act(async () => { lateTask.resolve(buildTask(TASK_A, MAIN_SCENARIO, "x", { name: "Late task from A" })); });
    await flushMicrotasks();
    // The in-place switch shows the switching state for its 320 ms minimum.
    await advance(400);
    await openModule("Gantt");

    expect(screen.queryAllByText("Late task from A")).toHaveLength(0);
    expect(screen.queryAllByText(`Task ${TASK_B}`).length).toBeGreaterThan(0);
    // B's task set (what B's realtime scope and saves see) never gains A's task.
    expect(liveSubscription()[0]!.scope?.isTaskInScope?.(TASK_A)).toBe(false);
    expect(liveSubscription()[0]!.scope?.isTaskInScope?.(TASK_B)).toBe(true);
  });
});

describe("selected-task private media", () => {
  const instructionBox = () => screen.getByRole<HTMLTextAreaElement>("textbox", { name: "Step 1 instruction" });
  const MEDIA_NOTICE = "Procedure media couldn't be loaded";

  it("loads the selected task's media once, merges only media, and retries a failure only on focus, online or visibility", async () => {
    vi.mocked(loadTaskPrivateMediaFromSupabase)
      .mockRejectedValueOnce(new Error("Media offline"))
      .mockImplementation(async (taskId) => ({ id: taskId, customFields: {}, manufacturingSteps: [{ id: `${TASK_A}-step`, sequence: 1, instruction: "Server text that must not replace the editor", durationMinutes: 1 }] } as unknown as Task));
    render(<LineWorkspace projectId={PROJECT_A} awiMaster={buildAwiMaster(PROJECT_A, TASK_A)} />);
    await flushMicrotasks();
    expect(loadTaskPrivateMediaFromSupabase).toHaveBeenCalledTimes(1);
    expect(loadTaskPrivateMediaFromSupabase).toHaveBeenCalledWith(TASK_A, PROJECT_A);
    expect(screen.getAllByText(MEDIA_NOTICE).length).toBeGreaterThan(0);

    await advance(30_000);
    expect(loadTaskPrivateMediaFromSupabase).toHaveBeenCalledTimes(1);

    act(() => { window.dispatchEvent(new Event("focus")); });
    await flushMicrotasks();
    expect(loadTaskPrivateMediaFromSupabase).toHaveBeenCalledTimes(2);
    expect(instructionBox().value).toBe(`Server text for ${TASK_A}`);

    act(() => { window.dispatchEvent(new Event("online")); });
    act(() => { document.dispatchEvent(new Event("visibilitychange")); });
    await flushMicrotasks();
    expect(loadTaskPrivateMediaFromSupabase).toHaveBeenCalledTimes(2);
  });

  it("ignores a media failure that arrives after an in-place product switch", async () => {
    const lateMedia = deferred<Task | null>();
    vi.mocked(loadTaskPrivateMediaFromSupabase).mockReturnValueOnce(lateMedia.promise);
    const view = render(<LineWorkspace projectId={PROJECT_A} awiMaster={buildAwiMaster(PROJECT_A, TASK_A)} />);
    await flushMicrotasks();
    view.rerender(<LineWorkspace projectId={PROJECT_B} awiMaster={buildAwiMaster(PROJECT_B, TASK_B)} />);
    await flushMicrotasks();
    await act(async () => { lateMedia.reject(new Error("Late A media failure")); });
    await flushMicrotasks();

    expect(screen.queryAllByText(MEDIA_NOTICE)).toHaveLength(0);
    // Current behaviour, pinned because it depends on effect order: in the commit where the product
    // changes, the hydration effect still sees the previous selection and confirmed state, so it reads the
    // previous task under the new product once. Its result is discarded by the scenario check.
    expect(vi.mocked(loadTaskPrivateMediaFromSupabase).mock.calls.map((call) => call.slice(0, 2)))
      .toEqual([[TASK_A, PROJECT_A], [TASK_A, PROJECT_B], [TASK_B, PROJECT_B]]);
  });
});

describe("project-switch loading state and unmount cleanup", () => {
  const SKELETON = "Opening workspace";
  async function startSwitchToB(view: ReturnType<typeof render>) {
    sessionStorage.setItem(PROJECT_SWITCH_SESSION_KEY, String(Date.now()));
    act(() => {
      window.dispatchEvent(new CustomEvent(PROJECT_SWITCH_EVENT, { detail: { projectId: PROJECT_B, title: "Product B" } }));
    });
    view.rerender(<LineWorkspace projectId={PROJECT_B} />);
    await flushMicrotasks();
  }

  it("keeps the switching state for its minimum time although the subscription is re-created, then clears it", async () => {
    const view = await mountPlanner(PROJECT_A);
    await startSwitchToB(view);
    expect(subscriptions.length).toBeGreaterThanOrEqual(2);
    expect(screen.getAllByText(SKELETON).length).toBeGreaterThan(0);

    await advance(319);
    expect(screen.getAllByText(SKELETON).length).toBeGreaterThan(0);
    await advance(1);
    expect(screen.queryAllByText(SKELETON)).toHaveLength(0);
    expect(sessionStorage.getItem(PROJECT_SWITCH_SESSION_KEY)).toBeNull();
  });

  it("unmounting cancels the pending switch timer and queued realtime refreshes", async () => {
    const view = await mountPlanner(PROJECT_A);
    await startSwitchToB(view);
    emit(fullRefreshPayload);
    emit(taskPayload(TASK_B));
    view.unmount();
    await advance(5_000);

    expect(loadPlannerStateFromSupabase).not.toHaveBeenCalled();
    expect(loadTaskFromSupabase).not.toHaveBeenCalled();
    // The switch timer never ran its completion (which clears the session marker).
    expect(sessionStorage.getItem(PROJECT_SWITCH_SESSION_KEY)).not.toBeNull();
    expect(liveSubscription()).toHaveLength(0);
  });
});

describe("read counts", () => {
  function reads() {
    return {
      core: vi.mocked(loadPlannerCoreStateFromSupabase).mock.calls.length,
      full: vi.mocked(loadPlannerStateFromSupabase).mock.calls.length,
      scenarios: vi.mocked(loadScenariosForProduct).mock.calls.length,
      toolLibrary: vi.mocked(loadToolLibraryFromSupabase).mock.calls.length,
      media: vi.mocked(loadTaskPrivateMediaFromSupabase).mock.calls.length,
      task: vi.mocked(loadTaskFromSupabase).mock.calls.length,
      subscribe: vi.mocked(subscribePlannerStateChanges).mock.calls.length,
    };
  }

  it("product open and module switches issue the same data-layer reads", async () => {
    await mountPlanner();
    const opened = reads();
    for (const moduleName of ["Gantt", "Procedure", "Setup", "Dashboard", "Procedure", "Gantt"]) {
      await openModule(moduleName);
    }
    expect({ opened, afterModuleSwitches: reads() }).toMatchInlineSnapshot(`
      {
        "afterModuleSwitches": {
          "core": 1,
          "full": 0,
          "media": 1,
          "scenarios": 1,
          "subscribe": 1,
          "task": 0,
          "toolLibrary": 1,
        },
        "opened": {
          "core": 1,
          "full": 0,
          "media": 0,
          "scenarios": 1,
          "subscribe": 1,
          "task": 0,
          "toolLibrary": 1,
        },
      }
    `);
  });
});
