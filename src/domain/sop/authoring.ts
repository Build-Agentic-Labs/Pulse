/**
 * Pure decision logic for department-scoped SOP authoring in the builder. No Supabase — the store
 * layer supplies the data; these functions decide how the create form behaves and how the SOP
 * number is presented. Unit-tested in authoring.test.ts.
 */

import type { Department } from "@/domain/departments";

/** Document type minted for hand-authored SOPs (v1 exposes only SOP). */
export const DEFAULT_DOC_TYPE = "SOP";

/**
 * How the builder presents department selection, derived from the departments the current user may
 * author in:
 *  - `blocked`: member of none -> cannot create a SOP.
 *  - `single`: exactly one -> show it as a fixed label (nothing to pick).
 *  - `choose`: several -> inline dropdown, defaulting to the first.
 */
export type AuthoringMode =
  | { kind: "blocked" }
  | { kind: "single"; department: Department }
  | { kind: "choose"; departments: Department[] };

/** Decide how the builder should present department selection for these member departments. */
export function authoringMode(myDepartments: Department[]): AuthoringMode {
  const [first] = myDepartments;
  if (!first) return { kind: "blocked" };
  if (myDepartments.length === 1) return { kind: "single", department: first };
  return { kind: "choose", departments: myDepartments };
}

/** Human preview of the number to be minted, e.g. previewSopNumber("QA","SOP") -> "QA-SOP-###". */
export function previewSopNumber(departmentCode: string, docType: string): string {
  return `${departmentCode.toUpperCase()}-${docType.toUpperCase()}-###`;
}

/**
 * The authoritative SOP number: the promoted `sop_number` column when set, else the jsonb copy.
 * Keeps the list (reads the column) and the editor (read the jsonb) from disagreeing.
 */
export function effectiveSopNumber(columnNumber: string | null | undefined, documentNumber: string): string {
  const trimmed = (columnNumber ?? "").trim();
  return trimmed || documentNumber;
}
