import { act, renderHook } from "@testing-library/react";
import { useRef, useState } from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { emptyPlannerState } from "@/domain/empty-planner-state";
import type { PlannerState, Task } from "@/domain/types";
import { writeCachedPlannerState } from "@/lib/planner-state-cache";
import { procedureTestStep as step, procedureTestTask as task } from "./procedure-test-fixtures";
import { procedureDraftStorageKey, type ProcedureDraftField } from "./state";
import { useProcedureDrafts, type ProcedureQueueProbe } from "./use-procedure-drafts";

vi.mock("@/lib/planner-state-cache", async (original) => ({
  ...await original<typeof import("@/lib/planner-state-cache")>(),
  writeCachedPlannerState: vi.fn(async () => undefined),
}));

const PROJECT_ID = "project-drafts";

function renderDrafts(queueProbe: ProcedureQueueProbe, initialTask = task("server text")) {
  return renderHook(({ projectId }: { projectId: string }) => {
    const [plannerState, setPlannerState] = useState<PlannerState>({ ...emptyPlannerState, tasks: [initialTask] });
    const latestDerivedStateRef = useRef(plannerState);
    latestDerivedStateRef.current = plannerState;
    const mainScenarioIdRef = useRef<string | undefined>("scenario-main");
    const drafts = useProcedureDrafts({
      projectId,
      mainScenarioIdRef,
      latestDerivedStateRef,
      setPlannerState,
      queueProbe,
    });
    return { plannerState, drafts };
  }, { initialProps: { projectId: PROJECT_ID } });
}

const idleProbe: ProcedureQueueProbe = {
  hasPendingProcedureSaveWork: () => false,
  pendingDraftSnapshot: () => undefined,
};

beforeEach(() => {
  window.localStorage.clear();
  vi.mocked(writeCachedPlannerState).mockClear();
});

afterEach(() => {
  window.localStorage.clear();
});

it("asks the queue for pending work at merge time instead of trusting a captured answer", () => {
  let pending = true;
  const probe: ProcedureQueueProbe = {
    hasPendingProcedureSaveWork: vi.fn(() => pending),
    pendingDraftSnapshot: () => undefined,
  };
  const { result } = renderDrafts(probe);
  const local = task("server text", 1, {
    name: "Typed locally",
    partReferences: [{ id: "part-1", partNumber: "100-1" }],
    customFields: { column: "local cell" },
  });
  const server = task("server text", 2, { name: "Older server name", partReferences: [], customFields: { column: "server cell" } });

  const whilePending = result.current.drafts.mergeServerTaskIntoLocalTask(local, server, {}, { source: "refreshTasks" });
  pending = false;
  const afterSettled = result.current.drafts.mergeServerTaskIntoLocalTask(local, server, {}, { source: "refreshTasks" });

  expect(whilePending).toMatchObject({
    name: "Typed locally",
    partReferences: [{ id: "part-1", partNumber: "100-1" }],
    customFields: { column: "local cell" },
  });
  // Local steps are kept for the queued save but carry the server's optimistic-lock versions.
  expect(whilePending.manufacturingSteps?.[0]).toMatchObject({ instruction: "server text", version: 2 });
  expect(afterSettled).toMatchObject({ name: "Older server name", partReferences: [], customFields: { column: "server cell" } });
  expect(probe.hasPendingProcedureSaveWork).toHaveBeenCalledWith("task-1");
  // A save completion echoes what was sent, so newer local text wins even without pending work.
  expect(
    result.current.drafts.mergeServerTaskIntoLocalTask(local, server, {}, { source: "saveCompletion" }).name,
  ).toBe("Typed locally");
});

it("keeps typed step text over a server refresh and acknowledges only the exact saved edit", () => {
  const { result } = renderDrafts(idleProbe);
  act(() => {
    result.current.drafts.setProcedureFieldDraft("task-1", "step-1", "instruction", "typed A");
  });
  const snapshotA = result.current.drafts.cloneProcedureDrafts();
  act(() => {
    result.current.drafts.markProcedureDraftsForSave("task-1", "save-a", snapshotA);
    result.current.drafts.setProcedureFieldDraft("task-1", "step-1", "instruction", "typed B");
  });

  const merged = result.current.drafts.mergeServerTaskIntoLocalTask(
    task("typed B"),
    task("typed A", 2),
    result.current.drafts.procedureDraftsRef.current,
    { source: "refreshTasks" },
  );
  expect(merged.manufacturingSteps?.[0]?.instruction).toBe("typed B");

  let confirmed = true;
  act(() => {
    confirmed = result.current.drafts.confirmProcedureDraftsFromSave("task-1", "save-a", 1, snapshotA, task("typed A", 2, {
      manufacturingSteps: [step("typed A", 2)],
    }));
  });
  expect(confirmed).toBe(false);
  expect(Object.values(result.current.drafts.procedureDraftsRef.current)[0]).toMatchObject({
    value: "typed B",
    dirty: true,
    saveStatus: "dirty",
  });

  const snapshotB = result.current.drafts.cloneProcedureDrafts();
  act(() => {
    result.current.drafts.markProcedureDraftsForSave("task-1", "save-b", snapshotB);
    confirmed = result.current.drafts.confirmProcedureDraftsFromSave("task-1", "save-b", 2, snapshotB, task("typed B", 3, {
      manufacturingSteps: [step("typed B", 3)],
    }));
  });
  expect(confirmed).toBe(true);
  const draft = Object.values(result.current.drafts.procedureDraftsRef.current)[0];
  expect(draft).toMatchObject({ dirty: false, saveStatus: "saved", baseValue: "typed B", baseVersion: 3 });
});

