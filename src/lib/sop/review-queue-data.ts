/**
 * Review-queue data assembly, shared by the client tab (background refresh) and
 * app/sops/page.tsx (server first paint — refactor plan, Stage 5). Extracted
 * verbatim from review-queue.tsx so the queue derivation exists exactly once.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";
import { fetchMyDeptRoles, listDepartments } from "@/lib/departments/store";
import { hasSubmittedSopReview, listSopReviewSubmissions } from "@/lib/sop/review-annotations";
import { isBlockingSeat, listMySeats, listMySignaturesFor, type MySeatItem } from "@/lib/sop/review";
import { listSops, type SopListItem } from "@/lib/sop/store";

/** A seat awaiting this user's signature, with the department it speaks for. */
export interface PendingSeat extends MySeatItem {
  departmentCode: string;
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
  /** The workspace-wide board this page used to be. Kept: nothing that was visible is removed. */
  allInFlight: SopListItem[];
  isQualityApprover: boolean;
}

export const EMPTY_QUEUE: QueueData = {
  awaitingMe: [],
  finalApprovals: [],
  sentBack: [],
  awaitingQuality: [],
  allInFlight: [],
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
  const [mySubmissions, mySignatures] = await Promise.all([
    listSopReviewSubmissions(draftReviewSeats.map((seat) => seat.sopId), client),
    listMySignaturesFor(finalApprovalSeats.map((seat) => seat.sopId), userId, client),
  ]);

  const awaitingMe: PendingSeat[] = draftReviewSeats
    .filter(
      (seat) =>
        !hasSubmittedSopReview(mySubmissions, seat.sopId, seat.reviewCycle, userId),
    )
    .map((seat) => ({ ...seat, departmentCode: codeById.get(seat.departmentId) ?? "—" }));

  const finalApprovals: PendingSeat[] = finalApprovalSeats
    .filter(
      (seat) =>
        !mySignatures.some(
          (signature) =>
            signature.meaning === "dept_approval" &&
            signature.seatDepartmentId === seat.departmentId &&
            signature.reviewCycle === seat.reviewCycle &&
            signature.signedContentHash === (seat.contentHash ?? ""),
        ),
    )
    .map((seat) => ({ ...seat, departmentCode: codeById.get(seat.departmentId) ?? "—" }));

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
          .filter((sop) => sop.status === "approved")
          .map((sop) => {
            const department = sop.departmentId ? departmentById.get(sop.departmentId) : undefined;
            return {
              ...sop,
              departmentCode: department?.code ?? "—",
              departmentName: department?.name ?? "Unknown department",
            };
          })
      : [],
    allInFlight: sops.filter((sop) => sop.status === "in_review" || sop.status === "approved"),
    isQualityApprover,
  };
}
