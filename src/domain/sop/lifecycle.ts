/**
 * SOP lifecycle state machine — the UI-side mirror of the Postgres `enforce_sop_transition`
 * trigger. This predicate only drives enabling/disabling controls; the database is the real
 * gate. Keep the two in lockstep: any rule change here must change the trigger too.
 *
 * States (one machine, on `sops.status`):
 *   draft → in_review → approved → effective   (+ effective → draft to start a revision)
 *   in_review → draft (reject or recall)        effective|approved → obsolete (retire)
 * "Superseded" is not a status — the in-force copy is named by `sops.effective_revision_id`.
 *
 * Two edges are NOT user-driven and have no button:
 *   * in_review → approved happens inside `sign_sop` when the last blocking seat signs.
 *   * in_review → draft (reject) happens inside `sign_sop` when a rejection is recorded.
 * They are still modelled here so the panel can explain why an SOP moved on its own.
 */

import { canDeptApprove, type DeptRole } from "@/domain/departments";
import type { SopStatus } from "./schema";

export type { SopStatus };

export const SOP_STATUS_ORDER: SopStatus[] = ["draft", "in_review", "approved", "effective", "obsolete"];

export interface TransitionContext {
  from: SopStatus;
  to: SopStatus;
  /** The user's role in the SOP's OWNING department, if any. */
  role?: DeptRole;
  /** True when this user submitted the SOP to review. */
  isSubmitter: boolean;
  /** True when this user created the SOP. */
  isAuthor?: boolean;
  /** True when this user is an approver in the workspace's Quality-gate department. */
  isQualityApprover: boolean;
  /** True when the SOP has an owning department (required before it can leave draft). */
  hasDept: boolean;
  /** Workspace owner/admin — folds in for department-scoped verbs (never for signing). */
  isManager?: boolean;

  /** The roster carries at least one Responsible department. */
  hasResponsibleSeat?: boolean;
  /** Exactly one Accountable department is required; the DB has a partial unique index too. */
  accountableSeatCount?: number;
  /** This user holds a Responsible or Accountable seat on this SOP. */
  holdsBlockingSeat?: boolean;
  /** This user holds any seat at all (blocking, support, or consulted). */
  holdsAnySeat?: boolean;
  /** Every seat's designated signer belongs to that seat's department. */
  seatsStaffedCorrectly?: boolean;
  /** An authorship signature by this user exists, bound to the current content and cycle. */
  authorshipSigned?: boolean;
  /** Every blocking seat has signed for the current content and cycle. */
  quorumMet?: boolean;
  /** A rejection stands against the document as it is now. */
  hasOpenObjection?: boolean;
  /** Gate D needs a written reason before an effective SOP can be reopened. */
  hasRevisionReason?: boolean;
  /**
   * This user overruled an objection during the current cycle. A Quality approver who set an
   * objection aside may not also release the document — the trigger refuses, so the button must
   * not invite it. Where Quality has a single approver this makes the SOP un-releasable by them;
   * another Quality approver must do it.
   */
  overruledThisCycle?: boolean;
  /** A rejection signature by this user, bound to the current content and cycle, exists. */
  hasOwnRejection?: boolean;
}

export interface TransitionResult {
  ok: boolean;
  reason?: string;
}

const OK: TransitionResult = { ok: true };
const no = (reason: string): TransitionResult => ({ ok: false, reason });

export function canTransitionSop(ctx: TransitionContext): TransitionResult {
  const {
    from,
    to,
    role,
    isSubmitter,
    isAuthor = false,
    isQualityApprover,
    hasDept,
    isManager = false,
    hasResponsibleSeat = false,
    accountableSeatCount = 0,
    holdsBlockingSeat = false,
    holdsAnySeat = false,
    seatsStaffedCorrectly = true,
    authorshipSigned = false,
    quorumMet = false,
    hasOpenObjection = false,
    hasRevisionReason = false,
    overruledThisCycle = false,
    hasOwnRejection = false,
  } = ctx;

  if (from === to) return OK;

  const isOwningDeptMember = isManager || role !== undefined;
  const canDept = isManager || (role !== undefined && canDeptApprove(role));

  switch (`${from}->${to}`) {
    case "draft->in_review":
      if (!hasDept) return no("Assign an owning department before submitting for review.");
      if (!isOwningDeptMember) return no("Only a member of the owning department can submit this SOP.");
      if (!hasResponsibleSeat) return no("Name at least one Responsible department before submitting.");
      if (accountableSeatCount !== 1) return no("Name exactly one Accountable department before submitting.");
      if (!seatsStaffedCorrectly) return no("Every seat's reviewer must belong to that seat's department.");
      if (holdsBlockingSeat) return no("You hold a blocking seat on this SOP; someone else must submit it.");
      if (!authorshipSigned) return no("Sign the authorship declaration before submitting this SOP.");
      if (hasOpenObjection) return no("Resolve the open objection before resubmitting this SOP.");
      return OK;

    case "in_review->approved":
      // Not a button. `sign_sop` performs this edge when the last blocking seat signs.
      if (isSubmitter) return no("You can't approve an SOP you submitted for review.");
      if (!quorumMet) return no("Every Responsible and Accountable department must sign before Quality review.");
      if (hasOpenObjection) return no("Resolve the open objection before this SOP can be approved.");
      return OK;

    case "in_review->draft":
      // Recall is a plain, reason-less transition by the submitter. Reject is NOT this edge from
      // the client's side: sign_sop records the objection and performs the transition itself, so
      // the trigger only accepts a bare UPDATE here when a rejection signature already exists.
      if (isSubmitter) return OK;
      if (holdsBlockingSeat && hasOwnRejection) return OK;
      return no("Only a Responsible or Accountable reviewer can reject this SOP, or its submitter can recall it.");

    case "approved->effective":
      if (!isQualityApprover) return no("Only a Quality approver can make an SOP effective.");
      if (holdsAnySeat) return no("The Quality approver must not hold a review seat on this SOP.");
      if (isAuthor || isSubmitter) return no("The Quality approver must differ from the author.");
      if (overruledThisCycle)
        return no("You overruled an objection on this SOP; another Quality approver must release it.");
      return OK;

    case "effective->draft": // start a revision
      if (!isOwningDeptMember) return no("Only a member of the owning department can start a revision.");
      if (!hasRevisionReason) return no("A revision needs a reason: what is changing, and why.");
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
