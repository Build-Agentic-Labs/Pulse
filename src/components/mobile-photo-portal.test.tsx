// @vitest-environment jsdom
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { emptyPlannerState } from "@/domain/empty-planner-state";
import type { ManufacturingStep, PlannerState, Task } from "@/domain/types";
import { MobilePhotoPortal } from "./mobile-photo-portal";
import { deletePlannerTask, loadPlannerStateFromSupabase, loadTaskFromSupabase, subscribePlannerStateChanges, saveMobileStepToSupabase, saveTaskToSupabase } from "@/domain/supabase-planner";

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
const task: Task = {
  id: "task-test", scenarioId: "scenario-empty", stationId: "", wbs: "1", rowType: "task", name: "Test process",
  plannedStart: "2026-10-01T10:00:00Z", plannedFinish: "2026-10-01T10:00:00Z", plannedDurationMinutes: 0,
  plannedOperators: 1, plannedManHours: 0, status: "not_started", percentComplete: 0, dependencyIds: [],
  criticalPath: false, bottleneckFlag: false, qualityGate: false, travelerSignoffRequired: false,
  manufacturingSteps: [], customFields: {},
};
const state: PlannerState = { ...emptyPlannerState, product: { ...emptyPlannerState.product, projectId: "p", name: "Test project" }, tasks: [task] };
beforeEach(() => {
  vi.clearAllMocks(); localStorage.clear();
  vi.mocked(loadPlannerStateFromSupabase).mockResolvedValue(state);
  vi.mocked(saveMobileStepToSupabase).mockImplementation(async (_task, step) => ({ ...step, version: 1 }));
  window.scrollTo = vi.fn();
  window.scrollBy = vi.fn();
  HTMLElement.prototype.scrollTo = vi.fn();
  HTMLElement.prototype.scrollIntoView = vi.fn();
  window.matchMedia = vi.fn(() => ({ matches: true, addEventListener: vi.fn(), removeEventListener: vi.fn() })) as unknown as typeof window.matchMedia;
});
async function openStep() {
  render(<MobilePhotoPortal projectId="p" initialPlannerState={state} />);
  fireEvent.click(await screen.findByRole("button", { name: /Test process 0 steps/ }));
  fireEvent.click(screen.getByRole("button", { name: "Add step" }));
}
describe("phone step authoring", () => {
  it("reveals process deletion by swiping and keeps the row if deletion fails", async () => {
    render(<MobilePhotoPortal projectId="project-test" />);
    const row = await screen.findByRole("button", { name: /Test process 0 steps/ });
    fireEvent(row, new MouseEvent("pointerdown", { bubbles: true, clientX: 250, clientY: 100 }));
    fireEvent(row, new MouseEvent("pointermove", { bubbles: true, clientX: 120, clientY: 105 }));
    fireEvent(row, new MouseEvent("pointerup", { bubbles: true }));
    fireEvent.click(row);
    expect(screen.queryByRole("button", { name: "Add step" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Delete Test process" }));
    expect(deletePlannerTask).not.toHaveBeenCalled();
    vi.mocked(deletePlannerTask).mockRejectedValueOnce(new Error("offline"));
    fireEvent.click(screen.getByRole("button", { name: "Delete process" }));
    await screen.findByText("offline");
    expect(screen.getByRole("button", { name: /Test process 0 steps/ })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Delete Test process" }));
    fireEvent.click(screen.getByRole("button", { name: "Delete process" }));
    await waitFor(() => expect(screen.queryByRole("button", { name: /Test process 0 steps/ })).toBeNull());
    expect(deletePlannerTask).toHaveBeenLastCalledWith("task-test", "project-test");
  });
  it("saves the initial name and retains a failed draft for retry", async () => {
    vi.mocked(saveMobileStepToSupabase).mockRejectedValueOnce(new Error("offline"));
    await openStep();
    fireEvent.change(screen.getByRole("textbox", { name: "New step name" }), { target: { value: "Fit bracket" } });
    await screen.findByRole("button", { name: "Retry save" });
    expect((screen.getByRole("textbox", { name: "New step name" }) as HTMLInputElement).value).toBe("Fit bracket");
    fireEvent.click(screen.getByRole("button", { name: "Retry save" }));
    await waitFor(() => expect(screen.getByRole("status").textContent).toBe("Saved"));
    expect(vi.mocked(saveMobileStepToSupabase).mock.calls[1][2]).toMatchObject({ name: "Fit bracket" });
  });
  it("flushes a pending named draft on close and only sends the edited field next time", async () => {
    await openStep();
    fireEvent.change(screen.getByRole("textbox", { name: "New step name" }), { target: { value: "Fit bracket" } });
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    await waitFor(() => expect(saveMobileStepToSupabase).toHaveBeenCalledTimes(1));
    const saved = vi.mocked(saveMobileStepToSupabase).mock.calls[0][1] as ManufacturingStep;
    expect(saved.name).toBe("Fit bracket");
    fireEvent.click(await screen.findByRole("button", { name: "Expand step 1" }));
    const input = screen.getByRole("textbox", { name: "Step 1 description" });
    fireEvent.change(input, { target: { value: "Tighten the fasteners" } });
    fireEvent.blur(input);
    await waitFor(() => expect(saveMobileStepToSupabase).toHaveBeenCalledTimes(2));
    expect(vi.mocked(saveMobileStepToSupabase).mock.calls[1][2]).toEqual({ instruction: "Tighten the fasteners" });
  });
  it("opens the next draft only after the current step is saved", async () => {
    await openStep();
    fireEvent.change(screen.getByRole("textbox", { name: "New step name" }), { target: { value: "Bracket" } });
    await waitFor(() => expect(screen.getByRole("status").textContent).toBe("Saved"));
    fireEvent.click(screen.getByRole("button", { name: "Save & add next" }));
    await screen.findByPlaceholderText("New step 2");
    expect((screen.getByRole("textbox", { name: "New step name" }) as HTMLInputElement).value).toBe("");
    expect(screen.getByRole("button", { name: "Expand step 1" }).textContent).toContain("Bracket");
    expect(saveMobileStepToSupabase).toHaveBeenCalledTimes(2);
  });
  it("does not advance to another step when its save fails", async () => {
    await openStep();
    fireEvent.change(screen.getByRole("textbox", { name: "New step name" }), { target: { value: "Bracket" } });
    await waitFor(() => expect(screen.getByRole("status").textContent).toBe("Saved"));
    vi.mocked(saveMobileStepToSupabase).mockRejectedValueOnce(new Error("offline"));
    fireEvent.click(screen.getByRole("button", { name: "Save & add next" }));
    await screen.findByRole("button", { name: "Retry save" });
    expect((screen.getByRole("textbox", { name: "New step name" }) as HTMLInputElement).value).toBe("Bracket");
    expect(screen.queryByPlaceholderText("New step 2")).toBeNull();
  });
  it("keeps an expanded step edit visible and retries it after failure", async () => {
    await openStep();
    fireEvent.change(screen.getByRole("textbox", { name: "New step name" }), { target: { value: "Bracket" } });
    await waitFor(() => expect(screen.getByRole("status").textContent).toBe("Saved"));
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    fireEvent.click(await screen.findByRole("button", { name: "Expand step 1" }));
    vi.mocked(saveMobileStepToSupabase).mockRejectedValueOnce(new Error("offline"));
    const input = screen.getByRole("textbox", { name: "Step 1 description" });
    fireEvent.change(input, { target: { value: "Retained instruction" } });
    fireEvent.blur(input);
    await screen.findByRole("button", { name: "Retry save" });
    expect((input as HTMLTextAreaElement).value).toBe("Retained instruction");
    fireEvent.click(screen.getByRole("button", { name: "Retry save" }));
    await waitFor(() => expect(screen.getByRole("status").textContent).toBe("Saved"));
    expect(vi.mocked(saveMobileStepToSupabase).mock.calls.at(-1)?.[2]).toEqual({ instruction: "Retained instruction" });
  });
  it("adopts desktop changes into an idle open draft without resending the desktop field", async () => {
    await openStep();
    fireEvent.change(screen.getByRole("textbox", { name: "New step name" }), { target: { value: "Phone name" } });
    await waitFor(() => expect(saveMobileStepToSupabase).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(screen.getByRole("status").textContent).toBe("Saved"));
    const step = vi.mocked(saveMobileStepToSupabase).mock.calls[0][1];
    vi.mocked(loadTaskFromSupabase).mockResolvedValue({ ...task, manufacturingSteps: [{ ...step, version: 2, name: "Desktop name", instruction: "Desktop instruction" }] });
    const callback = vi.mocked(subscribePlannerStateChanges).mock.calls[0][0];
    await act(async () => { callback({ table: "manufacturing_steps", eventType: "UPDATE", new: { task_id: task.id, id: step.id }, old: {} } as Parameters<typeof callback>[0]); });
    await waitFor(() => expect((screen.getByRole("textbox", { name: "New step name" }) as HTMLInputElement).value).toBe("Desktop name"));
    fireEvent.change(screen.getByRole("textbox", { name: "Description" }), { target: { value: "Phone instruction" } });
    await waitFor(() => expect(saveMobileStepToSupabase).toHaveBeenCalledTimes(2));
    expect(vi.mocked(saveMobileStepToSupabase).mock.calls[1][2]).toEqual({ instruction: "Phone instruction" });
  });
  it("does not open a failed process as though it was saved", async () => {
    vi.mocked(saveTaskToSupabase).mockRejectedValueOnce(new Error("Process save failed"));
    render(<MobilePhotoPortal projectId="p" initialPlannerState={state} />);
    fireEvent.click(await screen.findByRole("button", { name: "Add process" }));
    fireEvent.change(screen.getByPlaceholderText("Process name"), { target: { value: "Unsaved process" } });
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Add process" })); });
    await screen.findByText("Process save failed");
    expect(screen.queryByRole("button", { name: /Unsaved process 0 steps/ })).toBeNull();
    expect(screen.getByPlaceholderText("Process name")).toBeTruthy();
  });
});
