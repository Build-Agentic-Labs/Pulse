/**
 * Review-queue data assembly, shared by the client tab (background refresh) and
 * app/sops/page.tsx (server first paint — refactor plan, Stage 5). Extracted
 * verbatim from review-queue.tsx so the queue derivation exists exactly once.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";
import { selectFeedbackToAddress, selectReadyForFinalApproval } from "@/domain/sop/queue-ready";
import { feedbackReceivedAt, reviewReceivedAt } from "@/domain/sop/queue-received";
import { listSopHandoffEvents } from "@/lib/sop/audit-events";
import { fetchMyDeptRoles, listDepartments } from "@/lib/departments/store";
import {
  hasSubmittedSopReview,
  listOpenSopReviewAnnotationsFor,
  listSopReviewSubmissions,
} from "@/lib/sop/review-annotations";
import {
  isBlockingSeat,
  listMySeats,
  listMySignaturesFor,
  listSeatsForSops,
  listSopAuthorDisplayNames,
  type MySeatItem,
} from "@/lib/sop/review";
import { listSops, type SopListItem } from "@/lib/sop/store";

/** A seat awaiting this user's signature, with the department it speaks for. */
export interface PendingSeat extends MySeatItem {
  departmentCode: string;
  /**
   * The OWNING department's code, which is a different thing from departmentCode above: that one
   * is the seat speaking, this one is whose sequence the number comes from at release. Unreleased
   * SOPs show it in place of a number (listNumberLabel).
   */
  sopDepartmentCode: string | null;
}

export interface QualityQueueItem extends SopListItem {
  departmentCode: string;
  departmentName: string;
}

export interface QueueData {
  /** Seats I hold that are unsigned against the SOP's current content and cycle. */
  awaitingMe: PendingSeat[];
  /** Formal approvals requested after every draft reviewer accepted the content. */
  finalApprovals: PendingSeat[];
  /** SOPs I authored that a reviewer has sent back. */
  sentBack: SopListItem[];
  /** Department-approved SOPs waiting on the Quality gate. Only shown to Quality approvers. */
  awaitingQuality: QualityQueueItem[];
  /**
   * SOPs I authored whose every required approver has returned and nothing is open:
   * the "send for final approval" click is mine to make.
   */
  readyForFinalApproval: SopListItem[];
  /** SOPs I authored whose every required review is back with remarks still open: rework is mine. */
  feedbackToAddress: SopListItem[];
  /** The workspace-wide board this page used to be. Kept: nothing that was visible is removed. */
  allInFlight: SopListItem[];
  /** Author display names for the SOPs awaiting my review or approval, keyed by SOP id. */
  authorNames: Record<string, string>;
  /**
   * When each item landed on me, keyed by SOP id: a review I owe (sent for review, or my seat
   * reassigned to me), or my own SOP's feedback (its last review returned). Best-effort.
   */
  receivedAt: Record<string, string>;
  isQualityApprover: boolean;
}

export const EMPTY_QUEUE: QueueData = {
  awaitingMe: [],
  finalApprovals: [],
  sentBack: [],
  awaitingQuality: [],
  readyForFinalApproval: [],
  feedbackToAddress: [],
  allInFlight: [],
  authorNames: {},
  receivedAt: {},
  isQualityApprover: false,
};

