import type { SopStatus } from "./schema";

/**
 * Who may delete an SOP — a mirror of the database rules, which are the real gate.
 *
 * The list UI used to hide the delete control behind `status === "draft"`, which is
 * stricter than the database and left managers unable to remove an SOP that was out
 * for review: the row simply had no delete affordance, with nothing to explain why.
 *
 * The rules being mirrored, from the live `enforce_sop_transition` (patched in place —
 * read it with `pg_get_functiondef`, never from a migration file):
 *
 *   if new.deleted_at is not null and old.deleted_at is null then
 *     if old.status = 'effective' then
 *       raise 'An effective SOP cannot be deleted; release a new version to supersede it';
 *     if not (old.status in ('draft', 'obsolete') or is_manager) then
 *       raise 'Retire this SOP before deleting it (only draft or obsolete SOPs can be deleted)';
 *
 * and from `enforce_sop_department_content_edit`, whose trigger list includes
 * `new.deleted_at is distinct from old.deleted_at` but which only fires when
 * `old.status = 'draft'` — so the department restriction applies to deleting a DRAFT
 * and to nothing else:
 *
 *   if current_user = 'authenticated' and old.status = 'draft'
 *      and old.department_id is not null
 *      and not is_department_member(old.department_id) and (…) then
 *     raise 'This draft belongs to another department and is view-only';
 *
 * Mirroring is for UX only. A UI that is stricter than the database hides legitimate
 * actions; one that is looser produces a confusing failure at the database instead of a
 * disabled button. Neither is the gate — the database is.
 */
export interface SopDeletionContext {
  status: SopStatus;
  /** May this user write SOPs at all (workspace owner/admin, or org-tool `edit`)? */
  canEditSops: boolean;
  /** Workspace owner or admin — the `is_manager` branch of the transition guard. */
  isManager: boolean;
  /** Does the SOP belong to a department? */
  hasDepartment: boolean;
  /** Is the user a member of that department? Irrelevant unless the SOP is a draft. */
  isDepartmentMember: boolean;
}

export function canDeleteSop({
  status,
  canEditSops,
  isManager,
  hasDepartment,
  isDepartmentMember,
}: SopDeletionContext): boolean {
  if (!canEditSops) return false;

  // Terminal by design: an effective SOP is superseded by a new version, never removed.
  if (status === "effective") return false;

  // POLICY, stricter than the database: an SOP belongs to its department, and that
  // department's authors own its lifecycle — at every status, not just draft. Being a
  // workspace owner is an administrative role; it does not confer ownership of another
  // department's controlled documents. The database currently drops its department
  // check once an SOP leaves draft and falls back to `is_manager`, which would let any
  // owner delete another department's in-review document. Until the guard is tightened
  // to match, this keeps the UI from offering that.
  //
  // An SOP with no owning department has no authors to speak for it, so removing that
  // orphan falls to a manager — otherwise nothing could ever clear it.
  if (!(hasDepartment ? isDepartmentMember : isManager)) return false;

  // DATABASE, which the UI must not be looser than: past draft/obsolete, the transition
  // guard still demands a manager. Showing a delete control to a department author on an
  // in-review SOP would produce a failure at the database instead of an absent button.
  if (!(status === "draft" || status === "obsolete" || isManager)) return false;

  return true;
}
