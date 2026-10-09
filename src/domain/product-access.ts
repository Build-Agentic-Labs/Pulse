import type { AccessLevel, WorkspaceProjectGroup, WorkspaceRole } from "./types";

/** Product permission is independent of the generic Member/editor organization role. */
export function effectiveProductAccess(group?: Pick<WorkspaceProjectGroup, "role" | "isSuperAdmin" | "productAccess">): AccessLevel {
  if (!group) return "none";
  if (group.isSuperAdmin || group.role === "owner" || group.role === "admin") return "edit";
  return group.productAccess ?? "none";
}

export function productAuthorRole(group?: Pick<WorkspaceProjectGroup, "role" | "isSuperAdmin" | "productAccess">): WorkspaceRole | undefined {
  const access = effectiveProductAccess(group);
  if (access === "none") return undefined;
  if (group?.isSuperAdmin) return "owner";
  if (group?.role === "owner" || group?.role === "admin") return group.role;
  return access === "edit" ? "editor" : "viewer";
}
