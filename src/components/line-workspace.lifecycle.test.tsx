// @vitest-environment jsdom
// Black-box characterization of LineWorkspace's procedure save lifecycle (debounce, scope-exit
// flush, in-app navigation guard, load-once-per-project, transient-failure retry, draft recovery
// on load, drafts dropped on scenario switch, a save that completes after a product switch). Drives the
// rendered AWI workspace through the DOM and the mocked data layer only, so it can be replayed
// unchanged against a refactored component.
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { emptyPlannerState } from "@/domain/empty-planner-state";
import type { PlannerProjectContext, PlannerState, ScenarioSummary, Task } from "@/domain/types";
import type { AwiMaster } from "@/lib/awi/store";
import {
  loadPlannerCoreStateFromSupabase,
  loadPlannerStateFromSupabase,
  loadScenariosForProduct,
  loadTaskPrivateMediaFromSupabase,
  saveProcedureTaskUpdateToSupabase,
} from "@/domain/supabase-planner";
import { clearCachedPlannerState, writeCachedPlannerState } from "@/lib/planner-state-cache";
import { LineWorkspace } from "./line-workspace";

const { router, fakeSupabaseClient } = vi.hoisted(() => {
  const empty = { data: null, error: null, count: 0 };
  // Chainable, awaitable stand-in for any query the chrome (user menu, sidebar) builds on mount.
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
  usePathname: () => "/projects/lifecycle",
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
vi.mock("@/domain/supabase-planner", async (original) => ({
  ...await original<typeof import("@/domain/supabase-planner")>(),
  createPlannerSupabaseClient: vi.fn(() => fakeSupabaseClient),
  loadPlannerCoreStateFromSupabase: vi.fn(),
  loadPlannerStateFromSupabase: vi.fn(),
  loadScenariosForProduct: vi.fn(),
  loadToolLibraryFromSupabase: vi.fn(async () => []),
  loadTaskPrivateMediaFromSupabase: vi.fn(),
  subscribePlannerStateChanges: vi.fn(() => () => undefined),
  saveProcedureTaskUpdateToSupabase: vi.fn(),
  savePlannerShellToSupabase: vi.fn(async () => undefined),
}));

const PROJECT_ID = "project-lifecycle";
const OTHER_PROJECT_ID = "project-lifecycle-other";
const TASK_ID = "task-lifecycle";
const STEP_ID = "step-lifecycle";
const ORIGINAL_INSTRUCTION = "Torque the lifecycle bracket bolts to 12 Nm";
const DEBOUNCE_MS = 750;
const RETRY_MS = 2500;
// Recovered drafts are re-queued this long after the confirmed load, then debounced like typing.
const RECOVERY_DELAY_MS = 250;
// Literal storage contract (state.ts procedureDraftStorageKey), spelled out to stay black-box.
const DRAFT_STORAGE_KEY = `buildlogic-line-planner-procedure-draft-v1:${PROJECT_ID}`;
const LEAVE_WARNING = "Your changes are saving automatically. Wait for Saved before leaving this page.";

function buildTask(instruction = ORIGINAL_INSTRUCTION, scenarioId = "scenario-lifecycle"): Task {
  return {
    id: TASK_ID,
    scenarioId,
    stationId: "station-lifecycle",
    zoneId: "zone-lifecycle",
    rowType: "task",
    wbs: "1",
    name: "Lifecycle task",
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
    manufacturingSteps: [
      { id: STEP_ID, sequence: 1, name: "Lifecycle step", instruction, durationMinutes: 1, qualityCheck: "", version: 1 },
    ],
    partReferences: [],
    customFields: {},
    version: 1,
  };
}

function buildState(projectId: string): PlannerState {
  const productId = `product-${projectId}`;
  return {
    ...emptyPlannerState,
    product: { ...emptyPlannerState.product, id: productId, projectId, name: "Lifecycle product" },
    scenario: { ...emptyPlannerState.scenario, id: "scenario-lifecycle", productId },
    tasks: [buildTask()],
  };
}

function buildAwiMaster(projectId = PROJECT_ID, taskId = TASK_ID): AwiMaster {
  return {
    id: `awi-${projectId}`,
    workspace_id: "workspace-lifecycle",
    project_id: projectId,
    task_id: taskId,
    title: "Lifecycle AWI",
    document_number: "AWI-LIFE-001",
    created_at: "2026-10-01T00:00:00.000Z",
    draft_updated_at: "2026-10-01T00:00:00.000Z",
    published_at: null,
    published_release_id: null,
  };
}

// Server echo of a successful save: same content, bumped optimistic-lock versions.
function echoSavedTask(task: Task): Task {
  return {
    ...task,
    version: (task.version ?? 0) + 1,
    manufacturingSteps: (task.manufacturingSteps ?? []).map((step) => ({ ...step, version: (step.version ?? 0) + 1 })),
  };
}

// Product B: its own product, scenario and task ids, as real projects have.
const OTHER_TASK_ID = "task-lifecycle-other";
const OTHER_INSTRUCTION = "Product B: seat the gasket before the cover";
function buildOtherProjectState(): PlannerState {
  const base = buildState(OTHER_PROJECT_ID);
  const task = buildTask(OTHER_INSTRUCTION, "scenario-lifecycle-other");
  return {
    ...base,
    scenario: { ...base.scenario, id: "scenario-lifecycle-other" },
    tasks: [{ ...task, id: OTHER_TASK_ID, manufacturingSteps: task.manufacturingSteps?.map((step) => ({ ...step, id: "step-lifecycle-other" })) }],
  };
}
const OTHER_DRAFT_STORAGE_KEY = `buildlogic-line-planner-procedure-draft-v1:${OTHER_PROJECT_ID}`;

const saveMock = vi.mocked(saveProcedureTaskUpdateToSupabase);
const loadMock = vi.mocked(loadPlannerCoreStateFromSupabase);

async function advance(ms: number) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

// Settles pending promises (loads, saves) without moving the fake clock.
async function flushMicrotasks() {
  for (let pass = 0; pass < 5; pass += 1) {
    await advance(0);
  }
}

async function mountWorkspace() {
  const view = render(<LineWorkspace projectId={PROJECT_ID} awiMaster={buildAwiMaster()} />);
  // The remote core load and the per-task media hydration resolve here; the clock stays put.
  await flushMicrotasks();
  expect(instructionBox()).not.toHaveAttribute("readonly");
  return view;
}

async function renderWorkspace() {
  const view = await mountWorkspace();
  expect(saveStatusText()).toBe("Saved");
  return view;
}

function instructionBox() {
  // A string `name` is matched exactly by Testing Library (same contract as e2e's exact: true).
  return screen.getByRole<HTMLTextAreaElement>("textbox", { name: "Step 1 instruction" });
}

function saveStatusText() {
  return within(screen.getByRole("banner")).getByRole("status").textContent;
}

function typeInstruction(value: string) {
  const box = instructionBox();
  fireEvent.focus(box);
  fireEvent.change(box, { target: { value } });
}

function savedInstruction(callIndex: number) {
  const call = saveMock.mock.calls[callIndex];
  return call[0].manufacturingSteps?.find((step) => step.id === STEP_ID)?.instruction;
}

function instructionDraft(taskId: string, stepId: string, value: string, baseValue: string, localEditSeq: number) {
  return {
    taskId,
    stepId,
    fieldName: "instruction",
    value,
    baseValue,
    baseVersion: 1,
    dirty: true,
    active: false,
    localEditSeq,
    lastEditedAt: Date.parse("2026-10-01T12:00:00.000Z"),
    saveStatus: "dirty",
  };
}

function storedDraftFields(): Array<ReturnType<typeof instructionDraft>> {
  const raw = localStorage.getItem(DRAFT_STORAGE_KEY);
  return raw ? (JSON.parse(raw) as { fields: Array<ReturnType<typeof instructionDraft>> }).fields : [];
}

function storedFields(key: string): Array<{ taskId: string; value: string; dirty: boolean }> {
  const raw = localStorage.getItem(key);
  return raw ? (JSON.parse(raw) as { fields: Array<{ taskId: string; value: string; dirty: boolean }> }).fields : [];
}
const storedFor = (key: string, taskId: string) => storedFields(key).filter((field) => field.taskId === taskId);

function scenarioSummary(id: string, name: string, createdAt: string): ScenarioSummary {
  return { id, name, targetOutput: 1, targetOutputPeriod: "day", createdAt };
}

function clickElsewhereLink() {
  const anchor = document.createElement("a");
  anchor.href = "#elsewhere";
  anchor.textContent = "Elsewhere";
  document.body.appendChild(anchor);
  const event = new MouseEvent("click", { bubbles: true, cancelable: true });
  act(() => {
    anchor.dispatchEvent(event);
  });
  anchor.remove();
  return event.defaultPrevented;
}

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: false });
  vi.clearAllMocks();
  localStorage.clear();
  sessionStorage.clear();
  window.history.replaceState(null, "", "/");
  loadMock.mockImplementation(async (projectId) =>
    projectId === OTHER_PROJECT_ID ? buildOtherProjectState() : buildState(projectId ?? PROJECT_ID));
  vi.mocked(loadScenariosForProduct).mockImplementation(async () => []);
  vi.mocked(loadPlannerStateFromSupabase).mockImplementation(async () => null);
  vi.mocked(loadTaskPrivateMediaFromSupabase).mockImplementation(async (taskId) => ({ id: taskId, customFields: {} }));
  saveMock.mockImplementation(async (task) => echoSavedTask(task));
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

