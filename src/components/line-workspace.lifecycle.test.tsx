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
import { writeCachedPlannerState } from "@/lib/planner-state-cache";
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
    async function startSaveThenSwitch(settle: (task: Task) => Promise<Task>) {
      let finish: (() => void) | undefined;
      saveMock.mockImplementationOnce((task) => new Promise<Task>((resolve, reject) => {
        finish = () => { void settle(task).then(resolve, reject); };
      }));
      const view = await renderWorkspace();
      typeInstruction("Typed in product A");
      await advance(DEBOUNCE_MS);
      expect(saveMock).toHaveBeenCalledTimes(1);
      expect(saveMock.mock.calls[0][2]).toBe(PROJECT_ID);

      // The sidebar and command palette switch with router.push, which the in-app link guard does not
      // intercept, so the A save can still be in flight when B's workspace loads.
      view.rerender(<LineWorkspace projectId={OTHER_PROJECT_ID} awiMaster={buildAwiMaster(OTHER_PROJECT_ID, OTHER_TASK_ID)} />);
      await flushMicrotasks();
      await advance(1_000);
      expect(instructionBox().value).toBe(OTHER_INSTRUCTION);
      vi.mocked(writeCachedPlannerState).mockClear();

      await act(async () => {
        finish?.();
      });
      await flushMicrotasks();
      return view;
    }

    function cacheWritesFor(projectId: string) {
      return vi.mocked(writeCachedPlannerState).mock.calls.filter((call) => call[0] === projectId);
    }

    it("on success: writes to A, leaves B's planner state untouched, clears A's stored draft, and settles", async () => {
      await startSaveThenSwitch(async (task) => echoSavedTask(task));

      expect(saveMock).toHaveBeenCalledTimes(1);
      expect(savedInstruction(0)).toBe("Typed in product A");
      expect(instructionBox().value).toBe(OTHER_INSTRUCTION);
      expect(saveStatusText()).toBe("Saved");
      expect(clickElsewhereLink()).toBe(false);
      expect(storedDraftFields()).toEqual([]);
      expect(localStorage.getItem(OTHER_DRAFT_STORAGE_KEY)).toBeNull();
      // Pre-existing (identical at 3d46341): the completion writes the CURRENT planner state, which is
      // now product B's, under product A's cache key. Recorded as a later-phase concern; change deliberately.
      const completionWrites = cacheWritesFor(PROJECT_ID);
      expect(completionWrites).toHaveLength(1);
      expect(completionWrites[0][1].product.projectId).toBe(OTHER_PROJECT_ID);
      expect(cacheWritesFor(OTHER_PROJECT_ID)).toHaveLength(0);

      await advance(10_000);
      expect(saveMock).toHaveBeenCalledTimes(1);
    });

    it("on failure: keeps A's draft for recovery in A, but B stays pending because A's retry finds no task", async () => {
      await startSaveThenSwitch(async () => {
        throw new Error("Network down");
      });

      expect(screen.getByText("Save failed - retrying")).toBeInTheDocument();
      expect(instructionBox().value).toBe(OTHER_INSTRUCTION);
      expect(storedDraftFields()).toEqual([expect.objectContaining({
        taskId: TASK_ID,
        value: "Typed in product A",
        dirty: true,
      })]);
      expect(localStorage.getItem(OTHER_DRAFT_STORAGE_KEY)).toBeNull();
      expect(cacheWritesFor(PROJECT_ID)).toHaveLength(0);

      // Pre-existing (identical at 3d46341): the retry reads B's planner state, finds no A task and stops,
      // but A's queue record keeps its error, so B's status and navigation guard stay pending until reload.
      await advance(RETRY_MS + DEBOUNCE_MS + 10_000);
      expect(saveMock).toHaveBeenCalledTimes(1);
      expect(saveStatusText()).toBe("Save pending — keep this draft open");
      expect(clickElsewhereLink()).toBe(true);
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
