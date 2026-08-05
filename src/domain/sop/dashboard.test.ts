import { describe, expect, it } from "vitest";
import type { Department } from "@/domain/departments";
import {
  buildSopDashboardMetrics,
  completionPercent,
  departmentSopLifecycle,
  isValidDepartmentSopTarget,
} from "./dashboard";

const departments: Department[] = [
  {
    id: "mfg",
    workspaceId: "ws",
    code: "MFG",
    name: "Manufacturing",
    isQualityGate: false,
    sopTarget: 4,
  },
  {
    id: "qas",
    workspaceId: "ws",
    code: "QAS",
    name: "Quality",
    isQualityGate: true,
    sopTarget: 2,
  },
];

describe("buildSopDashboardMetrics", () => {
  it("maps lifecycle states into draft, approval, and effective counts", () => {
    const metrics = buildSopDashboardMetrics(departments, [
      { departmentId: "mfg", status: "draft" },
      { departmentId: "mfg", status: "in_review" },
      { departmentId: "mfg", status: "approved" },
      { departmentId: "mfg", status: "effective" },
      { departmentId: "mfg", status: "obsolete" },
      { departmentId: "qas", status: "effective" },
      { departmentId: null, status: "draft" },
      { departmentId: "missing", status: "effective" },
    ]);

    expect(metrics.departments[0]).toMatchObject({
      draft: 1,
      inApproval: 2,
      effective: 1,
      target: 4,
      remaining: 3,
      completionPercent: 25,
    });
    expect(metrics.departments[1]).toMatchObject({
      draft: 0,
      inApproval: 0,
      effective: 1,
      target: 2,
      remaining: 1,
      completionPercent: 50,
    });
    expect(metrics).toMatchObject({
      draft: 1,
      inApproval: 2,
      effective: 2,
      target: 6,
      remaining: 4,
      completionPercent: 33,
    });
  });

  it("leaves completion unconfigured when demand is zero", () => {
    const metrics = buildSopDashboardMetrics(
      [{ ...departments[0], sopTarget: 0 }],
      [{ departmentId: "mfg", status: "effective" }],
    );

    expect(metrics.departments[0]?.completionPercent).toBeNull();
    expect(metrics.completionPercent).toBeNull();
    expect(metrics.remaining).toBe(0);
  });
});

describe("department target validation", () => {
  it("accepts only whole numbers inside the database constraint", () => {
    expect(isValidDepartmentSopTarget(0)).toBe(true);
    expect(isValidDepartmentSopTarget(100_000)).toBe(true);
    expect(isValidDepartmentSopTarget(-1)).toBe(false);
    expect(isValidDepartmentSopTarget(1.5)).toBe(false);
    expect(isValidDepartmentSopTarget(100_001)).toBe(false);
  });

  it("allows percentages over 100 when output exceeds demand", () => {
    expect(completionPercent(5, 4)).toBe(125);
  });
});

describe("department SOP lifecycle", () => {
  it("partitions a target into mutually exclusive chart segments", () => {
    expect(departmentSopLifecycle({ target: 12, draft: 1, inApproval: 2, effective: 3 })).toEqual({
      notStarted: 6,
      overTarget: 0,
      chartTotal: 12,
    });
  });

  it("reports tracked SOPs above the configured target without a negative segment", () => {
    expect(departmentSopLifecycle({ target: 4, draft: 2, inApproval: 2, effective: 2 })).toEqual({
      notStarted: 0,
      overTarget: 2,
      chartTotal: 6,
    });
  });
});
