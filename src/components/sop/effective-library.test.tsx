import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { EffectiveLibrary } from "./effective-library";
import { listEffectiveLibrary } from "@/lib/sop/controlled-changes";
import { getSopControl, transitionSop } from "@/lib/sop/review";
import { getUserFromSession } from "@/domain/supabase-planner";
import type { SopListItem } from "@/lib/sop/store";
import type { Department } from "@/domain/departments";
const push = vi.hoisted(() => vi.fn());
vi.mock("next/navigation", () => ({ useRouter: () => ({ push }) }));
vi.mock("./sop-workspace-provider", () => ({ useSopWorkspace: () => ({ workspaceId: "ws", canEditSops: true }) }));
vi.mock("@/lib/sop/controlled-changes", () => ({ listEffectiveLibrary: vi.fn() }));
vi.mock("@/lib/sop/review", () => ({ getSopControl: vi.fn(), transitionSop: vi.fn() }));
vi.mock("@/domain/supabase-planner", () => ({ createPlannerSupabaseClient: vi.fn(), getUserFromSession: vi.fn() }));
vi.mock("@/lib/departments/store", () => ({ listDepartments: vi.fn(async () => [department]) }));
vi.mock("@/components/ui/modal-surface", () => ({ ModalSurface: ({ children }: { children: React.ReactNode }) => <div role="dialog">{children}</div> }));
const department = { id: "d", workspaceId: "ws", name: "Production", code: "PRD" } as Department;
const row = { id: "s1", title: "Controlled document", sopNumber: "SOP-PRD-001", version: "1.0", status: "effective", departmentId: "d", updatedAt: "2026-10-01", createdBy: "author", supportsControlledChanges: true } as SopListItem;
beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(listEffectiveLibrary).mockResolvedValue([row]);
  vi.mocked(getUserFromSession).mockResolvedValue({ data: { user: { id: "author" } }, error: null } as Awaited<ReturnType<typeof getUserFromSession>>);
  vi.mocked(getSopControl).mockResolvedValue({ status: "effective", updatedAt: "token" } as Awaited<ReturnType<typeof getSopControl>>);
  vi.mocked(transitionSop).mockResolvedValue({} as Awaited<ReturnType<typeof transitionSop>>);
});
function show(rows = [row]) {
  vi.mocked(listEffectiveLibrary).mockResolvedValue(rows);
  return render(<EffectiveLibrary initialSops={rows} initialDepartments={[department]} initialWorkspaceId="ws" />);
}
describe("Effective Library controlled changes", () => {
  it("keeps released previews separate from the working draft and starts the chosen version path", async () => {
    show();
    expect(screen.getByRole("link", { name: /Controlled document/ }).getAttribute("href")).toBe("/sops/s1/released");
    fireEvent.click(await screen.findByRole("button", { name: "Make a change" }));
    expect(screen.getByRole("menuitem", { name: "Minor Revision (1.1)" })).toBeTruthy();
    expect(screen.getAllByRole("menuitem")).toHaveLength(2);
    expect(screen.queryByRole("textbox")).toBeNull();
    fireEvent.click(screen.getByRole("menuitem", { name: "New Version (2.0)" }));
    await waitFor(() => expect(push).toHaveBeenCalledWith("/sops/s1?change=MAJOR"));
    expect(transitionSop).not.toHaveBeenCalled();
  });
  it("shows the actual next numbers for an already revised SOP", async () => {
    show([{ ...row, version: "3.9" }]);
    fireEvent.click(await screen.findByRole("button", { name: "Make a change" }));
    expect(screen.getByRole("menuitem", { name: "Minor Revision (3.10)" })).toBeTruthy();
    expect(screen.getByRole("menuitem", { name: "New Version (4.0)" })).toBeTruthy();
  });
  it("does not offer a second draft while a controlled change is open", async () => {
    show([{ ...row, hasWorkingDraft: true, workingVersion: "1.1", changeSignificance: "MINOR" }]);
    expect(await screen.findByRole("link", { name: /New revision \(1.1\) in progress/ })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Make a change" })).toBeNull();
  });
  it("does not offer author actions to another member", async () => {
    vi.mocked(getUserFromSession).mockResolvedValue({ data: { user: { id: "reader" } }, error: null } as Awaited<ReturnType<typeof getUserFromSession>>);
    show();
    await waitFor(() => expect(getUserFromSession).toHaveBeenCalled());
    expect(screen.queryByRole("button", { name: "Make a change" })).toBeNull();
  });
  it("refuses a stale action when the SOP has already entered a draft", async () => {
    vi.mocked(getSopControl).mockResolvedValue({ status: "draft" } as Awaited<ReturnType<typeof getSopControl>>);
    show();
    fireEvent.click(await screen.findByRole("button", { name: "Make a change" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Minor Revision (1.1)" }));
    expect(await screen.findByText(/working change already exists/)).toBeTruthy();
    expect(transitionSop).not.toHaveBeenCalled();
  });
});