it("does not drop a clean draft that a queued save still references", () => {
  let pendingSnapshot: Record<string, ProcedureDraftField> | undefined;
  const { result } = renderDrafts({
    hasPendingProcedureSaveWork: () => false,
    pendingDraftSnapshot: () => pendingSnapshot,
  });
  act(() => {
    result.current.drafts.markProcedureFieldActive("task-1", "step-1", "instruction", "server text");
  });
  const [key, draft] = Object.entries(result.current.drafts.procedureDraftsRef.current)[0];
  pendingSnapshot = { [key]: draft };

  act(() => {
    result.current.drafts.markProcedureFieldInactive("task-1", "step-1", "instruction");
  });
  expect(result.current.drafts.procedureDraftsRef.current[key]).toBeDefined();

  pendingSnapshot = undefined;
  act(() => {
    result.current.drafts.cleanupCleanProcedureDrafts("task-1");
  });
  expect(result.current.drafts.procedureDraftsRef.current[key]).toBeUndefined();
});

it("defers server updates while a field is focused, keeps the newest, and applies it on blur", () => {
  const { result } = renderDrafts(idleProbe);
  act(() => {
    result.current.drafts.markProcedureFieldActive("task-1", "step-1", "instruction", "server text");
  });
  expect(result.current.drafts.hasDirtyOrActiveProcedureDrafts("task-1")).toBe(true);

  act(() => {
    result.current.drafts.storeDeferredProcedureServerUpdate({
      serverTask: task("newest server", 3), serverVersion: 3, receivedAt: 100, source: "realtime",
    });
    result.current.drafts.storeDeferredProcedureServerUpdate({
      serverTask: task("late but older", 2), serverVersion: 2, receivedAt: 200, source: "realtime",
    });
  });
  expect(result.current.drafts.deferredProcedureServerUpdatesRef.current["task-1"]?.serverVersion).toBe(3);

  act(() => {
    result.current.drafts.markProcedureFieldInactive("task-1", "step-1", "instruction");
  });
  expect(result.current.plannerState.tasks[0]?.manufacturingSteps?.[0]?.instruction).toBe("newest server");
  expect(result.current.drafts.deferredProcedureServerUpdatesRef.current["task-1"]).toBeUndefined();
  expect(writeCachedPlannerState).toHaveBeenCalledWith(PROJECT_ID, expect.anything(), "scenario-main");
});

it("discards a deferred update older than the local task", () => {
  const { result } = renderDrafts(idleProbe, task("local newer", 5));
  act(() => {
    result.current.drafts.markProcedureFieldActive("task-1", "step-1", "instruction", "local newer");
    result.current.drafts.storeDeferredProcedureServerUpdate({
      serverTask: task("stale server", 4), serverVersion: 4, receivedAt: 100, source: "refreshTasks",
    });
  });
  act(() => {
    result.current.drafts.markProcedureFieldInactive("task-1", "step-1", "instruction");
  });
  expect(result.current.plannerState.tasks[0]?.manufacturingSteps?.[0]?.instruction).toBe("local newer");
});

