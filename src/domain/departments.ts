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
