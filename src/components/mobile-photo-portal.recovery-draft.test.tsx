// @vitest-environment jsdom
// Characterization of the mobile New Step recovery draft (IndexedDB) as observed through the rendered
// portal, written before the store was extracted into mobile-photo-portal/recovery-draft-store.ts and kept
// unchanged across the move. The IndexedDB double stands in for the browser's store; one test keeps jsdom's
// default (no indexedDB) to pin the unavailable-storage path.
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { emptyPlannerState } from "@/domain/empty-planner-state";
import type { PlannerState, Task } from "@/domain/types";
import { installIndexedDbDouble, type IndexedDbDouble } from "@/test-support/indexeddb-double";
import { mobileAuth } from "@/test-support/mobile-auth";
import { MobilePhotoPortal } from "./mobile-photo-portal";
import { loadPlannerStateFromSupabase, saveMobileStepToSupabase, syncStepToolsForStepToSupabase } from "@/domain/supabase-planner";

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

const DB = "buildlogic-mobile-drafts";
const STORE = "drafts";
const KEY = "mobile-new-step-draft-v2:user-test:p:task-a";
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
  const db = new Map(); db.set(STORE, { keyPath: "key", rows: new Map([[KEY, { key: KEY, schemaVersion: 2, userId: "user-test", projectId: "p", draftId: record.stepId, writeToken: "seed-token", ...record }]]) });
  idb!.databases.set(DB, db);
}
async function openDraft() {
  render(<MobilePhotoPortal projectId="p" initialPlannerState={state} />);
  fireEvent.click(await screen.findByRole("button", { name: /Alpha process 0 steps/ }));
  fireEvent.click(screen.getByRole("button", { name: "Add step" }));
  await screen.findByRole("textbox", { name: "New step name" });
}
const typeName = (value: string) => fireEvent.change(screen.getByRole("textbox", { name: "New step name" }), { target: { value } });

beforeEach(() => {
  mobileAuth.userId = "user-test";
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
  // Allow already-issued storage/save callbacks to settle before removing the browser double.
  // Unsent autosaves are cancelled by editor cleanup.
  await new Promise((resolve) => setTimeout(resolve, 600));
  idb?.uninstall(); idb = null; vi.restoreAllMocks();
});

