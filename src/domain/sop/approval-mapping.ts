/**
 * Turning a legacy document's approval table into the SOP's approval roster.
 *
 * A converted SOP arrives with rows like `{ role: "Reviewed By", name: "J. Smith",
 * position: "Production Manager" }` plus, when the converter could tell, a `departmentCode` hint.
 * Something has to decide which of the workspace's real departments each row means. That decision
 * lives here, pure, so it can be tested without a conversion or a database.
 *
 * The converter's hint is a SUGGESTION. It is resolved against the departments that actually
 * exist and discarded when it matches none — the model proposes, the app decides.
 */

import { standardPositionTitlesForDepartment, type Department } from "@/domain/departments";
import type { SopApproval } from "./schema";

export type ApprovalMappingOutcome =
  /** Matched a real department; a seat should be created for it. */
  | "mapped"
  /**
   * Matched the workspace's quality-gate department. Deliberately NOT a seat: Quality signs the
   * release gate, and `enforce_sop_transition` refuses to release an SOP whose Quality approver
   * holds a review seat. A seat here would convert cleanly and never be releasable.
   */
  | "quality-gate"
  /** Nothing matched; the author has to place this one by hand. */
  | "unmapped";

export interface ApprovalMapping {
  approval: SopApproval;
  outcome: ApprovalMappingOutcome;
  /** Set for `mapped` and `quality-gate`. */
  department?: Department;
}

function normalize(value: string | undefined | null): string {
  return (value ?? "").trim().toLowerCase();
}

/** Code or name, either way, case-insensitively. */
function findByCodeOrName(hint: string, departments: readonly Department[]): Department | undefined {
  const needle = normalize(hint);
  if (!needle) return undefined;
  return departments.find(
    (department) => normalize(department.code) === needle || normalize(department.name) === needle,
  );
}

/** The department whose standard titles include this position, e.g. "Production Manager" → MFG. */
function findByPositionTitle(position: string, departments: readonly Department[]): Department | undefined {
  const needle = normalize(position);
  if (!needle) return undefined;
  return departments.find((department) =>
    standardPositionTitlesForDepartment(department.code).some((title) => normalize(title) === needle),
  );
}

/**
 * Resolve each legacy approval row to a department, in input order and one result per row.
 *
 * Callers that create seats must take the DISTINCT departments of the `mapped` results: two rows
 * naming the same department are one seat, not two.
 */
export function mapApprovalsToDepartments(
  approvals: readonly SopApproval[],
  departments: readonly Department[],
): ApprovalMapping[] {
  return approvals.map((approval) => {
    const department =
      findByCodeOrName(approval.departmentCode ?? "", departments) ??
      findByPositionTitle(approval.position, departments);

    if (!department) return { approval, outcome: "unmapped" as const };
    // The flag, not the word "Quality": a workspace may rename the department, but isQualityGate
    // is what the database enforces against.
    if (department.isQualityGate) return { approval, outcome: "quality-gate" as const, department };
    return { approval, outcome: "mapped" as const, department };
  });
}

/** The departments that should get a seat: `mapped` only, de-duplicated, in first-seen order. */
export function seatDepartmentsFrom(mappings: readonly ApprovalMapping[]): Department[] {
  const seen = new Set<string>();
  const result: Department[] = [];
  for (const mapping of mappings) {
    if (mapping.outcome !== "mapped" || !mapping.department) continue;
    if (seen.has(mapping.department.id)) continue;
    seen.add(mapping.department.id);
    result.push(mapping.department);
  }
  return result;
}

/**
 * The signer a seat should keep when it moves to another department.
 *
 * Gate A requires every seat's reviewer to belong to that seat's department, so a signer who is
 * not a member of the destination cannot come along: keeping them leaves a roster that looks
 * complete and then fails at submission with "Every seat's reviewer must belong to that seat's
 * department". Returning null asks the obvious question now instead of raising a confusing one
 * later.
 */
export function signerAfterDepartmentChange(
  signerId: string | null | undefined,
  nextDepartmentMemberIds: readonly string[],
): string | null {
  if (!signerId) return null;
  return nextDepartmentMemberIds.includes(signerId) ? signerId : null;
}
