// @vitest-environment jsdom
// Characterization of the mobile New Step recovery draft (IndexedDB) as observed through the rendered
// portal, written before the store was extracted into mobile-photo-portal/recovery-draft-store.ts and kept
// unchanged across the move. The IndexedDB double stands in for the browser's store; one test keeps jsdom's
// default (no indexedDB) to pin the unavailable-storage path.
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { emptyPlannerState } from "@/domain/empty-planner-state";
import type { PlannerState, Task } from "@/domain/types";
import { installIndexedDbDouble, type IndexedDbDouble } from "@/test-support/indexeddb-double";
import { MobilePhotoPortal } from "./mobile-photo-portal";
import { loadPlannerStateFromSupabase, saveMobileStepToSupabase } from "@/domain/supabase-planner";

vi.mock("@/components/app-flow-panels", () => ({ AppLoadingShell: () => <div>Loading</div> }));
vi.mock("@/domain/supabase-planner", async (original) => ({
  ...await original<typeof import("@/domain/supabase-planner")>(),
  loadPlannerStateFromSupabase: vi.fn(),
  loadTaskFromSupabase: vi.fn(),
  loadToolLibraryFromSupabase: vi.fn(async () => []),
  subscribePlannerStateChanges: vi.fn(() => () => undefined),
  saveMobileStepToSupabase: vi.fn(),
  syncStepToolsForStepToSupabase: vi.fn(async () => undefined),
  saveTaskToSupabase: vi.fn(),
  deletePlannerTask: vi.fn(async () => undefined),
}));

const DB = "buildlogic-mobile-drafts";
const STORE = "drafts";
const KEY = "mobile-new-step-draft-v1";
const taskA: Task = {
  id: "task-a", scenarioId: "scenario-empty", stationId: "", wbs: "1", rowType: "task", name: "Alpha process",
  plannedStart: "2026-10-01T10:00:00Z", plannedFinish: "2026-10-01T10:00:00Z", plannedDurationMinutes: 0,
  plannedOperators: 1, plannedManHours: 0, status: "not_started", percentComplete: 0, dependencyIds: [],
  criticalPath: false, bottleneckFlag: false, qualityGate: false, travelerSignoffRequired: false,
  manufacturingSteps: [], customFields: {},
};
const state: PlannerState = { ...emptyPlannerState, product: { ...emptyPlannerState.product, projectId: "p", name: "Test project" }, tasks: [taskA] };
const RECOVERY_MESSAGE = /Recovered an unsaved phone draft/;
const STORAGE_ERROR = /could not store the local recovery draft/;

let idb: IndexedDbDouble | null = null;
const records = () => idb!.records(DB, STORE);
function seedRecord(record: Record<string, unknown>) {
  const db = new Map(); db.set(STORE, { keyPath: "key", rows: new Map([[KEY, { key: KEY, ...record }]]) });
  idb!.databases.set(DB, db);
}
async function openDraft() {
  render(<MobilePhotoPortal projectId="p" initialPlannerState={state} />);
  fireEvent.click(await screen.findByRole("button", { name: /Alpha process 0 steps/ }));
  fireEvent.click(screen.getByRole("button", { name: "Add step" }));
}
const typeName = (value: string) => fireEvent.change(screen.getByRole("textbox", { name: "New step name" }), { target: { value } });

beforeEach(() => {
  vi.clearAllMocks(); localStorage.clear();
  vi.mocked(loadPlannerStateFromSupabase).mockResolvedValue(state);
  vi.mocked(saveMobileStepToSupabase).mockImplementation(async (_task, step) => ({ ...step, version: 1 }));
  window.scrollTo = vi.fn(); window.scrollBy = vi.fn();
  HTMLElement.prototype.scrollTo = vi.fn(); HTMLElement.prototype.scrollIntoView = vi.fn();
  window.matchMedia = vi.fn(() => ({ matches: true, addEventListener: vi.fn(), removeEventListener: vi.fn() })) as unknown as typeof window.matchMedia;
  idb = installIndexedDbDouble();
});
afterEach(async () => {
  cleanup();
  // An armed 450 ms autosave fires after unmount (docs/deferred-work.md §8b); drain it so it cannot
  // consume the next test's mock queue.
  await new Promise((resolve) => setTimeout(resolve, 600));
  idb?.uninstall(); idb = null; vi.restoreAllMocks();
});

