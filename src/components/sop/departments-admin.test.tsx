import { render, screen } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import { DepartmentsAdmin } from "./departments-admin";
import { listDepartmentMemberIdentities, setMember, setMemberPosition, removeMember } from "@/lib/departments/store";
import type { Department, DepartmentMember } from "@/domain/departments";
vi.mock("./sop-workspace-provider", () => ({ useSopWorkspace: () => ({ workspaceId: "ws", role: "admin" }), canManage: () => true }));
vi.mock("@/components/confirm-provider", () => ({ useConfirm: () => vi.fn() }));
vi.mock("@/domain/supabase-planner", () => ({ loadMembersAccessForWorkspace: vi.fn(async () => []) }));
vi.mock("@/lib/departments/store", () => ({ listDepartments: vi.fn(), listMembersForDepartments: vi.fn(), listDepartmentMemberIdentities: vi.fn(), setMember: vi.fn(), setMemberPosition: vi.fn(), removeMember: vi.fn(), saveDepartment: vi.fn(), deleteDepartment: vi.fn(), setDepartmentSopTarget: vi.fn() }));
vi.mock("@/lib/sop/job-titles/store", () => ({ listJobTitles: vi.fn(async () => []) }));
vi.mock("./job-titles-admin", () => ({ JobTitlesAdmin: () => null }));
vi.mock("./rasic-roles-admin", () => ({ RasicRolesAdmin: () => null }));
const department = { id: "d", workspaceId: "ws", code: "ACT", name: "Accounting", isQualityGate: false, sopTarget: 0 } satisfies Department;
const members: DepartmentMember[] = ["pending-one", "pending-two", "joined"].map(userId => ({ userId, departmentId: "d", deptRole: "author", positionTitle: "Controller", pendingInviteAt: userId === "joined" ? null : "2026-10-23" }));
const show = () => render(<DepartmentsAdmin initialDepartments={[department]} initialMembers={members} initialDirectory={[]} initialWorkspaceId="ws" />);
beforeEach(() => { vi.clearAllMocks(); vi.mocked(listDepartmentMemberIdentities).mockResolvedValue([
 { user_id: "pending-one", full_name: "Not the email", email: "first@example.com" },
 { user_id: "pending-two", full_name: null, email: "second@example.com" },
 { user_id: "joined", full_name: "Joined Person", email: "joined@example.com" },
]); });
it("resolves every pending email even with a server-seeded directory, while preserving joined names", async () => {
 show();
 expect(await screen.findByText("first@example.com")).toBeTruthy();
 expect(await screen.findByText("second@example.com")).toBeTruthy();
 expect(await screen.findByText("Joined Person")).toBeTruthy();
 expect(screen.getAllByText("Invitation pending")).toHaveLength(2);
 for (const member of members) expect(screen.queryByText(member.userId)).toBeNull();
 expect(setMember).not.toHaveBeenCalled(); expect(setMemberPosition).not.toHaveBeenCalled(); expect(removeMember).not.toHaveBeenCalled();
});
it("never exposes raw IDs when identity lookup fails", async () => {
 vi.mocked(listDepartmentMemberIdentities).mockRejectedValue(new Error("Unavailable"));
 show();
 expect(await screen.findAllByText("Invited member")).toHaveLength(2);
 expect(screen.getAllByText("Invitation pending")).toHaveLength(2);
 expect(screen.queryByText("pending-one")).toBeNull();
});
