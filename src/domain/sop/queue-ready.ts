/**
 * "Ready for final approval": the author-side stall the review queue and bell
 * used to be blind to. An authored SOP belongs here once every required
 * approver has returned their draft review this cycle and no remark is still
 * open — the exact gate behind the editor's "Send for final approval" button —
 * and leaves the moment the request is made. Pure; the QueueData shapes are
 * type-only imports so this module carries no runtime lib dependency.
 */

import type { SopListItem } from "@/lib/sop/store";

export interface ReadyForFinalApprovalInput {
  userId: string;
  sops: readonly SopListItem[];
  seats: readonly { sopId: string; rasic: string; signerId: string | null }[];
  submissions: readonly { sopId: string; reviewCycle: number; reviewerId: string }[];
  /** Unresolved remarks only. */
  openAnnotations: readonly { sopId: string; reviewCycle: number }[];
}

function isBlocking(rasic: string): boolean {
  return rasic === "responsible" || rasic === "accountable";
}

function finalApprovalUnderway(sop: SopListItem): boolean {
  return Boolean(sop.finalApprovalRequestedAt) && sop.finalApprovalContentHash === sop.contentHash;
}

/**
 * Mine, in draft review or pulled back to draft to work the remarks (a recall, not a rejection —
 * that one is "sent back"), with every required approver's review returned this cycle and final
 * approval not yet asked.
 */
function everyReviewReturned(sop: SopListItem, input: ReadyForFinalApprovalInput): boolean {
  if (sop.createdBy !== input.userId) return false;
  const reviewing = sop.status === "in_review" || (sop.status === "draft" && !sop.rejectedReason);
  if (!reviewing || finalApprovalUnderway(sop)) return false;

  const requiredSeats = input.seats.filter((seat) => seat.sopId === sop.id && isBlocking(seat.rasic));
  if (requiredSeats.some((seat) => !seat.signerId)) return false;
  const signers = Array.from(new Set(requiredSeats.map((seat) => seat.signerId as string)));
  if (signers.length === 0) return false;

  const returned = new Set(
    input.submissions
      .filter((submission) => submission.sopId === sop.id && submission.reviewCycle === sop.reviewCycle)
      .map((submission) => submission.reviewerId),
  );
  return signers.every((signer) => returned.has(signer));
}

function hasOpenRemarks(sop: SopListItem, input: ReadyForFinalApprovalInput): boolean {
  return input.openAnnotations.some(
    (annotation) => annotation.sopId === sop.id && annotation.reviewCycle === sop.reviewCycle,
  );
}

export function selectReadyForFinalApproval(input: ReadyForFinalApprovalInput): SopListItem[] {
  // Only a live review can ask for signatures; a recalled draft must be resubmitted first.
  return input.sops.filter(
    (sop) => sop.status === "in_review" && everyReviewReturned(sop, input) && !hasOpenRemarks(sop, input),
  );
}

/**
 * The other half of "every review is back": remarks remain open, so the author
 * owes rework before final approval can be asked. Disjoint from
 * selectReadyForFinalApproval by construction.
 */
export function selectFeedbackToAddress(input: ReadyForFinalApprovalInput): SopListItem[] {
  return input.sops.filter((sop) => everyReviewReturned(sop, input) && hasOpenRemarks(sop, input));
}