describe("recovery draft: writing", () => {
  it("typing a name stores one record under the fixed key with the draft fields and an ISO timestamp", async () => {
    vi.mocked(saveMobileStepToSupabase).mockRejectedValue(new Error("offline")); // keep the draft from being cleared
    await openDraft();
    typeName("Fit bracket");
    await waitFor(() => expect(records()).toHaveLength(1));
    const [record] = records();
    expect(record).toMatchObject({ key: KEY, taskId: "task-a", name: "Fit bracket", instruction: "", durationText: "5", tools: [], photos: [], checks: [], checkValues: {} });
    expect(typeof record.stepId).toBe("string");
    expect(new Date(record.updatedAt as string).toISOString()).toBe(record.updatedAt);
    expect(idb!.databases.get(DB)!.get(STORE)!.keyPath).toBe("key");
  });

  it("further typing overwrites the same record rather than adding another", async () => {
    vi.mocked(saveMobileStepToSupabase).mockRejectedValue(new Error("offline"));
    await openDraft();
    typeName("Fit");
    await waitFor(() => expect(records()[0]?.name).toBe("Fit"));
    typeName("Fit bracket");
    await waitFor(() => expect(records()[0]?.name).toBe("Fit bracket"));
    expect(records()).toHaveLength(1);
  });

  it("a failed save keeps the record for recovery", async () => {
    vi.mocked(saveMobileStepToSupabase).mockRejectedValue(new Error("offline"));
    await openDraft();
    typeName("Fit bracket");
    await screen.findByRole("button", { name: "Retry save" }, { timeout: 3000 });
    expect(records()).toHaveLength(1);
    expect(records()[0]).toMatchObject({ name: "Fit bracket" });
  });

  it("a successful save with no autosave armed clears the record", async () => {
    await openDraft();
    typeName("Fit bracket");
    await waitFor(() => expect(saveMobileStepToSupabase).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(screen.getByRole("status").textContent).toBe("Saved"));
    await waitFor(() => expect(records()).toHaveLength(0));
    expect(idb!.closes).toBe(idb!.opens);
  });

  it("every database handle opened is closed again", async () => {
    vi.mocked(saveMobileStepToSupabase).mockRejectedValue(new Error("offline"));
    await openDraft();
    typeName("Fit bracket");
    await screen.findByRole("button", { name: "Retry save" });
    await waitFor(() => expect(idb!.closes).toBe(idb!.opens));
    expect(idb!.opens).toBeGreaterThan(0);
  });
});

