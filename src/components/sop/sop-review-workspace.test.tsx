// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SopReviewWorkspace } from "./sop-review-workspace";
import { saveSopReviewRemark, submitSopReviewResult } from "@/lib/sop/review-annotations";

vi.mock("@/components/confirm-provider", () => ({ useConfirm: () => vi.fn() }));
vi.mock("@/domain/supabase-planner", () => ({ createPlannerSupabaseClient: vi.fn(), getUserFromSession: async () => ({ data: { user: { id: "reviewer" } } }) }));
vi.mock("@/lib/sop/annex-files", () => ({ listSopAnnexFiles: async () => [] }));
vi.mock("@/lib/sop/store", () => ({ getSop: async () => ({ sop: { id: "sop" } }) }));
vi.mock("@/lib/sop/review", () => ({ getSopControl: async () => ({ reviewCycle: 1, contentHash: "hash" }) }));
vi.mock("@/lib/sop/review-annotations", () => ({
  listSopReviewAnnotations: async () => [], listSopReviewSubmissions: async () => [],
  saveSopReviewRemark: vi.fn(), submitSopReviewResult: vi.fn().mockResolvedValue("submission"), deleteSopReviewAnnotation: vi.fn(),
}));
vi.mock("./sop-print-preview", () => ({ SopPrintPreview: (props: {
  taskLabel: string; footerActions: React.ReactNode; marginNotes: {key: string; node: React.ReactNode}[];
  onSelectReviewSection: (category: string, quote: string, attachment?: {id: string; name: string}) => void; onClose: () => void;
}) => <div><h1>{props.taskLabel}</h1>{props.footerActions}
  <button onClick={() => props.onSelectReviewSection("purpose", "Selected purpose")}>Select purpose text</button>
  <button onClick={() => props.onSelectReviewSection("scope", "")}>Select empty scope</button>
  <button onClick={() => props.onSelectReviewSection("annexes", "", { id: "form-123", name: "Inspection form.pdf" })}>Comment on attachment</button>
  <button onClick={props.onClose}>Close</button>
  {props.marginNotes.map((note) => <div key={note.key}>{note.node}</div>)}
</div> }));

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} });
  vi.mocked(saveSopReviewRemark).mockImplementation(async ({category, body}) => ({ id: crypto.randomUUID(), sopId: "sop", reviewCycle: 1, category, body, createdBy: "reviewer", authorName: "You", createdAt: "", resolvedAt: null, resolvedBy: null, pageNumber: null, xPercent: null, yPercent: null }));
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe("review margin comments", () => {
  it("keeps selected text outside the field and saves only explicitly", async () => {
    const onClose = vi.fn();
    render(<SopReviewWorkspace sopId="sop" onClose={onClose} />);
    await screen.findByRole("heading", { name: "Review document" });
    fireEvent.click(screen.getByText("Select purpose text"));
    const field = screen.getByLabelText("Purpose");
    expect(field).toHaveValue("");
    expect(screen.queryByText("Selected purpose")).not.toBeInTheDocument();
    expect(saveSopReviewRemark).not.toHaveBeenCalled();
    fireEvent.change(field, { target: { value: "Please clarify this." } });
    expect(field).toHaveValue("Please clarify this.");
    expect(saveSopReviewRemark).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Save comment" }));
    await waitFor(() => expect(screen.queryByRole("button", { name: "Cancel" })).not.toBeInTheDocument());
    fireEvent.click(screen.getByText("Close"));
    await waitFor(() => expect(onClose).toHaveBeenCalledOnce());
    expect(saveSopReviewRemark).toHaveBeenCalledWith({ sopId: "sop", category: "purpose", body: "Selected text: “Selected purpose”\nPlease clarify this." });
    expect(submitSopReviewResult).not.toHaveBeenCalled();
  });

  it("opens an empty section without creating a remark and submits no-change reviews", async () => {
    render(<SopReviewWorkspace sopId="sop" onClose={vi.fn()} />);
    await screen.findByRole("heading", { name: "Review document" });
    fireEvent.click(screen.getByText("Select empty scope"));
    expect(screen.getByLabelText("Scope")).toHaveValue("");
    expect(saveSopReviewRemark).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    fireEvent.click(screen.getByLabelText("No changes needed"));
    fireEvent.click(screen.getByRole("button", { name: "Submit review" }));
    await waitFor(() => expect(submitSopReviewResult).toHaveBeenCalledWith("sop", true));
  });
  it("discards typed text on Cancel and reopens an empty field", async () => {
    render(<SopReviewWorkspace sopId="sop" onClose={vi.fn()} />);
    await screen.findByRole("heading", { name: "Review document" });
    fireEvent.click(screen.getByText("Select purpose text"));
    fireEvent.change(screen.getByLabelText("Purpose"), { target: { value: "Discard me" } });
    expect(screen.getByRole("button", { name: "Send feedback to author" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    fireEvent.click(screen.getByText("Select purpose text"));
    expect(screen.getByLabelText("Purpose")).toHaveValue("");
    expect(screen.getByRole("button", { name: "Save comment" })).toBeDisabled();
    expect(saveSopReviewRemark).not.toHaveBeenCalled();
  });

  it("retains the draft after a failed save so it can be retried", async () => {
    vi.mocked(saveSopReviewRemark).mockRejectedValueOnce(new Error("Offline"));
    render(<SopReviewWorkspace sopId="sop" onClose={vi.fn()} />);
    await screen.findByRole("heading", { name: "Review document" });
    fireEvent.click(screen.getByText("Select purpose text"));
    fireEvent.change(screen.getByLabelText("Purpose"), { target: { value: "Keep this draft" } });
    fireEvent.click(screen.getByRole("button", { name: "Save comment" }));
    await waitFor(() => expect(screen.getByLabelText("Purpose")).toBeEnabled());
    expect(screen.getByLabelText("Purpose")).toHaveValue("Keep this draft");
    fireEvent.click(screen.getByRole("button", { name: "Save comment" }));
    await waitFor(() => expect(screen.queryByRole("button", { name: "Cancel" })).not.toBeInTheDocument());
    expect(saveSopReviewRemark).toHaveBeenCalledTimes(2);
  });

  it("preserves saved comments when a later draft is canceled", async () => {
    render(<SopReviewWorkspace sopId="sop" onClose={vi.fn()} />);
    await screen.findByRole("heading", { name: "Review document" });
    fireEvent.click(screen.getByText("Select purpose text"));
    fireEvent.change(screen.getByLabelText("Purpose"), { target: { value: "Saved comment" } });
    fireEvent.click(screen.getByRole("button", { name: "Save comment" }));
    await waitFor(() => expect(screen.queryByRole("button", { name: "Cancel" })).not.toBeInTheDocument());
    fireEvent.click(screen.getByText("Select purpose text"));
    expect(screen.getByLabelText("Purpose")).toHaveValue("");
    fireEvent.change(screen.getByLabelText("Purpose"), { target: { value: "Abandoned second comment" } });
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.getByText(/Saved comment/)).toBeInTheDocument();
    expect(saveSopReviewRemark).toHaveBeenCalledTimes(1);
  });

  it("ties attachment feedback to the file while keeping the field empty", async () => {
    render(<SopReviewWorkspace sopId="sop" onClose={vi.fn()} />);
    await screen.findByRole("heading", { name: "Review document" });
    fireEvent.click(screen.getByText("Comment on attachment"));
    expect(screen.getByLabelText("Annexes & forms")).toHaveValue("");
    fireEvent.change(screen.getByLabelText("Annexes & forms"), { target: { value: "Add a signature field on page 2." } });
    fireEvent.click(screen.getByRole("button", { name: "Save comment" }));
    await waitFor(() => expect(saveSopReviewRemark).toHaveBeenCalledWith({ sopId: "sop", category: "annexes", body: "[Attachment:form-123] Inspection form.pdf\nAdd a signature field on page 2." }));
    await waitFor(() => expect(screen.getByText(/Attachment: Inspection form.pdf/)).toBeInTheDocument());
  });

  it("saves two comments in one section as independent records", async () => {
    render(<SopReviewWorkspace sopId="sop" onClose={vi.fn()} />);
    await screen.findByRole("heading", { name: "Review document" });
    for (const body of ["First concern", "Second concern"]) {
      fireEvent.click(screen.getByText("Select purpose text"));
      fireEvent.change(screen.getByLabelText("Purpose"), { target: { value: body } });
      fireEvent.click(screen.getByRole("button", { name: "Save comment" }));
      await waitFor(() => expect(screen.queryByRole("button", { name: "Cancel" })).not.toBeInTheDocument());
    }
    expect(saveSopReviewRemark).toHaveBeenNthCalledWith(2, { sopId: "sop", category: "purpose", body: "Selected text: “Selected purpose”\nSecond concern" });
    expect(screen.getByText("First concern")).toBeInTheDocument();
    expect(screen.getByText("Second concern")).toBeInTheDocument();
    expect(screen.getAllByLabelText("Delete Purpose remarks")).toHaveLength(2);
  });

});
