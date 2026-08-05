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
  it("allows a manager of the owning department to delete an SOP mid-workflow", () => {
    expect(canDeleteSop(ctx({ status: "in_review", isManager: true }))).toBe(true);
    expect(canDeleteSop(ctx({ status: "approved", isManager: true }))).toBe(true);
  });

  // The database still requires a manager past draft/obsolete. A department author who
  // is not a manager must not be shown a control the database would reject.
  it("refuses a non-manager on an SOP that is mid-workflow, even in their own department", () => {
    expect(canDeleteSop(ctx({ status: "in_review", isManager: false }))).toBe(false);
    expect(canDeleteSop(ctx({ status: "approved", isManager: false }))).toBe(false);
  });

  it("refuses another department's draft", () => {
    expect(canDeleteSop(ctx({ status: "draft", isDepartmentMember: false }))).toBe(false);
  });

  // THE POLICY THIS MODULE ENFORCES BEYOND THE DATABASE. A department's documents belong
  // to that department at every status. Being a workspace owner administers the
  // workspace; it does not confer ownership of Quality's controlled documents. The
  // database would permit these today — the UI must not offer them.
  it("refuses another department's SOP at every status, even for a manager", () => {
    for (const status of ["in_review", "approved", "obsolete"] as const) {
      expect(
        canDeleteSop(ctx({ status, isManager: true, isDepartmentMember: false })),
      ).toBe(false);
    }
  });

  it("allows a member of the owning department to delete an obsolete SOP without being a manager", () => {
    expect(canDeleteSop(ctx({ status: "obsolete", isManager: false }))).toBe(true);
  });

  // Nobody can be a member of no-department, so membership cannot be the test here.
  // Requiring a manager instead would revoke real behaviour: three of the four
  // department-less SOPs ever deleted in production were removed by a non-manager
  // editor clearing up converted drafts. Any editor may clear an orphan.
  it("lets any editor delete a department-less SOP", () => {
    expect(
      canDeleteSop(ctx({ status: "draft", hasDepartment: false, isDepartmentMember: false, isManager: false })),
    ).toBe(true);
    expect(
      canDeleteSop(ctx({ status: "draft", hasDepartment: false, isDepartmentMember: false, isManager: true })),
    ).toBe(true);
  });

  it("still refuses a department-less SOP to someone who cannot write SOPs", () => {
    expect(
      canDeleteSop(ctx({ status: "draft", hasDepartment: false, canEditSops: false, isManager: true })),
    ).toBe(false);
  });
});