describe("recovery draft: restoring on load", () => {
  it("re-opens a stored draft for an existing task, re-saves it after a short delay and clears the record", async () => {
    seedRecord({ taskId: "task-a", stepId: "step-r", name: "Recovered step", instruction: "Do it", durationText: "7", tools: ["Torque wrench"], photos: [], checks: [], updatedAt: "2026-10-04T10:00:00.000Z" });
    render(<MobilePhotoPortal projectId="p" initialPlannerState={state} />);
    const name = await screen.findByRole("textbox", { name: "New step name" });
    expect((name as HTMLInputElement).value).toBe("Recovered step");
    expect((screen.getByRole("textbox", { name: "Description" }) as HTMLTextAreaElement).value).toBe("Do it");
    expect(screen.getByText(RECOVERY_MESSAGE)).toBeInTheDocument();
    expect((screen.getByLabelText("Process name") as HTMLInputElement).value).toBe("Alpha process");
    await waitFor(() => expect(saveMobileStepToSupabase).toHaveBeenCalledTimes(1), { timeout: 2000 });
    expect(vi.mocked(saveMobileStepToSupabase).mock.calls[0][1]).toMatchObject({ id: "step-r", name: "Recovered step", instruction: "Do it", durationMinutes: 7 });
    await waitFor(() => expect(screen.getByRole("status").textContent).toBe("Saved"));
    await waitFor(() => expect(records()).toHaveLength(0));
  });

  it("a stored draft for a task that is not in this project is neither restored nor cleared", async () => {
    seedRecord({ taskId: "task-elsewhere", stepId: "step-x", name: "Other project draft", instruction: "", durationText: "5", tools: [], photos: [], checks: [], updatedAt: "2026-10-04T10:00:00.000Z" });
    render(<MobilePhotoPortal projectId="p" initialPlannerState={state} />);
    await screen.findByRole("button", { name: /Alpha process 0 steps/ });
    await new Promise((resolve) => setTimeout(resolve, 400));
    expect(screen.queryByRole("textbox", { name: "New step name" })).toBeNull();
    expect(saveMobileStepToSupabase).not.toHaveBeenCalled();
    expect(records()).toHaveLength(1);
  });

  it("a stored draft with no content is cleared without opening anything", async () => {
    seedRecord({ taskId: "task-a", stepId: "step-e", name: "", instruction: "   ", durationText: "5", tools: [], photos: [], checks: [], updatedAt: "2026-10-04T10:00:00.000Z" });
    render(<MobilePhotoPortal projectId="p" initialPlannerState={state} />);
    await screen.findByRole("button", { name: /Alpha process 0 steps/ });
    await waitFor(() => expect(records()).toHaveLength(0));
    expect(screen.queryByRole("textbox", { name: "New step name" })).toBeNull();
    expect(saveMobileStepToSupabase).not.toHaveBeenCalled();
  });

  it("KNOWN SCOPING: a stored draft from another project is overwritten by the next local draft write (single fixed key)", async () => {
    seedRecord({ taskId: "task-elsewhere", stepId: "s", name: "Other project draft", instruction: "", durationText: "5", tools: [], photos: [], checks: [], updatedAt: "2026-10-04T10:00:00.000Z" });
    vi.mocked(saveMobileStepToSupabase).mockRejectedValue(new Error("offline"));
    await openDraft();
    typeName("Local draft");
    await waitFor(() => expect(records()[0]?.name).toBe("Local draft"));
    // Current behaviour: one key for every project and user, so the foreign record is gone. This is the
    // scoping input for Package C (docs/edit-reliability-plan.md); not changed by the extraction.
    expect(records()).toHaveLength(1);
    expect(records()[0]).toMatchObject({ taskId: "task-a" });
  });
});

describe("recovery draft: storage failures", () => {
  it("without indexedDB the save still succeeds and the recovery-draft error message is shown", async () => {
    idb!.uninstall(); idb = null;
    expect(typeof (globalThis as { indexedDB?: unknown }).indexedDB).toBe("undefined");
    render(<MobilePhotoPortal projectId="p" initialPlannerState={state} />);
    fireEvent.click(await screen.findByRole("button", { name: /Alpha process 0 steps/ }));
    fireEvent.click(screen.getByRole("button", { name: "Add step" }));
    typeName("Fit bracket");
    await screen.findByText(STORAGE_ERROR);
    await waitFor(() => expect(screen.getByRole("status").textContent).toBe("Saved"));
  });

  it("an open failure surfaces the same message and does not block saving", async () => {
    idb!.uninstall(); idb = installIndexedDbDouble({ openError: new Error("blocked") });
    await openDraft();
    typeName("Fit bracket");
    await screen.findByText(STORAGE_ERROR);
    await waitFor(() => expect(screen.getByRole("status").textContent).toBe("Saved"));
  });

  it("a failed recovery load is ignored", async () => {
    idb!.uninstall(); idb = installIndexedDbDouble({ requestError: new Error("read failed") });
    render(<MobilePhotoPortal projectId="p" initialPlannerState={state} />);
    await screen.findByRole("button", { name: /Alpha process 0 steps/ });
    expect(screen.queryByText(STORAGE_ERROR)).toBeNull();
    expect(screen.queryByText(RECOVERY_MESSAGE)).toBeNull();
  });
});