describe("recovery draft: writing", () => {
  it("typing a name stores one record under its scoped key with the draft fields and an ISO timestamp", async () => {
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

  it("a stored draft with no content is preserved without opening anything", async () => {
    seedRecord({ taskId: "task-a", stepId: "step-e", name: "", instruction: "   ", durationText: "5", tools: [], photos: [], checks: [], updatedAt: "2026-10-04T10:00:00.000Z" });
    render(<MobilePhotoPortal projectId="p" initialPlannerState={state} />);
    await screen.findByRole("button", { name: /Alpha process 0 steps/ });
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(records()).toHaveLength(1);
    expect(screen.queryByRole("textbox", { name: "New step name" })).toBeNull();
    expect(saveMobileStepToSupabase).not.toHaveBeenCalled();
  });

  it("preserves a foreign-product draft when the next local draft is written", async () => {
    const foreignKey = "mobile-new-step-draft-v2:user-test:other:task-elsewhere";
    seedRecord({ key: foreignKey, projectId: "other", taskId: "task-elsewhere", draftId: "s", stepId: "s", name: "Other project draft", instruction: "", durationText: "5", tools: [], photos: [], checks: [], updatedAt: "2026-10-04T10:00:00.000Z" });
    // SeedRecord stores by the requested key.
    const rows = idb!.databases.get(DB)!.get(STORE)!.rows;
    rows.set(foreignKey, rows.get(KEY)!); rows.delete(KEY);
    vi.mocked(saveMobileStepToSupabase).mockRejectedValue(new Error("offline"));
    await openDraft(); typeName("Local draft");
    await waitFor(() => expect(records()).toHaveLength(2));
    expect(records().find((row) => row.key === foreignKey)?.name).toBe("Other project draft");
  });

});

describe("recovery draft: storage failures", () => {
  it("without indexedDB the save still succeeds and the recovery-draft error message is shown", async () => {
    idb!.uninstall(); idb = null;
    expect(typeof (globalThis as { indexedDB?: unknown }).indexedDB).toBe("undefined");
    render(<MobilePhotoPortal projectId="p" initialPlannerState={state} />);
    fireEvent.click(await screen.findByRole("button", { name: /Alpha process 0 steps/ }));
    fireEvent.click(screen.getByRole("button", { name: "Add step" }));
  await screen.findByRole("textbox", { name: "New step name" });
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

describe("scoped recovery lifecycle", () => {
  it("account switching cancels unsent work and detaches the previous editor without deleting its draft", async () => {
    vi.mocked(saveMobileStepToSupabase).mockRejectedValue(new Error("offline"));
    await openDraft(); typeName("Only user one");
    await waitFor(() => expect(records()[0]?.name).toBe("Only user one"));
    const before = structuredClone(records()[0]);
    act(() => mobileAuth.change("user-two"));
    await screen.findByRole("button", { name: /Alpha process 0 steps/ });
    expect(screen.queryByDisplayValue("Only user one")).toBeNull();
    await new Promise((resolve) => setTimeout(resolve, 550));
    expect(saveMobileStepToSupabase).not.toHaveBeenCalled();
    expect(records()[0]).toEqual(before);
    act(() => mobileAuth.change("user-test"));
    await screen.findByDisplayValue("Only user one");
  });

  it("late step completion after account switching cannot start tool synchronization or clear recovery", async () => {
    let finish!: (value: never) => void;
    vi.mocked(saveMobileStepToSupabase).mockImplementation(() => new Promise((resolve) => { finish = resolve; }));
    await openDraft(); typeName("Retained");
    await waitFor(() => expect(saveMobileStepToSupabase).toHaveBeenCalledTimes(1));
    act(() => mobileAuth.change("user-two"));
    await screen.findByRole("button", { name: /Alpha process 0 steps/ });
    await act(async () => { finish({ id: "step", sequence: 1, version: 1 } as never); });
    expect(syncStepToolsForStepToSupabase).not.toHaveBeenCalled();
    expect(records()[0]?.name).toBe("Retained");
    expect(screen.queryByDisplayValue("Retained")).toBeNull();
  });

  it("keeps a newer local edit after an older remote save finishes", async () => {
    let finish!: (value: never) => void;
    vi.mocked(saveMobileStepToSupabase).mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; })).mockRejectedValue(new Error("offline"));
    await openDraft(); typeName("Old");
    await waitFor(() => expect(saveMobileStepToSupabase).toHaveBeenCalledTimes(1));
    const oldToken = records()[0]?.writeToken;
    typeName("Newer");
    await waitFor(() => expect(records()[0]?.name).toBe("Newer"));
    expect(records()[0]?.writeToken).not.toBe(oldToken);
    await act(async () => { finish({ sequence: 1, version: 1 } as never); });
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(records()[0]?.name).toBe("Newer");
  });

  it("a failed tool save does not acknowledge a successfully written step", async () => {
    vi.mocked(syncStepToolsForStepToSupabase).mockRejectedValueOnce(new Error("tools failed"));
    await openDraft(); typeName("Needs tool confirmation");
    await screen.findByRole("button", { name: "Retry save" });
    expect(records()[0]?.name).toBe("Needs tool confirmation");
  });

  it("no identity uses no recovery slot while the existing remote path can still run", async () => {
    mobileAuth.userId = null;
    await openDraft(); typeName("Memory only");
    await screen.findByText(STORAGE_ERROR);
    expect(records()).toEqual([]);
    await waitFor(() => expect(saveMobileStepToSupabase).toHaveBeenCalledTimes(1));
  });

  it("does not automatically hydrate a previous account's unowned parked payload", async () => {
    const legacy = JSON.stringify({ captureTimer: { running: false, storedElapsedMs: 0 }, activeScreen: "detail", selectedTaskId: "task-a", showNewStepForm: true,
      parkedCaptureByTaskId: { "task-a": { timer: { running: true, taskId: "task-a", activeStepId: "s", storedElapsedMs: 1000 }, newStepId: "s", draftInstruction: "Unowned text", draftTools: [], draftPhotos: [], draftChecks: [] } } });
    localStorage.setItem("pulse:mobile-capture-session:p", legacy);
    await openDraft();
    expect(screen.queryByDisplayValue("Unowned text")).toBeNull();
    expect(localStorage.getItem("pulse:mobile-capture-session:p")).toBe(legacy);
  });

  it("keeps legacy IndexedDB content untouched while writing a new owned draft", async () => {
    const legacyKey = "mobile-new-step-draft-v1";
    seedRecord({ key: legacyKey, taskId: "task-a", stepId: "legacy", name: "Unowned", instruction: "", durationText: "5", tools: [], photos: [], checks: [], updatedAt: "2026-10-04T10:00:00.000Z" });
    const rows = idb!.databases.get(DB)!.get(STORE)!.rows;
    const legacy = rows.get(KEY)!; rows.set(legacyKey, legacy); rows.delete(KEY);
    vi.mocked(saveMobileStepToSupabase).mockRejectedValue(new Error("offline"));
    await openDraft();
    expect(screen.queryByDisplayValue("Unowned")).toBeNull();
    typeName("Owned"); await waitFor(() => expect(records()).toHaveLength(2));
    expect(rows.get(legacyKey)).toEqual(legacy);
  });
});

describe("explicit legacy recovery", () => {
  it("review and Back leave storage and saves untouched; Use retains legacy and saves the same step identity", async () => {
    const legacy = { key: "mobile-new-step-draft-v1", taskId: "task-a", stepId: "legacy-step", name: "Earlier bracket", instruction: "Earlier instruction", durationText: "5", tools: [], photos: [], checks: [], checkValues: {}, updatedAt: "2026-10-01T12:00:00Z" };
    const db = new Map(); db.set(STORE, { keyPath: "key", rows: new Map([[legacy.key, legacy]]) }); idb!.databases.set(DB, db);
    render(<MobilePhotoPortal projectId="p" initialPlannerState={state} />);
    fireEvent.click(await screen.findByRole("button", { name: /Alpha process 0 steps/ }));
    fireEvent.click(await screen.findByRole("button", { name: "Review saved draft" }));
    expect(screen.getByText("Earlier instruction")).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: /^Back$/ }));
    expect(saveMobileStepToSupabase).not.toHaveBeenCalled(); expect(records()).toEqual([legacy]);
    fireEvent.click(screen.getByRole("button", { name: "Review saved draft" }));
    fireEvent.click(screen.getByRole("button", { name: "Use this draft" }));
    await waitFor(() => expect(saveMobileStepToSupabase).toHaveBeenCalled());
    expect(vi.mocked(saveMobileStepToSupabase).mock.calls[0][1].id).toBe("legacy-step");
    await waitFor(() => expect(records()).toEqual([legacy]));
  });
});


