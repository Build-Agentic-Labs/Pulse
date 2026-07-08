/**
 * SOP lifecycle state machine — the UI-side mirror of the Postgres `enforce_sop_transition`
 * trigger. This predicate only drives enabling/disabling controls; the database is the real
 * gate. Keep the two in lockstep: any rule change here must change the trigger too.
 *
 * States (one machine, on `sops.status`):
 *   draft → in_review → approved → effective   (+ effective → draft to start a revision)
 *   in_review → draft (reject)                  effective|approved → obsolete (retire)
 * "Superseded" is not a status — the in-force copy is named by `sops.effective_revision_id`.
 */

import { canAuthor, canDeptApprove, canSignReview, type DeptRole } from "@/domain/departments";

export type SopStatus = "draft" | "in_review" | "approved" | "effective" | "obsolete";

export const SOP_STATUS_ORDER: SopStatus[] = ["draft", "in_review", "approved", "effective", "obsolete"];

export interface TransitionContext {
  from: SopStatus;
  to: SopStatus;
  /** The user's role in the SOP's owning department, if any. */
  role?: DeptRole;
  /** True when this user submitted the SOP to review (the segregation-of-duties anchor). */
  isSubmitter: boolean;
  /** True when this user is an approver in the workspace's Quality-gate department. */
  isQualityApprover: boolean;
  /** True when the SOP has an owning department (required before it can leave draft). */
  hasDept: boolean;
  /** Workspace owner/admin — folds in for department-scoped verbs (not the Quality step). */
  isManager?: boolean;
}

export interface TransitionResult {
  ok: boolean;
  reason?: string;
}

const OK: TransitionResult = { ok: true };
const no = (reason: string): TransitionResult => ({ ok: false, reason });

export function canTransitionSop(ctx: TransitionContext): TransitionResult {
  const { from, to, role, isSubmitter, isQualityApprover, hasDept, isManager = false } = ctx;

  if (from === to) return OK;

  // Any department member can author/submit; signing needs the cumulative role.
  const canAuth = isManager || (role !== undefined && canAuthor(role));
  const canReview = isManager || (role !== undefined && canSignReview(role));
  const canDept = isManager || (role !== undefined && canDeptApprove(role));

  switch (`${from}->${to}`) {
    case "draft->in_review":
      if (!hasDept) return no("Assign a department before submitting for review.");
      if (!canAuth) return no("Only a member of the owning department can submit this SOP.");
      return OK;

    case "in_review->approved":
      if (!canDept) return no("Only a department approver can approve this SOP.");
      if (isSubmitter) return no("You can't approve an SOP you submitted for review.");
      return OK;

    case "in_review->draft": // reject / rework
      if (!canReview) return no("Only a reviewer or approver can send this back.");
      return OK;

    case "approved->effective":
      if (!isQualityApprover) return no("Only a Quality approver can make an SOP effective.");
      return OK;

    case "effective->draft": // start a revision
      if (!canAuth) return no("Only a member of the owning department can start a revision.");
      return OK;

    case "effective->obsolete":
    case "approved->obsolete":
    case "draft->obsolete":
      if (!canDept) return no("Only a department approver can retire an SOP.");
      return OK;

    default:
      return no(`Can't move an SOP from ${from} to ${to}.`);
  }
}
