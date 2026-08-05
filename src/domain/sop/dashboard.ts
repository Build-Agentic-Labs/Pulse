import type { Department } from "@/domain/departments";
import type { SopStatus } from "./schema";

export const MAX_DEPARTMENT_SOP_TARGET = 100_000;

export interface DashboardSop {
  departmentId: string | null;
  status: SopStatus;
}

export interface DepartmentSopMetrics {
  departmentId: string;
  code: string;
  name: string;
  target: number;
  draft: number;
  inApproval: number;
  effective: number;
  remaining: number;
  completionPercent: number | null;
}

export interface SopDashboardMetrics {
  departments: DepartmentSopMetrics[];
  target: number;
  draft: number;
  inApproval: number;
  effective: number;
  remaining: number;
  completionPercent: number | null;
}

export interface DepartmentSopLifecycle {
  notStarted: number;
  overTarget: number;
  chartTotal: number;
}

export function isValidDepartmentSopTarget(value: number): boolean {
  return Number.isInteger(value) && value >= 0 && value <= MAX_DEPARTMENT_SOP_TARGET;
}

export function completionPercent(effective: number, target: number): number | null {
  if (target <= 0) return null;
  return Math.round((effective / target) * 100);
}

export function departmentSopLifecycle(
  metrics: Pick<DepartmentSopMetrics, "target" | "draft" | "inApproval" | "effective">,
): DepartmentSopLifecycle {
  const tracked = metrics.draft + metrics.inApproval + metrics.effective;
  return {
    notStarted: Math.max(metrics.target - tracked, 0),
    overTarget: Math.max(tracked - metrics.target, 0),
    chartTotal: Math.max(metrics.target, tracked),
  };
}

/**
 * Reduce the current SOP rows into the exact lifecycle groups used by the dashboard.
 * `in_review` and `approved` are both still in the approval pipeline; only `effective`
 * counts toward target completion. Obsolete and unassigned rows are intentionally excluded.
 */
export function buildSopDashboardMetrics(
  departments: readonly Department[],
  sops: readonly DashboardSop[],
): SopDashboardMetrics {
  const byDepartment = new Map<string, DepartmentSopMetrics>();

  for (const department of departments) {
    const target = isValidDepartmentSopTarget(department.sopTarget) ? department.sopTarget : 0;
    byDepartment.set(department.id, {
      departmentId: department.id,
      code: department.code,
      name: department.name,
      target,
      draft: 0,
      inApproval: 0,
      effective: 0,
      remaining: target,
      completionPercent: completionPercent(0, target),
    });
  }

  for (const sop of sops) {
    if (!sop.departmentId) continue;
    const metrics = byDepartment.get(sop.departmentId);
    if (!metrics) continue;

    if (sop.status === "draft") metrics.draft += 1;
    else if (sop.status === "in_review" || sop.status === "approved") metrics.inApproval += 1;
    else if (sop.status === "effective") metrics.effective += 1;
  }

  const rows = departments.map((department) => {
    const metrics = byDepartment.get(department.id)!;
    return {
      ...metrics,
      remaining: Math.max(metrics.target - metrics.effective, 0),
      completionPercent: completionPercent(metrics.effective, metrics.target),
    };
  });

  const totals = rows.reduce(
    (sum, row) => ({
      target: sum.target + row.target,
      draft: sum.draft + row.draft,
      inApproval: sum.inApproval + row.inApproval,
      effective: sum.effective + row.effective,
    }),
    { target: 0, draft: 0, inApproval: 0, effective: 0 },
  );

  return {
    departments: rows,
    ...totals,
    remaining: Math.max(totals.target - totals.effective, 0),
    completionPercent: completionPercent(totals.effective, totals.target),
  };
}
