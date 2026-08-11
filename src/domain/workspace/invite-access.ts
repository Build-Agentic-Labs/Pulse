import type { AccessLevel, WorkspaceAccessGrant, WorkspaceRole } from "@/domain/types";
import { standardPositionTitlesForDepartment, type Department, type DeptRole } from "@/domain/departments";

export type OrganizationInviteRole = "member" | "admin";
export type InviteAccessPackage =
  | "custom"
  | "industrial_engineer"
  | "quality_reviewer"
  | "planner"
  | "production_operator";

export interface InviteProjectAccess {
  projectId: string;
  level: Exclude<AccessLevel, "none">;
}

export interface InviteDepartmentAccess {
  departmentId: string;
  role: DeptRole;
  positionTitle: string;
}

export interface WorkspaceInviteEntitlements {
  organizationRole: OrganizationInviteRole;
  accessPackage: InviteAccessPackage;
  qualityAccess: AccessLevel;
  planningAccess: boolean;
  projectAccess: InviteProjectAccess[];
  departmentAccess: InviteDepartmentAccess[];
}

export const ORGANIZATION_ROLE_OPTIONS = [
  {
    value: "member",
    label: "Member",
    description: "Uses only the modules, projects, and workflow duties assigned below.",
  },
  {
    value: "admin",
    label: "Admin",
    description: "Manages members and automatically has full organization access.",
  },
] as const;

export const INVITE_PACKAGE_OPTIONS = [
  {
    value: "custom",
    label: "Custom access",
    description: "Start with no resource access and choose each grant.",
  },
  {
    value: "industrial_engineer",
    label: "Industrial Engineer",
    description: "Quality editing, Planning, and Create duty in Process Engineering.",
  },
  {
    value: "quality_reviewer",
    label: "Quality Reviewer",
    description: "Quality editing and Review duty in the Quality department.",
  },
  {
    value: "planner",
    label: "Planner",
    description: "Planning access and Create duty in the Planning department.",
  },
  {
    value: "production_operator",
    label: "Production Operator",
    description: "Read-only Quality access with no editing or administrative rights.",
  },
] as const;

export function workspaceRoleForOrganizationRole(role: OrganizationInviteRole): WorkspaceRole {
  return role === "admin" ? "admin" : "editor";
}

export function organizationRoleForWorkspaceRole(role: WorkspaceRole): "member" | "admin" | "owner" {
  if (role === "owner") return "owner";
  if (role === "admin") return "admin";
  return "member";
}

export function organizationRoleLabel(role: WorkspaceRole): string {
  const organizationRole = organizationRoleForWorkspaceRole(role);
  return organizationRole.charAt(0).toUpperCase() + organizationRole.slice(1);
}

export function normalizedInviteEntitlements(
  entitlements: WorkspaceInviteEntitlements,
): WorkspaceInviteEntitlements {
  if (entitlements.organizationRole !== "admin") return entitlements;
  return {
    ...entitlements,
    qualityAccess: "edit",
    planningAccess: true,
    // Admin access is derived from the organization role. Persisting hidden
    // project rows would unexpectedly survive a later demotion to Member.
    projectAccess: [],
  };
}

function departmentGrant(
  departments: readonly Department[],
  code: string,
  role: DeptRole,
  preferredTitle?: string,
): InviteDepartmentAccess[] {
  const department = departments.find((candidate) => candidate.code.toUpperCase() === code);
  if (!department) return [];
  const standardTitles = standardPositionTitlesForDepartment(department.code);
  const positionTitle =
    (preferredTitle && standardTitles.find((title) => title === preferredTitle)) ?? standardTitles[0] ?? "Team Member";
  return [{ departmentId: department.id, role, positionTitle }];
}

export function entitlementsForPackage(
  accessPackage: InviteAccessPackage,
  departments: readonly Department[],
): WorkspaceInviteEntitlements {
  const base: WorkspaceInviteEntitlements = {
    organizationRole: "member",
    accessPackage,
    qualityAccess: "none",
    planningAccess: false,
    projectAccess: [],
    departmentAccess: [],
  };

  if (accessPackage === "industrial_engineer") {
    return {
      ...base,
      qualityAccess: "edit",
      planningAccess: true,
      departmentAccess: departmentGrant(departments, "PRO", "author", "Industrial Engineer"),
    };
  }
  if (accessPackage === "quality_reviewer") {
    return {
      ...base,
      qualityAccess: "edit",
      departmentAccess: departmentGrant(departments, "QAS", "reviewer", "Quality Engineer"),
    };
  }
  if (accessPackage === "planner") {
    return {
      ...base,
      planningAccess: true,
      departmentAccess: departmentGrant(departments, "PLN", "author", "Planner"),
    };
  }
  if (accessPackage === "production_operator") {
    return { ...base, qualityAccess: "view" };
  }
  return base;
}

export function describeInviteEntitlements(
  entitlements: WorkspaceInviteEntitlements,
  projectNames: ReadonlyMap<string, string> = new Map(),
  departmentNames: ReadonlyMap<string, string> = new Map(),
): string[] {
  const summary =
    entitlements.organizationRole === "admin"
      ? ["Organization: Admin", "Modules and projects: Full access"]
      : [
          "Organization: Member",
          `Quality Module: ${entitlements.qualityAccess === "edit" ? "Edit" : entitlements.qualityAccess === "view" ? "View" : "No access"}`,
          `Planning: ${entitlements.planningAccess ? "Access" : "No access"}`,
        ];

  if (entitlements.organizationRole !== "admin") {
    for (const grant of entitlements.projectAccess) {
      summary.push(`${projectNames.get(grant.projectId) ?? "Project"}: ${grant.level === "edit" ? "Edit" : "View"}`);
    }
  }
  for (const grant of entitlements.departmentAccess) {
    const role = grant.role === "approver" ? "Approve" : grant.role === "reviewer" ? "Review" : "Create";
    summary.push(`${departmentNames.get(grant.departmentId) ?? "Department"}: ${role} · ${grant.positionTitle}`);
  }
  return summary;
}

export function compactInviteEntitlementSummary(entitlements: WorkspaceInviteEntitlements): string {
  if (entitlements.organizationRole === "admin") return "Admin · full access";
  const details: string[] = ["Member"];
  if (entitlements.qualityAccess !== "none") {
    details.push(`Quality ${entitlements.qualityAccess === "edit" ? "Edit" : "View"}`);
  }
  if (entitlements.planningAccess) details.push("Planning");
  if (entitlements.projectAccess.length) {
    details.push(`${entitlements.projectAccess.length} project${entitlements.projectAccess.length === 1 ? "" : "s"}`);
  }
  if (entitlements.departmentAccess.length) {
    details.push(`${entitlements.departmentAccess.length} workflow dut${entitlements.departmentAccess.length === 1 ? "y" : "ies"}`);
  }
  return details.join(" · ");
}

export function entitlementsFromWorkspaceAccessGrant(
  grant: WorkspaceAccessGrant,
): WorkspaceInviteEntitlements {
  const accessPackage = INVITE_PACKAGE_OPTIONS.some((option) => option.value === grant.accessPackage)
    ? (grant.accessPackage as InviteAccessPackage)
    : "custom";
  return {
    organizationRole: grant.role === "admin" ? "admin" : "member",
    accessPackage,
    qualityAccess: grant.qualityAccess,
    planningAccess: grant.planningAccess,
    projectAccess: grant.projectAccess,
    departmentAccess: grant.departmentAccess,
  };
}
