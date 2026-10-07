// @vitest-environment jsdom
import {
  render,
  screen,
  fireEvent,
  waitFor,
  cleanup,
} from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import type { QualityWi } from "@/domain/quality-wi/schema";
import { WiDetails } from "./wi-details";
import { WiStepEditor } from "./wi-step-editor";
vi.mock("@/components/confirm-provider", () => ({
  useConfirm: () => vi.fn(async () => true),
}));
vi.mock("./wi-photos", () => ({ WiPhotos: () => <div>Image control</div> }));
const document: QualityWi = {
  id: "wi",
  workspaceId: "w",
  departmentId: "d",
  departmentCode: "PRO",
  departmentName: "Process",
  title: "Title",
  purpose: "Scope",
  responsibilities: "Engineer",
  documentNumber: null,
  version: 1,
  hasChanges: true,
  publishedRevisionId: null,
  updatedAt: "",
  steps: [
    {
      id: "a",
      position: 1,
      title: "Open",
      instruction: "Open file",
      image: null,
    },
    {
      id: "b",
      position: 2,
      title: "Save",
      instruction: "Save file",
      image: null,
    },
  ],
};
afterEach(() => cleanup());
it("edits one document field without sending a full snapshot", () => {
  const edit = vi.fn();
  render(<WiDetails document={document} disabled={false} onEdit={edit} />);
  fireEvent.change(screen.getByLabelText("Purpose / scope"), {
    target: { value: "Corrected scope" },
  });
  expect(edit).toHaveBeenCalledExactlyOnceWith({
    kind: "details",
    payload: { purpose: "Corrected scope" },
  });
});
it("makes a department viewer read only", () => {
  render(<WiDetails document={document} disabled={true} onEdit={vi.fn()} />);
  expect(screen.getByLabelText("Work instruction title")).toBeDisabled();
  expect(screen.getByLabelText("Responsibilities")).toBeDisabled();
});
it("reuses the instruction toolbar and emits step-only edits", () => {
  const edit = vi.fn();
  render(
    <WiStepEditor
      document={document}
      userId="author"
      disabled={false}
      onEdit={edit}
      onBusy={vi.fn()}
    />,
  );
  const instruction = screen.getByLabelText("Step 1 instruction");
  fireEvent.change(instruction, { target: { value: "New action" } });
  expect(edit).toHaveBeenCalledWith({
    kind: "step",
    payload: { id: "a", instruction: "New action" },
  });
  expect(
    screen.getByRole("group", { name: "Step 1 instruction formatting" }),
  ).toBeInTheDocument();
});
it("reorders a complete list and adds a stable new step id", () => {
  const edit = vi.fn();
  render(
    <WiStepEditor
      document={document}
      userId="author"
      disabled={false}
      onEdit={edit}
      onBusy={vi.fn()}
    />,
  );
  fireEvent.click(screen.getByRole("button", { name: "Move step 2 up" }));
  expect(edit).toHaveBeenCalledWith({
    kind: "reorder",
    payload: { ids: ["b", "a"] },
  });
  fireEvent.click(screen.getByRole("button", { name: /Add step/ }));
  expect(edit).toHaveBeenCalledWith({
    kind: "add_step",
    payload: { id: expect.stringMatching(/^[a-f0-9-]{36}$/) },
  });
});
it("removes only the chosen draft step after confirmation", async () => {
  const edit = vi.fn();
  render(
    <WiStepEditor
      document={document}
      userId="author"
      disabled={false}
      onEdit={edit}
      onBusy={vi.fn()}
    />,
  );
  fireEvent.click(screen.getByRole("button", { name: "Remove step 1" }));
  await waitFor(() =>
    expect(edit).toHaveBeenCalledWith({
      kind: "remove_step",
      payload: { id: "a" },
    }),
  );
});
