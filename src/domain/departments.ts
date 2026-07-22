/**
 * Department domain types and role capabilities. Roles are cumulative:
 * `approver` ⊇ `reviewer` ⊇ `author`. Authoring/submitting a draft is open to any
 * department role; signing a review needs ≥ reviewer; the department-approval step
 * needs approver. The independent Quality sign-off is enforced in the database
 * (has_department_role's is_quality_gate branch), not here.
 */

export type DeptRole = "author" | "reviewer" | "approver";

export interface Department {
  id: string;
  workspaceId: string;
  code: string;
  name: string;
  isQualityGate: boolean;
}

export interface DepartmentMember {
  departmentId: string;
  userId: string;
  deptRole: DeptRole;
  /** Organizational job title, separate from the member's SOP access level. */
  positionTitle: string;
}

const STANDARD_POSITION_TITLES: Record<string, readonly string[]> = {
  INS: ["VP Sales", "Director Sales", "Inside Sales Manager", "Sales Manager", "Senior Sales Representative", "Inside Sales Representative", "Sales Coordinator"],
  INV: ["Inventory Control Manager", "Inventory Control Supervisor", "Inventory Analyst", "Inventory Control Specialist"],
  LOG: ["Logistics Manager", "Logistics Supervisor", "Logistics Coordinator", "Logistics Specialist"],
  MFG: ["VP Manufacturing", "Director Manufacturing", "Manufacturing Manager", "Production Manager", "Production Supervisor", "Manufacturing Engineer", "Production Specialist"],
  PLN: ["Director Planning", "Planning Manager", "Planning Supervisor", "Senior Planner", "Planner"],
  PRO: ["VP Engineering", "Director Engineering", "Director Industrial Engineering", "Process Engineering Manager", "Industrial Engineering Manager", "Process Engineer", "Industrial Engineer", "Engineering Technician"],
  PUR: ["VP Purchasing", "Director Purchasing", "Purchasing Manager", "SCM Manager", "Senior Buyer", "Buyer", "Purchasing Specialist"],
  QAS: ["VP Quality", "Director Quality", "Quality Manager", "QA Manager", "Quality Engineer", "Quality Specialist", "Quality Technician"],
  SVC: ["VP Service", "Director Service", "Service Manager", "Field Service Manager", "Service Supervisor", "Service Technician", "Customer Service Representative"],
};

const DEFAULT_POSITION_TITLES = [
  "Executive Vice President",
  "Vice President",
  "Director",
  "Senior Manager",
  "Manager",
  "Supervisor",
  "Team Lead",
  "Senior Specialist",
  "Specialist",
  "Coordinator",
  "Technician",
] as const;

/** Controlled organizational titles offered for a department's people roster. */
export function standardPositionTitlesForDepartment(code: string): readonly string[] {
  return STANDARD_POSITION_TITLES[code.trim().toUpperCase()] ?? DEFAULT_POSITION_TITLES;
}

const ORDER: Record<DeptRole, number> = { author: 0, reviewer: 1, approver: 2 };

/** True when `role` sits at or above `min` in the cumulative order. */
export function roleAtLeast(role: DeptRole, min: DeptRole): boolean {
  return ORDER[role] >= ORDER[min];
}

export function canAuthor(role: DeptRole): boolean {
  return roleAtLeast(role, "author");
}

export function canSignReview(role: DeptRole): boolean {
  return roleAtLeast(role, "reviewer");
}

export function canDeptApprove(role: DeptRole): boolean {
  return roleAtLeast(role, "approver");
}

/** Departments in `all` that the user is a member of, preserving `all`'s order. */
export function pickMemberDepartments(all: Department[], memberIds: ReadonlySet<string>): Department[] {
  return all.filter((department) => memberIds.has(department.id));
}
