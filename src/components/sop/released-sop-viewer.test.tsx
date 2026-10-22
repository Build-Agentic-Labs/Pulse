import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { ReleasedSopViewer } from "./released-sop-viewer";
import { createPlannerSupabaseClient } from "@/domain/supabase-planner";
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));
vi.mock("@/domain/supabase-planner", () => ({ createPlannerSupabaseClient: vi.fn() }));
vi.mock("./sop-print-preview", () => ({
  SopPrintPreview: ({ sop, frozenApprovals }: { sop: { meta: { version: string }; purpose: string }; frozenApprovals: { name: string }[] }) =>
    <div><p>Effective version {sop.meta.version}</p><p>{sop.purpose}</p><p>{frozenApprovals[0]?.name}</p></div>,
}));
describe("released snapshot viewer", () => {
  it("renders the frozen document and original approvals without fetching the working draft", async () => {
    const rpc = vi.fn(async () => ({ error: null, data: {
      version: "1.0", released_at: "2026-10-01", sop_number: "SOP-001",
      document: { meta: { title: "Original" }, purpose: "Original effective text" },
      approvals: [{ id: "signature", signer_printed_name: "Original Approver", signed_at: "2026-10-01", meaning: "dept_approval" }],
      files: [],
    } }));
    vi.mocked(createPlannerSupabaseClient).mockReturnValue({ rpc } as unknown as ReturnType<typeof createPlannerSupabaseClient>);
    render(<ReleasedSopViewer sopId="sop-1" />);
    expect(await screen.findByText("Effective version 1.0")).toBeTruthy();
    expect(screen.getByText("Original effective text")).toBeTruthy();
    expect(screen.getByText("Original Approver")).toBeTruthy();
    expect(rpc).toHaveBeenCalledWith("get_sop_effective_release", { p_sop: "sop-1" });
  });
  it("does not render or offer a download when there is no current release", async () => {
    vi.mocked(createPlannerSupabaseClient).mockReturnValue({ rpc: vi.fn(async () => ({ data: null, error: null })) } as unknown as ReturnType<typeof createPlannerSupabaseClient>);
    render(<ReleasedSopViewer sopId="retired" />);
    expect(await screen.findByRole("alert")).toHaveTextContent("No current effective release");
    expect(screen.queryByText(/Effective version/)).toBeNull();
  });
});
