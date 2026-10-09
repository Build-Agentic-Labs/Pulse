import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import { AwiEditorActions } from "./awi-editor-actions";
import { updateAwiMetadata, type AwiMaster } from "@/lib/awi/store";
import { emptyPlannerState } from "@/domain/empty-planner-state";
vi.mock("@/lib/awi/store", () => ({ updateAwiMetadata: vi.fn() }));
vi.mock("./work-instruction/work-instruction-print", () => ({ WorkInstructionPrintPreview: ({ sopViewer }: { sopViewer: boolean }) => <div role="dialog">{sopViewer ? "SOP viewer" : "Other viewer"}</div> }));
const master = { id: "m", project_id: "p", task_id: "t", document_number: "AWI-2", category: "Trailer" } as AwiMaster;
beforeEach(() => { vi.mocked(updateAwiMetadata).mockReset(); });
it("offers a local recovery download and the failure reason when saving fails", () => {
  render(<AwiEditorActions master={master} state={emptyPlannerState} saveState="error" saveError="Save conflict"
    readOnly={false} ready beforeSave={vi.fn()} />);
  expect(screen.getByRole("status")).toHaveAttribute("title", "Save conflict");
  expect(screen.getByRole("button", { name: "Download draft" })).toBeEnabled();
  expect(updateAwiMetadata).not.toHaveBeenCalled();
});
it("opens the shared preview for read-only users without offering metadata edits", () => {
  render(<AwiEditorActions master={master} saveState="saved" readOnly ready beforeSave={vi.fn()} />);
  expect(screen.queryByRole("button", { name: "AWI details" })).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Preview" }));
  expect(screen.getByRole("dialog")).toHaveTextContent("SOP viewer");
});
it("keeps metadata unchanged when procedure saving fails", async () => {
  render(<AwiEditorActions master={master} saveState="saved" readOnly={false} ready beforeSave={async () => false} />);
  fireEvent.click(screen.getByRole("button", { name: "AWI details" }));
  fireEvent.change(screen.getByLabelText("AWI number"), { target: { value: "AWI-3" } });
  fireEvent.click(screen.getByRole("button", { name: "Save" }));
  await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("Save the procedure changes"));
  expect(updateAwiMetadata).not.toHaveBeenCalled();
});
it("preserves input and displays duplicate-number errors", async () => {
  vi.mocked(updateAwiMetadata).mockImplementation(async () => { throw new Error("That AWI number is already in use."); });
  render(<AwiEditorActions master={master} saveState="saved" readOnly={false} ready beforeSave={async () => true} />);
  fireEvent.click(screen.getByRole("button", { name: "AWI details" }));
  fireEvent.change(screen.getByLabelText("AWI number"), { target: { value: "AWI-3" } });
  await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Save" })); });
  await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("already in use"));
  expect(screen.getByLabelText("AWI number")).toHaveValue("AWI-3");
});