it("restores recovered drafts as unfocused edits that later typing outranks, and resets on scenario switch", () => {
  const { result } = renderDrafts(idleProbe);
  const recovered: ProcedureDraftField = {
    taskId: "task-1",
    stepId: "step-1",
    fieldName: "instruction",
    value: "recovered text",
    baseValue: "server text",
    dirty: true,
    active: true,
    localEditSeq: 41,
    lastEditedAt: 1,
    saveStatus: "saving",
  };

  let restored: ReturnType<typeof result.current.drafts.restoreProcedureDraftFields> = {};
  act(() => {
    restored = result.current.drafts.restoreProcedureDraftFields([recovered]);
  });
  expect(Object.values(restored)[0]).toMatchObject({ active: false, dirty: true, saveStatus: "dirty" });
  expect(result.current.drafts.procedureDraftsRef.current).toBe(restored);
  expect(
    result.current.drafts.applyProcedureDraftsToTask(task("server text"), restored).manufacturingSteps?.[0]?.instruction,
  ).toBe("recovered text");

  let next: ProcedureDraftField | undefined;
  act(() => {
    next = result.current.drafts.setProcedureFieldDraft("task-1", "step-1", "name", "Renamed");
  });
  expect(next?.localEditSeq).toBe(42);
  expect(window.localStorage.getItem(procedureDraftStorageKey(PROJECT_ID))).toContain("Renamed");

  act(() => {
    result.current.drafts.resetProcedureDrafts();
  });
  expect(result.current.drafts.procedureDraftsRef.current).toEqual({});
});

it("flags a conflict instead of losing typing when the server deleted the edited step", () => {
  const { result } = renderDrafts(idleProbe);
  act(() => {
    result.current.drafts.setProcedureFieldDraft("task-1", "step-1", "instruction", "typed on a deleted step");
  });
  let merged: Task | undefined;
  act(() => {
    merged = result.current.drafts.mergeServerTaskIntoLocalTask(
      task("typed on a deleted step"),
      task("unused", 2, { manufacturingSteps: [] }),
      result.current.drafts.procedureDraftsRef.current,
      { source: "realtime" },
    );
  });
  expect(merged?.manufacturingSteps?.[0]?.instruction).toBe("typed on a deleted step");
  expect(Object.values(result.current.drafts.procedureDraftsRef.current)[0]).toMatchObject({ saveStatus: "conflict" });
});

it("does not acknowledge a newer edit that happens to match the saved text", () => {
  const { result } = renderDrafts(idleProbe);
  act(() => {
    result.current.drafts.setProcedureFieldDraft("task-1", "step-1", "instruction", "A");
  });
  const sent = result.current.drafts.cloneProcedureDrafts();
  act(() => {
    result.current.drafts.markProcedureDraftsForSave("task-1", "save-a", sent);
    result.current.drafts.setProcedureFieldDraft("task-1", "step-1", "instruction", "AB");
    result.current.drafts.setProcedureFieldDraft("task-1", "step-1", "instruction", "A");
  });

  let confirmed = true;
  act(() => {
    confirmed = result.current.drafts.confirmProcedureDraftsFromSave("task-1", "save-a", 1, sent, task("A", 2));
  });
  expect(confirmed).toBe(false);
  expect(Object.values(result.current.drafts.procedureDraftsRef.current)[0]).toMatchObject({
    value: "A",
    localEditSeq: 3,
    dirty: true,
  });
});

it("returns a stale save to dirty instead of leaving it saving", () => {
  const { result } = renderDrafts(idleProbe);
  act(() => {
    result.current.drafts.setProcedureFieldDraft("task-1", "step-1", "instruction", "mine");
  });
  const sent = result.current.drafts.cloneProcedureDrafts();
  act(() => {
    result.current.drafts.markProcedureDraftsForSave("task-1", "save-a", sent);
  });
  expect(Object.values(result.current.drafts.procedureDraftsRef.current)[0]?.saveStatus).toBe("saving");

  let confirmed = true;
  act(() => {
    confirmed = result.current.drafts.confirmProcedureDraftsFromSave("task-1", "save-a", 1, sent, task("someone else's text", 2));
  });
  expect(confirmed).toBe(false);
  expect(Object.values(result.current.drafts.procedureDraftsRef.current)[0]).toMatchObject({
    value: "mine",
    dirty: true,
    saveStatus: "dirty",
  });
});

it("keeps the projectId of the render that started the work after an in-place project switch", () => {
  const { result, rerender } = renderDrafts(idleProbe);
  const setFieldFromFirstProject = result.current.drafts.setProcedureFieldDraft;
  rerender({ projectId: "project-other" });

  act(() => {
    setFieldFromFirstProject("task-1", "step-1", "instruction", "typed before the switch");
  });
  expect(window.localStorage.getItem(procedureDraftStorageKey(PROJECT_ID))).toContain("typed before the switch");
  expect(window.localStorage.getItem(procedureDraftStorageKey("project-other"))).toBeNull();

  act(() => {
    result.current.drafts.setProcedureFieldDraft("task-1", "step-1", "name", "typed after the switch");
  });
  expect(window.localStorage.getItem(procedureDraftStorageKey("project-other"))).toContain("typed after the switch");
});