describe("LineWorkspace procedure save lifecycle", () => {
  it("debounces a procedure edit and saves it once, 750 ms after the last keystroke", async () => {
    await renderWorkspace();
    expect(instructionBox().value).toBe(ORIGINAL_INSTRUCTION);

    typeInstruction("Torque the bracket");
    await advance(500);
    typeInstruction("Torque the bracket bolts in a star pattern");
    expect(saveStatusText()).toBe("Saving…");

    await advance(DEBOUNCE_MS - 1);
    expect(saveMock).not.toHaveBeenCalled();

    await advance(1);
    expect(saveMock).toHaveBeenCalledTimes(1);
    const [task, tasks, projectId] = saveMock.mock.calls[0];
    expect(task.id).toBe(TASK_ID);
    expect(savedInstruction(0)).toBe("Torque the bracket bolts in a star pattern");
    expect(tasks.find((candidate) => candidate.id === TASK_ID)?.manufacturingSteps?.[0]?.instruction).toBe(
      "Torque the bracket bolts in a star pattern",
    );
    expect(projectId).toBe(PROJECT_ID);
    expect(saveStatusText()).toBe("Saved");

    await advance(10_000);
    expect(saveMock).toHaveBeenCalledTimes(1);
  });

  it("flushes a pending debounced save immediately when the workspace unmounts", async () => {
    const view = await renderWorkspace();

    typeInstruction("Flush me on the way out");
    await advance(DEBOUNCE_MS - 250);
    expect(saveMock).not.toHaveBeenCalled();

    view.unmount();
    await advance(0);

    expect(saveMock).toHaveBeenCalledTimes(1);
    expect(savedInstruction(0)).toBe("Flush me on the way out");
    expect(saveMock.mock.calls[0][2]).toBe(PROJECT_ID);

    // The cancelled debounce timer must not replay the same edit later.
    await advance(10_000);
    expect(saveMock).toHaveBeenCalledTimes(1);
  });

  it("blocks in-app link navigation while a procedure save is pending or in flight", async () => {
    let resolveSave: (() => void) | undefined;
    saveMock.mockImplementationOnce(
      (task) =>
        new Promise<Task>((resolve) => {
          resolveSave = () => resolve(echoSavedTask(task));
        }),
    );
    await renderWorkspace();
    expect(clickElsewhereLink()).toBe(false);
    expect(screen.queryByText(LEAVE_WARNING)).toBeNull();

    typeInstruction("Do not leave yet");
    await advance(DEBOUNCE_MS - 250);
    expect(clickElsewhereLink()).toBe(true);
    expect(screen.getByText(LEAVE_WARNING)).toBeInTheDocument();

    await advance(250);
    expect(saveMock).toHaveBeenCalledTimes(1);
    expect(saveStatusText()).toBe("Saving…");
    expect(clickElsewhereLink()).toBe(true);

    await act(async () => {
      resolveSave?.();
    });
    await advance(0);
    expect(saveStatusText()).toBe("Saved");
    expect(clickElsewhereLink()).toBe(false);
  });

  it("loads the editable core once per project, not on every re-render", async () => {
    const projectContext: PlannerProjectContext = {
      projectId: PROJECT_ID,
      projectName: "Lifecycle project",
      workspaceId: "workspace-lifecycle",
      workspaceName: "Lifecycle workspace",
      role: "owner",
    };
    const view = await renderWorkspace();
    expect(loadMock).toHaveBeenCalledTimes(1);
    expect(loadMock.mock.calls[0][0]).toBe(PROJECT_ID);

    view.rerender(<LineWorkspace projectId={PROJECT_ID} awiMaster={buildAwiMaster()} />);
    view.rerender(<LineWorkspace projectId={PROJECT_ID} awiMaster={buildAwiMaster()} onReady={() => undefined} />);
    view.rerender(
      <LineWorkspace
        projectId={PROJECT_ID}
        awiMaster={buildAwiMaster()}
        onReady={() => undefined}
        projectContext={projectContext}
      />,
    );
    await advance(1_000);
    expect(loadMock).toHaveBeenCalledTimes(1);

    view.rerender(<LineWorkspace projectId={OTHER_PROJECT_ID} awiMaster={buildAwiMaster()} />);
    await advance(1_000);
    view.rerender(<LineWorkspace projectId={OTHER_PROJECT_ID} awiMaster={buildAwiMaster()} onReady={() => undefined} />);
    await advance(1_000);
    expect(loadMock).toHaveBeenCalledTimes(2);
    expect(loadMock.mock.calls[1][0]).toBe(OTHER_PROJECT_ID);
  });

  it("retries a transiently failed save with the latest edit and ends Saved", async () => {
    saveMock.mockRejectedValueOnce(new Error("Network down"));
    await renderWorkspace();

    typeInstruction("Survive the outage");
    await advance(DEBOUNCE_MS);
    expect(saveMock).toHaveBeenCalledTimes(1);
    expect(savedInstruction(0)).toBe("Survive the outage");
    expect(saveStatusText()).toBe("Save pending — keep this draft open");
    expect(screen.getByText("Save failed - retrying")).toBeInTheDocument();
    expect(instructionBox().value).toBe("Survive the outage");

    await advance(RETRY_MS + DEBOUNCE_MS - 1);
    expect(saveMock).toHaveBeenCalledTimes(1);

    await advance(1);
    expect(saveMock).toHaveBeenCalledTimes(2);
    expect(savedInstruction(1)).toBe("Survive the outage");
    expect(saveMock.mock.calls[1][2]).toBe(PROJECT_ID);
    expect(saveStatusText()).toBe("Saved");
  });

  it("recovers a stored dirty draft on load, re-saves it, and keeps drafts for tasks not in this load", async () => {
    const recovered = "Recovered: torque in a star pattern before the reload";
    const otherScenarioDraft = instructionDraft("task-other-scenario", "step-other-scenario", "Typed on another scenario", "Other base", 8);
    localStorage.setItem(DRAFT_STORAGE_KEY, JSON.stringify({
      version: 2,
      savedAt: "2026-10-01T12:00:00.000Z",
      fields: [instructionDraft(TASK_ID, STEP_ID, recovered, ORIGINAL_INSTRUCTION, 7), otherScenarioDraft],
    }));

    await mountWorkspace();
    expect(instructionBox().value).toBe(recovered);
    expect(saveStatusText()).toBe("Saving…");
    expect(storedDraftFields().map((field) => field.taskId)).toContain("task-other-scenario");

    await advance(RECOVERY_DELAY_MS + DEBOUNCE_MS - 1);
    expect(saveMock).not.toHaveBeenCalled();

    await advance(1);
    expect(saveMock).toHaveBeenCalledTimes(1);
    expect(saveMock.mock.calls[0][0].id).toBe(TASK_ID);
    expect(savedInstruction(0)).toBe(recovered);
    expect(saveMock.mock.calls[0][2]).toBe(PROJECT_ID);
    expect(saveStatusText()).toBe("Saved");
    expect(instructionBox().value).toBe(recovered);
    // The recovered draft is cleared once confirmed; the unmatched one stays for its own scenario.
    expect(storedDraftFields()).toEqual([expect.objectContaining({
      taskId: "task-other-scenario",
      stepId: "step-other-scenario",
      fieldName: "instruction",
      value: "Typed on another scenario",
      dirty: true,
    })]);

    await advance(10_000);
    expect(saveMock).toHaveBeenCalledTimes(1);
  });

  describe("a procedure save that starts in product A and finishes after switching to product B", () => {
    const A_EDIT = "Typed in product A";

    // Holds the next save until the test settles it, so it can finish after the product switch.
    function holdNextSave() {
      let settle: ((outcome: "resolve" | Error) => void) | undefined;
      saveMock.mockImplementationOnce((task) => new Promise<Task>((resolve, reject) => {
        settle = (outcome) => (outcome === "resolve" ? resolve(echoSavedTask(task)) : reject(outcome));
      }));
      return async (outcome: "resolve" | Error) => {
        await act(async () => {
          settle?.(outcome);
        });
        await flushMicrotasks();
      };
    }

    // The sidebar and command palette switch with router.push, which the in-app link guard does not
    // intercept, so an A save can still be pending or in flight when B's workspace loads.
    async function switchTo(view: ReturnType<typeof render>, projectId: string) {
      const taskId = projectId === OTHER_PROJECT_ID ? OTHER_TASK_ID : TASK_ID;
      view.rerender(<LineWorkspace projectId={projectId} awiMaster={buildAwiMaster(projectId, taskId)} />);
      await flushMicrotasks();
      await advance(1_000);
    }

    async function typeInAAndSwitchMidSave() {
      const settle = holdNextSave();
      const view = await renderWorkspace();
      typeInstruction(A_EDIT);
      await advance(DEBOUNCE_MS);
      expect(saveMock).toHaveBeenCalledTimes(1);
      await switchTo(view, OTHER_PROJECT_ID);
      expect(instructionBox().value).toBe(OTHER_INSTRUCTION);
      vi.mocked(writeCachedPlannerState).mockClear();
      return { view, settle };
    }

    function expectEverySaveScopedToA() {
      for (const [task, , projectId] of saveMock.mock.calls) {
        expect(task.id).toBe(TASK_ID);
        expect(projectId).toBe(PROJECT_ID);
      }
    }

    function expectBUnaffected() {
      expect(instructionBox().value).toBe(OTHER_INSTRUCTION);
      expect(saveStatusText()).toBe("Saved");
      expect(clickElsewhereLink()).toBe(false);
      expect(localStorage.getItem(OTHER_DRAFT_STORAGE_KEY)).toBeNull();
      expectEverySaveScopedToA();
      // No cache key ever receives another product's state.
      for (const [projectId, state] of vi.mocked(writeCachedPlannerState).mock.calls) {
        expect(state.product.projectId).toBe(projectId);
      }
    }

    it("on success: saves to A, drops A's now-stale cache, and leaves B untouched", async () => {
      const { settle } = await typeInAAndSwitchMidSave();
      await settle("resolve");

      expect(saveMock).toHaveBeenCalledTimes(1);
      expect(savedInstruction(0)).toBe(A_EDIT);
      expect(vi.mocked(writeCachedPlannerState).mock.calls.filter((call) => call[0] === PROJECT_ID)).toHaveLength(0);
      expect(vi.mocked(clearCachedPlannerState)).toHaveBeenCalledWith(PROJECT_ID);
      expect(storedDraftFields()).toEqual([]);
      expectBUnaffected();

      await advance(10_000);
      expect(saveMock).toHaveBeenCalledTimes(1);
    });

    it("on failure: keeps A's draft, retries it against A in the background, and never blocks B", async () => {
      const { settle } = await typeInAAndSwitchMidSave();
      saveMock.mockRejectedValueOnce(new Error("Network down"));
      await settle(new Error("Network down"));

      expect(screen.getAllByText("Save failed - retrying")).toHaveLength(1);
      expect(storedDraftFields()).toEqual([expect.objectContaining({ taskId: TASK_ID, value: A_EDIT, dirty: true })]);
      expectBUnaffected();

      // First background retry fails again: still quiet in B, draft still recoverable.
      await advance(RETRY_MS);
      expect(saveMock).toHaveBeenCalledTimes(2);
      expect(screen.getAllByText("Save failed - retrying")).toHaveLength(1);
      expect(storedDraftFields()).toEqual([expect.objectContaining({ taskId: TASK_ID, value: A_EDIT, dirty: true })]);
      expectBUnaffected();

      // The next retry succeeds: A's edit lands in A and its stored draft clears.
      await advance(RETRY_MS);
      expect(saveMock).toHaveBeenCalledTimes(3);
      expect(savedInstruction(2)).toBe(A_EDIT);
      expect(storedDraftFields()).toEqual([]);
      expect(vi.mocked(clearCachedPlannerState)).toHaveBeenCalledWith(PROJECT_ID);
      expectBUnaffected();

      await advance(10_000);
      expect(saveMock).toHaveBeenCalledTimes(3);
    });

    it("after a conflict in the background, returning to A recovers the edit and saves it there", async () => {
      const { view, settle } = await typeInAAndSwitchMidSave();
      await settle(new Error("Version conflict: the step changed"));

      expect(screen.getByText("Save conflict")).toBeInTheDocument();
      await advance(RETRY_MS + DEBOUNCE_MS + 5_000);
      expect(saveMock).toHaveBeenCalledTimes(1);
      expectBUnaffected();

      await switchTo(view, PROJECT_ID);
      expect(instructionBox().value).toBe(A_EDIT);
      await advance(RECOVERY_DELAY_MS + DEBOUNCE_MS);
      expect(saveMock).toHaveBeenCalledTimes(2);
      expect(savedInstruction(1)).toBe(A_EDIT);
      expect(saveStatusText()).toBe("Saved");
      expect(storedDraftFields()).toEqual([]);
      expectEverySaveScopedToA();
    });

    it("a late completion after A -> B -> A does not acknowledge newer edits and drains them in A", async () => {
      const { view, settle } = await typeInAAndSwitchMidSave();
      await switchTo(view, PROJECT_ID);
      expect(instructionBox().value).toBe(A_EDIT);

      typeInstruction("Newer edit typed after returning to A");
      await advance(DEBOUNCE_MS + RECOVERY_DELAY_MS);
      expect(saveMock).toHaveBeenCalledTimes(1);

      await settle("resolve");
      expect(saveMock).toHaveBeenCalledTimes(2);
      expect(savedInstruction(1)).toBe("Newer edit typed after returning to A");
      // Rebased on the late completion's confirmed versions.
      expect(saveMock.mock.calls[1][0].version).toBe(2);
      expect(instructionBox().value).toBe("Newer edit typed after returning to A");
      expect(saveStatusText()).toBe("Saved");
      expect(storedDraftFields()).toEqual([]);
      expectEverySaveScopedToA();
      for (const [projectId, state] of vi.mocked(writeCachedPlannerState).mock.calls) {
        expect(state.product.projectId).toBe(projectId);
      }

      await advance(10_000);
      expect(saveMock).toHaveBeenCalledTimes(2);
    });

    it("route switch (the product route remounts the workspace): A's held save still lands in A and B starts clean", async () => {
      const settle = holdNextSave();
      const viewA = await renderWorkspace();
      typeInstruction(A_EDIT);
      await advance(DEBOUNCE_MS);
      expect(saveMock).toHaveBeenCalledTimes(1);

      viewA.unmount();
      render(<LineWorkspace projectId={OTHER_PROJECT_ID} awiMaster={buildAwiMaster(OTHER_PROJECT_ID, OTHER_TASK_ID)} />);
      await flushMicrotasks();
      await advance(1_000);
      expect(instructionBox().value).toBe(OTHER_INSTRUCTION);

      await settle(new Error("Network down"));
      expect(storedDraftFields()).toEqual([expect.objectContaining({ taskId: TASK_ID, value: A_EDIT, dirty: true })]);
      expectBUnaffected();

      // The unmounted A workspace retries its own task against A (retry delay, then the debounce).
      await advance(RETRY_MS + DEBOUNCE_MS);
      expect(saveMock).toHaveBeenCalledTimes(2);
      expect(savedInstruction(1)).toBe(A_EDIT);
      expect(storedDraftFields()).toEqual([]);
      expectBUnaffected();
    });

    it("A -> B -> A -> B with unsaved, failed edits in both products recovers each product's edits from its own storage", async () => {
      const B_EDIT = "Typed in product B";
      const view = await renderWorkspace();
      saveMock.mockRejectedValueOnce(new Error("Network down"));
      typeInstruction(A_EDIT);
      await advance(DEBOUNCE_MS);
      expect(storedFor(DRAFT_STORAGE_KEY, TASK_ID)).toEqual([expect.objectContaining({ value: A_EDIT, dirty: true })]);

      await switchTo(view, OTHER_PROJECT_ID);
      saveMock.mockRejectedValueOnce(new Error("Network down"));
      typeInstruction(B_EDIT);
      await advance(DEBOUNCE_MS);
      expect(saveMock.mock.calls.at(-1)?.[2]).toBe(OTHER_PROJECT_ID);
      expect(storedFor(OTHER_DRAFT_STORAGE_KEY, OTHER_TASK_ID)).toEqual([expect.objectContaining({ value: B_EDIT, dirty: true })]);
      // B's typing, failed save and retry bookkeeping never touched A's recoverable draft.
      expect(storedFor(DRAFT_STORAGE_KEY, TASK_ID)).toEqual([expect.objectContaining({ value: A_EDIT, dirty: true })]);

      // Back in A: A's edit comes back from A's storage and is saved to A; B's edit stays recoverable.
      await switchTo(view, PROJECT_ID);
      expect(instructionBox().value).toBe(A_EDIT);
      await advance(RECOVERY_DELAY_MS + DEBOUNCE_MS);
      expect(saveMock.mock.calls.at(-1)?.[0].id).toBe(TASK_ID);
      expect(saveMock.mock.calls.at(-1)?.[2]).toBe(PROJECT_ID);
      expect(savedInstruction(saveMock.mock.calls.length - 1)).toBe(A_EDIT);
      expect(saveStatusText()).toBe("Saved");
      expect(storedFor(DRAFT_STORAGE_KEY, TASK_ID)).toEqual([]);
      expect(storedFor(OTHER_DRAFT_STORAGE_KEY, OTHER_TASK_ID)).toEqual([expect.objectContaining({ value: B_EDIT, dirty: true })]);

      // Back in B: B's edit comes back from B's storage and is saved to B.
      await switchTo(view, OTHER_PROJECT_ID);
      expect(instructionBox().value).toBe(B_EDIT);
      await advance(RECOVERY_DELAY_MS + DEBOUNCE_MS);
      const last = saveMock.mock.calls.at(-1);
      expect(last?.[0].id).toBe(OTHER_TASK_ID);
      expect(last?.[2]).toBe(OTHER_PROJECT_ID);
      expect(last?.[0].manufacturingSteps?.[0]?.instruction).toBe(B_EDIT);
      expect(saveStatusText()).toBe("Saved");
      expect(storedFor(OTHER_DRAFT_STORAGE_KEY, OTHER_TASK_ID)).toEqual([]);
    });

    it("B's successful saves and draft cleanup leave A's unsaved draft in A's storage", async () => {
      const view = await renderWorkspace();
      saveMock.mockRejectedValueOnce(new Error("Version conflict: the step changed"));
      typeInstruction(A_EDIT);
      await advance(DEBOUNCE_MS);
      await switchTo(view, OTHER_PROJECT_ID);

      typeInstruction("Saved in product B");
      await advance(DEBOUNCE_MS);
      act(() => instructionBox().blur());
      await flushMicrotasks();
      expect(saveMock.mock.calls.at(-1)?.[2]).toBe(OTHER_PROJECT_ID);
      expect(saveStatusText()).toBe("Saved");
      expect(storedFor(OTHER_DRAFT_STORAGE_KEY, OTHER_TASK_ID)).toEqual([]);
      expect(storedFor(DRAFT_STORAGE_KEY, TASK_ID)).toEqual([expect.objectContaining({ value: A_EDIT, dirty: true })]);
    });

    it("an older workspace's background retry cannot acknowledge newer edits typed after returning to A", async () => {
      const settleFirst = holdNextSave();
      const view = await renderWorkspace();
      typeInstruction(A_EDIT);
      await advance(DEBOUNCE_MS);
      await switchTo(view, OTHER_PROJECT_ID);
      await settleFirst(new Error("Network down"));

      // The background retry starts while B is on screen and is held in flight.
      const settleRetry = holdNextSave();
      await advance(RETRY_MS);
      expect(saveMock).toHaveBeenCalledTimes(2);
      expect(savedInstruction(1)).toBe(A_EDIT);

      await switchTo(view, PROJECT_ID);
      expect(instructionBox().value).toBe(A_EDIT);
      typeInstruction("Newer edit after returning to A");
      await advance(RECOVERY_DELAY_MS + DEBOUNCE_MS);
      expect(saveMock).toHaveBeenCalledTimes(2);

      await settleRetry("resolve");
      // The old retry's response is not the newer edit: it drains the newer edit, rebased.
      expect(saveMock).toHaveBeenCalledTimes(3);
      expect(savedInstruction(2)).toBe("Newer edit after returning to A");
      expect(saveMock.mock.calls[2][2]).toBe(PROJECT_ID);
      expect(saveMock.mock.calls[2][0].version).toBe(2);
      expect(instructionBox().value).toBe("Newer edit after returning to A");
      expect(saveStatusText()).toBe("Saved");
      expect(storedFor(DRAFT_STORAGE_KEY, TASK_ID)).toEqual([]);
      await advance(10_000);
      expect(saveMock).toHaveBeenCalledTimes(3);
    });

    it("a scenario switch in B keeps A's unsaved draft, so A's in-flight save failing later cannot erase it", async () => {
      vi.mocked(loadScenariosForProduct).mockImplementation(async (productId) => productId === `product-${OTHER_PROJECT_ID}`
        ? [
          scenarioSummary("scenario-lifecycle-other", "Main", "2026-09-01T00:00:00.000Z"),
          scenarioSummary("scenario-b-night", "B night", "2026-09-02T00:00:00.000Z"),
        ]
        : []);
      vi.mocked(loadPlannerStateFromSupabase).mockImplementation(async () => {
        const base = buildOtherProjectState();
        return { ...base, scenario: { ...base.scenario, id: "scenario-b-night", name: "B night" } };
      });
      const settleFirst = holdNextSave();
      const view = await renderWorkspace();
      typeInstruction(A_EDIT);
      await advance(DEBOUNCE_MS);
      await switchTo(view, OTHER_PROJECT_ID);

      // B is not held by A's in-flight save: its scenario switch goes ahead.
      fireEvent.click(screen.getByRole("button", { name: "Gantt" }));
      await flushMicrotasks();
      fireEvent.click(screen.getByRole("tab", { name: "B night" }));
      await flushMicrotasks();
      expect(screen.getByRole("tab", { name: "B night" })).toHaveAttribute("aria-selected", "true");

      saveMock.mockRejectedValue(new Error("Network down"));
      await settleFirst(new Error("Network down"));
      expect(storedFor(DRAFT_STORAGE_KEY, TASK_ID)).toEqual([expect.objectContaining({ value: A_EDIT, dirty: true })]);
      await advance(RETRY_MS + DEBOUNCE_MS);
      expect(storedFor(DRAFT_STORAGE_KEY, TASK_ID)).toEqual([expect.objectContaining({ value: A_EDIT, dirty: true })]);
      expect(localStorage.getItem(OTHER_DRAFT_STORAGE_KEY)).toBeNull();

      // Back in A, the edit is recovered from A's storage and saved to A.
      saveMock.mockImplementation(async (task) => echoSavedTask(task));
      const savesBeforeReturn = saveMock.mock.calls.length;
      await switchTo(view, PROJECT_ID);
      fireEvent.click(screen.getByRole("button", { name: "Procedure" }));
      await flushMicrotasks();
      expect(instructionBox().value).toBe(A_EDIT);
      await advance(RECOVERY_DELAY_MS + DEBOUNCE_MS);
      const recoverySaves = saveMock.mock.calls.slice(savesBeforeReturn);
      expect(recoverySaves.map((call) => [call[0].id, call[2], call[0].manufacturingSteps?.[0]?.instruction]))
        .toContainEqual([TASK_ID, PROJECT_ID, A_EDIT]);
      expect(saveStatusText()).toBe("Saved");
      expect(storedFor(DRAFT_STORAGE_KEY, TASK_ID)).toEqual([]);
      expectEverySaveScopedToA();
    });

    it("a debounced A edit flushed by the switch is saved to A, not to B", async () => {
      const view = await renderWorkspace();
      typeInstruction(A_EDIT);
      await advance(DEBOUNCE_MS - 250);
      expect(saveMock).not.toHaveBeenCalled();

      await switchTo(view, OTHER_PROJECT_ID);
      expect(saveMock).toHaveBeenCalledTimes(1);
      expect(savedInstruction(0)).toBe(A_EDIT);
      expect(storedDraftFields()).toEqual([]);
      expectBUnaffected();
    });
  });

  describe("switching scenarios after a saved procedure edit", () => {
    const MAIN_SCENARIO_ID = "scenario-lifecycle";
    const ALT_SCENARIO_ID = "scenario-lifecycle-night";
    const altInstruction = "Night shift: pre-kit the bracket bolts";
    const mainDraft = "Main plan draft that must not leak";

    beforeEach(() => {
      vi.mocked(loadScenariosForProduct).mockImplementation(async () => [
        scenarioSummary(MAIN_SCENARIO_ID, "Main", "2026-09-01T00:00:00.000Z"),
        scenarioSummary(ALT_SCENARIO_ID, "Night shift projection", "2026-09-02T00:00:00.000Z"),
      ]);
      // Same task and step ids as Main, different server text: a carried-over draft would show here.
      vi.mocked(loadPlannerStateFromSupabase).mockImplementation(async () => {
        const base = buildState(PROJECT_ID);
        return {
          ...base,
          scenario: { ...base.scenario, id: ALT_SCENARIO_ID, name: "Night shift projection" },
          tasks: [buildTask(altInstruction, ALT_SCENARIO_ID)],
        };
      });
    });

    async function saveMainDraftWithFocus() {
      await renderWorkspace();
      const box = instructionBox();
      act(() => box.focus());
      fireEvent.change(box, { target: { value: mainDraft } });
      await advance(DEBOUNCE_MS);
      expect(saveMock).toHaveBeenCalledTimes(1);
      expect(savedInstruction(0)).toBe(mainDraft);
      expect(saveStatusText()).toBe("Saved");
      expect(document.activeElement).toBe(box);
    }

    async function switchToNightShiftAndBack() {
      // fireEvent.click activates the controls without moving focus; each test states the focus it needs.
      fireEvent.click(screen.getByRole("button", { name: "Gantt" }));
      await flushMicrotasks();
      expect(screen.getByRole("tab", { name: "Main Plan" })).toHaveAttribute("aria-selected", "true");
      fireEvent.click(screen.getByRole("tab", { name: "Night shift projection" }));
      await flushMicrotasks();
      expect(vi.mocked(loadPlannerStateFromSupabase).mock.calls.map((call) => call.slice(0, 2))).toEqual([
        [PROJECT_ID, ALT_SCENARIO_ID],
      ]);
      expect(screen.getByRole("tab", { name: "Night shift projection" })).toHaveAttribute("aria-selected", "true");
      fireEvent.click(screen.getByRole("button", { name: "Procedure" }));
      await flushMicrotasks();
    }

    async function expectNightShiftStartsClean() {
      expect(instructionBox().value).toBe(altInstruction);
      expect(saveStatusText()).toBe("Saved");
      expect(storedDraftFields()).toEqual([]);
      await advance(10_000);
      expect(saveMock).toHaveBeenCalledTimes(1);

      // A new edit saves the night-shift task from its own server text, with no Main draft re-applied.
      typeInstruction("Night shift: torque after pre-kit");
      await advance(DEBOUNCE_MS);
      expect(saveMock).toHaveBeenCalledTimes(2);
      expect(savedInstruction(1)).toBe("Night shift: torque after pre-kit");
      expect(saveMock.mock.calls[1][0].scenarioId).toBe(ALT_SCENARIO_ID);
    }

    it("keeps another scenario's recoverable draft and never applies either scenario's edits to the other", async () => {
      const NIGHT_TASK_ID = "task-lifecycle-night";
      const NIGHT_STEP_ID = "step-lifecycle-night";
      const nightDraft = "Night shift draft from an earlier session";
      vi.mocked(loadPlannerStateFromSupabase).mockImplementation(async () => {
        const base = buildState(PROJECT_ID);
        const nightTask = buildTask(altInstruction, ALT_SCENARIO_ID);
        return {
          ...base,
          scenario: { ...base.scenario, id: ALT_SCENARIO_ID, name: "Night shift projection" },
          tasks: [{
            ...nightTask,
            id: NIGHT_TASK_ID,
            manufacturingSteps: nightTask.manufacturingSteps?.map((step) => ({ ...step, id: NIGHT_STEP_ID })),
          }],
        };
      });
      localStorage.setItem(DRAFT_STORAGE_KEY, JSON.stringify({
        version: 2,
        savedAt: "2026-10-01T12:00:00.000Z",
        fields: [instructionDraft(NIGHT_TASK_ID, NIGHT_STEP_ID, nightDraft, altInstruction, 5)],
      }));

      await saveMainDraftWithFocus();
      // The night draft matches no Main task: it stays stored for its own scenario.
      expect(storedFields(DRAFT_STORAGE_KEY).map((field) => [field.taskId, field.value])).toEqual([[NIGHT_TASK_ID, nightDraft]]);

      await switchToNightShiftAndBack();
      // Main's live draft was dropped; the night scenario shows its own recoverable draft, never Main's.
      expect(instructionBox().value).toBe(nightDraft);
      expect(storedFields(DRAFT_STORAGE_KEY).map((field) => [field.taskId, field.value])).toEqual([[NIGHT_TASK_ID, nightDraft]]);
      expect(saveMock.mock.calls.map((call) => call[0].manufacturingSteps?.[0]?.instruction)).toEqual([mainDraft]);

      // An edit in the night scenario saves the night task with its own text; Main's draft never joins it.
      typeInstruction("Night shift: final wording");
      await advance(DEBOUNCE_MS);
      expect(saveMock).toHaveBeenCalledTimes(2);
      expect(saveMock.mock.calls[1][0].id).toBe(NIGHT_TASK_ID);
      expect(savedInstruction(1)).toBe(undefined);
      expect(saveMock.mock.calls[1][0].manufacturingSteps?.[0]?.instruction).toBe("Night shift: final wording");
      expect(storedFields(DRAFT_STORAGE_KEY)).toEqual([]);
    });

    it("shows the other scenario's server text when the field was blurred before switching", async () => {
      await saveMainDraftWithFocus();
      // A pointer click on a module or tab moves focus first; the blur releases the saved draft.
      act(() => instructionBox().blur());
      expect(document.activeElement).not.toBe(instructionBox());

      await switchToNightShiftAndBack();
      await expectNightShiftStartsClean();
    });

    it("drops a draft that is still live because its field kept focus until the editor unmounted", async () => {
      await saveMainDraftWithFocus();
      // Intentional precondition: no blur before the module change, so the saved Main draft is still the
      // field's live (active) draft when the scenario switch runs. Only the switch itself can drop it.
      expect(document.activeElement).toBe(instructionBox());

      await switchToNightShiftAndBack();
      await expectNightShiftStartsClean();
    });
  });
});
