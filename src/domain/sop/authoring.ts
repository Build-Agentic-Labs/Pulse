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

/**
 * A number is earned at release, so every surface has to render the not-yet-numbered state.
 * These two functions are the only place that decides how — one for the document itself, one
 * for the lists that index it.
 *
 * `<UNKNOWN>` counts as unnumbered: the legacy-document converter emits it when it cannot read a
 * number off the source file, and a converted document earns its own number at release like any
 * other.
 */
function hasEarnedNumber(sopNumber: string | null | undefined): boolean {
  const trimmed = (sopNumber ?? "").trim();
  return trimmed !== "" && !/^<unknown>$/i.test(trimmed);
}

/**
 * The number as the *document* shows it — masthead, print preview, DOCX export. An unreleased
 * document reads `SOP-PRO-###`, which is the shape of the number it will be given rather than a
 * number anyone can cite. The department segment drops out before a department is chosen.
 */
export function documentNumberLabel(
  sopNumber: string | null | undefined,
  departmentCode: string | null | undefined,
  docType: string,
): string {
  const trimmed = (sopNumber ?? "").trim();
  if (hasEarnedNumber(trimmed)) return trimmed;
  const code = (departmentCode ?? "").trim().toUpperCase();
  return [docType.toUpperCase(), code, "###"].filter(Boolean).join("-");
}

/**
 * The number as a *list* shows it — SOP list, review queue, notification bell, retired archive.
 * Unreleased documents stand in their department code, so a row reads
 * `PRO · Value Stream Mapping Standard Practices` instead of repeating `SOP-PRO-###` down the
 * column, where identical placeholders would read as duplicate rows rather than as unnumbered
 * ones. Titles already lead every one of these surfaces.
 */
export function listNumberLabel(
  sopNumber: string | null | undefined,
  departmentCode: string | null | undefined,
): string {
  const trimmed = (sopNumber ?? "").trim();
  if (hasEarnedNumber(trimmed)) return trimmed;
  return (departmentCode ?? "").trim().toUpperCase() || "—";
}

/**
 * The authoritative SOP number: the promoted `sop_number` column when set, else the jsonb copy.
 * Keeps the list (reads the column) and the editor (read the jsonb) from disagreeing.
 */
export function effectiveSopNumber(columnNumber: string | null | undefined, documentNumber: string): string {
  const trimmed = (columnNumber ?? "").trim();
  return trimmed || documentNumber;
}
