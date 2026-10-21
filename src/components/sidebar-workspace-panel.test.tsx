// @vitest-environment jsdom
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { WorkspaceProjectGroup } from "@/domain/types";
import { SidebarWorkspacePanel } from "./sidebar-workspace-panel";

vi.mock("next/navigation", () => ({ useRouter: () => ({ prefetch: vi.fn() }), usePathname: () => "/" }));
vi.mock("@/domain/supabase-planner", () => ({ createPlannerSupabaseClient: () => ({ auth: { onAuthStateChange: () => ({ data: { subscription: { unsubscribe: vi.fn() } } }) } }) }));
vi.mock("@/lib/supabase-auth", () => ({ resolveSupabaseSession: async () => ({ session: { user: { id: "user-1" } } }) }));
vi.mock("@/lib/planner-state-cache", () => ({ readCachedMainPlannerStateSync: () => null, readCachedPlannerState: async () => null }));
vi.mock("./nav-selection-track", () => ({ NavSelectionTrack: ({ children }: { children: React.ReactNode }) => <div>{children}</div> }));

function group(role: "editor" | "admin", access: "edit" | "view"): WorkspaceProjectGroup {
  return {
    workspace: { id: "workspace-1", name: "Test", createdAt: "", updatedAt: "" },
    role, productAccess: access,
    projects: [{ id: "project-1", workspaceId: "workspace-1", name: "Test product", status: "active", accessLevel: access, createdAt: "", updatedAt: "" }],
  } as WorkspaceProjectGroup;
}

describe("product sidebar permissions", () => {
  it("lets product editors open rename without exposing administrative actions", () => {
    render(<SidebarWorkspacePanel initialGroups={[group("editor", "edit")]} />);
    fireEvent.click(screen.getByRole("button", { name: "Test product settings" }));
    expect(screen.getByRole("menuitem", { name: "Rename product" })).toBeEnabled();
    expect(screen.queryByRole("menuitem", { name: "Archive product" })).not.toBeInTheDocument();
    expect(screen.queryByRole("menuitem", { name: "Remove" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("menuitem", { name: "Rename product" }));
    expect(screen.getByDisplayValue("Test product")).toBeInTheDocument();
  });

  it("hides the menu for view-only product access", () => {
    render(<SidebarWorkspacePanel initialGroups={[group("editor", "view")]} />);
    expect(screen.queryByRole("button", { name: "Test product settings" })).not.toBeInTheDocument();
  });

  it("retains administrative actions for admins", () => {
    render(<SidebarWorkspacePanel initialGroups={[group("admin", "edit")]} />);
    fireEvent.click(screen.getByRole("button", { name: "Test product settings" }));
    expect(screen.getByRole("menuitem", { name: "Archive product" })).toBeEnabled();
    expect(screen.getByRole("menuitem", { name: "Remove" })).toBeEnabled();
  });
});
