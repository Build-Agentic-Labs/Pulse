import { describe, expect, it } from "vitest";
import { canDeleteSop, type SopDeletionContext } from "./deletion";

/** A workspace owner who belongs to the SOP's department — the most permissive caller. */
function ctx(over: Partial<SopDeletionContext> = {}): SopDeletionContext {
  return {
    status: "draft",
    canEditSops: true,
    isManager: true,
    hasDepartment: true,
    isDepartmentMember: true,
    ...over,
  };
}

describe("canDeleteSop", () => {
  it("refuses anyone who cannot write SOPs at all", () => {
    expect(canDeleteSop(ctx({ canEditSops: false }))).toBe(false);
    // Even a manager: the org-level write gate comes first.
    expect(canDeleteSop(ctx({ canEditSops: false, isManager: true }))).toBe(false);
  });

  // An effective SOP is superseded by releasing a new version, never deleted. The
  // database says so outright, so no role gets past this.
  it("never allows deleting an effective SOP", () => {
    expect(canDeleteSop(ctx({ status: "effective" }))).toBe(false);
    expect(canDeleteSop(ctx({ status: "effective", isManager: true }))).toBe(false);
  });

  it("allows draft and obsolete without needing a manager", () => {
    expect(canDeleteSop(ctx({ status: "draft", isManager: false }))).toBe(true);
    expect(canDeleteSop(ctx({ status: "obsolete", isManager: false }))).toBe(true);
  });

  // The bug this module exists to fix: the list hid the control on any non-draft, so a
  // manager could not remove an SOP sitting in review even though the database allows it.
  it("allows a manager to delete an SOP that is mid-workflow", () => {
    expect(canDeleteSop(ctx({ status: "in_review", isManager: true }))).toBe(true);
    expect(canDeleteSop(ctx({ status: "approved", isManager: true }))).toBe(true);
  });

  it("refuses a non-manager on an SOP that is mid-workflow", () => {
    expect(canDeleteSop(ctx({ status: "in_review", isManager: false }))).toBe(false);
    expect(canDeleteSop(ctx({ status: "approved", isManager: false }))).toBe(false);
  });

  // enforce_sop_department_content_edit fires only when old.status = 'draft'.
  it("refuses another department's draft", () => {
    expect(canDeleteSop(ctx({ status: "draft", isDepartmentMember: false }))).toBe(false);
  });

  it("ignores department membership once the SOP has left draft", () => {
    expect(
      canDeleteSop(ctx({ status: "in_review", isManager: true, isDepartmentMember: false })),
    ).toBe(true);
    expect(
      canDeleteSop(ctx({ status: "obsolete", isManager: false, isDepartmentMember: false })),
    ).toBe(true);
  });

  it("allows a departmentless draft regardless of membership", () => {
    expect(
      canDeleteSop(ctx({ status: "draft", hasDepartment: false, isDepartmentMember: false })),
    ).toBe(true);
  });
});
