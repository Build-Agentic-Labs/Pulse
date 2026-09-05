import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SopDetailInitialData } from "@/lib/sop/detail-data";

const mocks = vi.hoisted(() => ({ workspace: { workspaceId: "org-a", canEditSops: false } }));
vi.mock("next/navigation", () => ({ useParams: () => ({ sopId: "sop-1" }) }));
vi.mock("@/lib/departments/store", () => ({ listDepartments: vi.fn(), listMyDepartments: vi.fn() }));
vi.mock("@/lib/sop/store", () => ({ getSop: vi.fn() }));
vi.mock("./sop-workspace-provider", () => ({
  useSopWorkspace: () => mocks.workspace,
  SopWorkspaceSwitcher: () => null,
}));
vi.mock("./sop-editor", () => ({
  SopEditor: ({ canEdit }: { canEdit: boolean }) => <button disabled={!canEdit}>Save SOP</button>,
}));
vi.mock("./sop-shell", () => ({ SopShell: () => null }));
vi.mock("./sop-detail-loading-state", () => ({ SopDetailLoadingState: () => null }));
import { SopDetailClient } from "./sop-detail-client";

const initial = {
  record: { sop: { id: "sop-1" }, workspaceId: "org-a", departmentId: "dept-a" },
  myDepartmentIds: ["dept-a"],
} as SopDetailInitialData;

beforeEach(() => {
  mocks.workspace = { workspaceId: "org-a", canEditSops: false };
});

describe("SOP detail permissions", () => {
  it("updates seeded detail when permissions finish loading or are revoked", () => {
    const { rerender } = render(<SopDetailClient initial={initial} />);
    expect(screen.getByRole("button", { name: "Save SOP" })).toBeDisabled();
    mocks.workspace.canEditSops = true;
    rerender(<SopDetailClient initial={initial} />);
    expect(screen.getByRole("button", { name: "Save SOP" })).toBeEnabled();
    mocks.workspace.canEditSops = false;
    rerender(<SopDetailClient initial={initial} />);
    expect(screen.getByRole("button", { name: "Save SOP" })).toBeDisabled();
  });

  it("does not borrow edit permission from a different organization", () => {
    mocks.workspace = { workspaceId: "org-b", canEditSops: true };
    render(<SopDetailClient initial={initial} />);
    expect(screen.getByRole("button", { name: "Save SOP" })).toBeDisabled();
  });

  it("keeps other departments' drafts read-only", () => {
    mocks.workspace.canEditSops = true;
    render(<SopDetailClient initial={{ ...initial, myDepartmentIds: [] }} />);
    expect(screen.getByRole("button", { name: "Save SOP" })).toBeDisabled();
  });
});
