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

  // Draft and obsolete are freely removable; anything mid-workflow needs a manager.
  if (!(status === "draft" || status === "obsolete" || isManager)) return false;

  // The department guard fires on drafts only, so a manager clearing an in_review SOP
  // is not subject to it — but nobody may delete another department's draft.
  if (status === "draft" && hasDepartment && !isDepartmentMember) return false;

  return true;
}