it("keeps a linked task recovery record and displays its text without autosaving", async () => {
  seedRecord({ taskId: "task-a", stepId: "step-r", name: "Kept phone step", instruction: "Keep this instruction", durationText: "7", tools: [], photos: [], checks: [], updatedAt: "2026-10-04T10:00:00.000Z" });
  const linkedState = { ...state, tasks: [{ ...taskA, customFields: { awiMasterLink: { masterId: "m", projectId: "master-project", taskId: "master-task", documentNumber: "AWI-42" } } }] };
  vi.mocked(loadPlannerStateFromSupabase).mockResolvedValue(linkedState);
  render(<MobilePhotoPortal projectId="p" initialPlannerState={linkedState} />);
  fireEvent.click(await screen.findByRole("button", { name: /Alpha process 0 steps/ }));
  expect(await screen.findByText(/An unsaved step from this phone is kept here:.*Kept phone step.*Keep this instruction/)).toBeInTheDocument();
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, 400)); });
  expect(screen.queryByRole("textbox", { name: "New step name" })).toBeNull();
  expect(screen.queryByText(RECOVERY_MESSAGE)).toBeNull();
  expect(saveMobileStepToSupabase).not.toHaveBeenCalled();
  expect(records()).toHaveLength(1);
  expect(records()[0]).toMatchObject({ name: "Kept phone step", instruction: "Keep this instruction" });
});