export async function fetchReviewQueueData(
  workspaceId: string,
  userId: string,
  client?: SupabaseClient<Database>,
): Promise<QueueData> {
  const [seats, sops, departments, deptRoles] = await Promise.all([
    listMySeats(workspaceId, userId, client),
    listSops(workspaceId, client),
    listDepartments(workspaceId, client),
    fetchMyDeptRoles(workspaceId, client),
  ]);

  const codeById = new Map(departments.map((department) => [department.id, department.code]));
  const departmentById = new Map(departments.map((department) => [department.id, department]));
  const isQualityApprover = departments.some(
    (department) => department.isQualityGate && deptRoles.get(department.id) === "approver",
  );

  const inReviewSeats = seats.filter((seat) => seat.status === "in_review" && isBlockingSeat(seat.rasic));
  const finalApprovalSeats = inReviewSeats.filter(
    (seat) =>
      Boolean(seat.finalApprovalRequestedAt) &&
      seat.finalApprovalContentHash === seat.contentHash,
  );
  const finalApprovalSopIds = new Set(finalApprovalSeats.map((seat) => seat.sopId));
  const draftReviewSeats = inReviewSeats.filter((seat) => !finalApprovalSopIds.has(seat.sopId));
  // In review, or recalled to draft to work the remarks (a rejection is "sent back" instead).
  const authoredUnderReview = sops.filter(
    (sop) =>
      sop.createdBy === userId &&
      (sop.status === "in_review" || (sop.status === "draft" && !sop.rejectedReason)),
  );
  const authoredIds = authoredUnderReview.map((sop) => sop.id);
  const qualitySops = isQualityApprover ? sops.filter((sop) => sop.status === "approved") : [];
  const [mySubmissions, mySignatures, authoredSeats, openAnnotations, authorNames, handoffs] = await Promise.all([
    listSopReviewSubmissions([...draftReviewSeats.map((seat) => seat.sopId), ...authoredIds], client),
    listMySignaturesFor([...finalApprovalSeats.map((seat) => seat.sopId), ...qualitySops.map((sop) => sop.id)], userId, client),
    listSeatsForSops(authoredIds, client),
    listOpenSopReviewAnnotationsFor(authoredIds, client),
    listSopAuthorDisplayNames(inReviewSeats.map((seat) => seat.sopId), client),
    // A date column must never take the queue down with it.
    listSopHandoffEvents(draftReviewSeats.map((seat) => seat.sopId), client).catch(() => []),
  ]);
  const receivedAt = {
    ...feedbackReceivedAt(mySubmissions, authoredUnderReview),
    ...reviewReceivedAt(
      handoffs,
      draftReviewSeats.map((seat) => ({ id: seat.sopId, reviewCycle: seat.reviewCycle })),
      userId,
    ),
  };

  const authoredReturns = {
    userId,
    sops: authoredUnderReview,
    seats: authoredSeats,
    submissions: mySubmissions,
    openAnnotations,
  };

  const awaitingMe: PendingSeat[] = draftReviewSeats
    .filter(
      (seat) =>
        !hasSubmittedSopReview(mySubmissions, seat.sopId, seat.reviewCycle, userId),
    )
    .map((seat) => ({
      ...seat,
      departmentCode: codeById.get(seat.departmentId) ?? "—",
      sopDepartmentCode: seat.sopDepartmentId ? codeById.get(seat.sopDepartmentId) ?? null : null,
    }));

  const finalApprovals: PendingSeat[] = finalApprovalSeats
    .filter(
      (seat) =>
        !mySignatures.some(
          (signature) =>
            signature.sopId === seat.sopId &&
            signature.meaning === "dept_approval" &&
            signature.seatDepartmentId === seat.departmentId &&
            signature.reviewCycle === seat.reviewCycle &&
            signature.signedContentHash === (seat.contentHash ?? ""),
        ),
    )
    .map((seat) => ({
      ...seat,
      departmentCode: codeById.get(seat.departmentId) ?? "—",
      sopDepartmentCode: seat.sopDepartmentId ? codeById.get(seat.sopDepartmentId) ?? null : null,
    }));

  return {
    awaitingMe,
    finalApprovals,
    // Mine, sent back by a reviewer. rejectedReason is the DB's mirror of the objection
    // signature; a recall clears it, so a recalled SOP does not land here.
    sentBack: sops.filter(
      (sop) => sop.status === "draft" && sop.createdBy === userId && Boolean(sop.rejectedReason),
    ),
    awaitingQuality: isQualityApprover
      ? sops
          .filter((sop) =>
            sop.status === "approved" &&
            sop.createdBy !== userId &&
            sop.submittedBy !== userId &&
            !seats.some((seat) => seat.sopId === sop.id) &&
            !mySignatures.some((signature) =>
              signature.sopId === sop.id &&
              signature.meaning === "objection_overruled" &&
              signature.reviewCycle === sop.reviewCycle),
          )
          .map((sop) => {
            const department = sop.departmentId ? departmentById.get(sop.departmentId) : undefined;
            return {
              ...sop,
              departmentCode: department?.code ?? "—",
              departmentName: department?.name ?? "Unknown department",
            };
          })
      : [],
    readyForFinalApproval: selectReadyForFinalApproval(authoredReturns),
    feedbackToAddress: selectFeedbackToAddress(authoredReturns),
    allInFlight: sops.filter((sop) => sop.status === "in_review" || sop.status === "approved"),
    authorNames,
    receivedAt,
    isQualityApprover,
  };
}
