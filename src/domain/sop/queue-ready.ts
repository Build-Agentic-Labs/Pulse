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

export function selectReadyForFinalApproval(input: ReadyForFinalApprovalInput): SopListItem[] {
  return input.sops.filter((sop) => {
    if (sop.createdBy !== input.userId || sop.status !== "in_review") return false;
    if (finalApprovalUnderway(sop)) return false;

    const signers = Array.from(
      new Set(
        input.seats
          .filter((seat) => seat.sopId === sop.id && isBlocking(seat.rasic) && seat.signerId)
          .map((seat) => seat.signerId as string),
      ),
    );
    if (signers.length === 0) return false;

    const returned = new Set(
      input.submissions
        .filter((submission) => submission.sopId === sop.id && submission.reviewCycle === sop.reviewCycle)
        .map((submission) => submission.reviewerId),
    );
    if (!signers.every((signer) => returned.has(signer))) return false;

    return !input.openAnnotations.some(
      (annotation) => annotation.sopId === sop.id && annotation.reviewCycle === sop.reviewCycle,
    );
  });
}
