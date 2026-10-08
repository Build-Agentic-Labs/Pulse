import { expect, it, vi } from "vitest";
import type { Department } from "@/domain/departments";
import { listDepartments, fetchDepartmentRolesForUser } from "@/lib/departments/store";
import { loadWiLibraryDepartments } from "./library-departments";

vi.mock("@/lib/departments/store", () => ({
  listDepartments: vi.fn(), fetchDepartmentRolesForUser: vi.fn(),
}));

it("uses explicit user memberships and excludes memberships in other workspaces", async () => {
  const departments = [{ id: "sales" }, { id: "manufacturing" }] as Department[];
  vi.mocked(listDepartments).mockResolvedValue(departments);
  vi.mocked(fetchDepartmentRolesForUser).mockResolvedValue(new Map([
    ["manufacturing", "author"], ["other-workspace", "reviewer"],
  ]));
  expect(await loadWiLibraryDepartments("workspace", "user")).toEqual({
    departments, memberDepartmentIds: ["manufacturing"],
  });
  expect(listDepartments).toHaveBeenCalledWith("workspace", undefined);
  expect(fetchDepartmentRolesForUser).toHaveBeenCalledWith("user", undefined);
});
