import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";
import { listProfileNames, listSeatsForSops } from "@/lib/sop/review";
import {
  listSopReviewSubmissions,
  type SopReviewSubmission,
} from "@/lib/sop/review-annotations";
import type { SopListItem } from "@/lib/sop/store";
import { reviewerStatus, type ReviewerStatus } from "@/domain/sop/reviewer-status";
import { listReviewProgress } from "./list-review-progress";

export interface SopListReviewParticipant {
  userId: string;
  name: string;
  status: ReviewerStatus;
}

export interface SopListReviewData {
  currentUserId: string | null;
  submissions: SopReviewSubmission[];
  participantGroups: Array<{
    sopId: string;
    participants: SopListReviewParticipant[];
  }>;
}

/**
 * Review progress for active SOPs visible to the caller. Keeping this
 * loader shared between the server first paint and client refresh prevents the
 * avatar/status cell from appearing in a second rendering pass.
 */
export async function fetchSopListReviewData(
  sops: readonly SopListItem[],
  currentUserId: string | null,
  client: SupabaseClient<Database>,
): Promise<SopListReviewData> {
  if (!currentUserId) {
    return { currentUserId: null, submissions: [], participantGroups: [] };
  }

  const visibleInReview = sops.filter((sop) =>
    sop.status === "in_review" || sop.status === "approved" || sop.status === "draft",
  );
  const sopIds = visibleInReview.map((sop) => sop.id);
  const [rawSubmissions, seats, progress] = await Promise.all([
    listSopReviewSubmissions(sopIds, client),
    listSeatsForSops(sopIds, client),
    listReviewProgress(sopIds, client),
  ]);
  const profileNames = await listProfileNames(
    seats.flatMap((seat) => (seat.signerId ? [seat.signerId] : [])),
    client,
  );
  const currentById = new Map(visibleInReview.map((sop) => [sop.id, sop]));
  const submissions = rawSubmissions.filter(
    (submission) => currentById.get(submission.sopId)?.reviewCycle === submission.reviewCycle,
  );
  const submittedNameByUserId = new Map(
    submissions.map((submission) => [submission.reviewerId, submission.reviewerName]),
  );
  const participantGroups = visibleInReview.map((sop) => {
    const unique = new Map<string, SopListReviewParticipant>();
    // Keep feedback visible during author corrections, without showing review
    // progress for a new draft that has never received a review.
    if (sop.status === "draft" && !submissions.some((item) => item.sopId === sop.id)) {
      return { sopId: sop.id, participants: [] };
    }
    for (const seat of seats) {
      if (seat.sopId !== sop.id || !seat.signerId || unique.has(seat.signerId)) continue;
      unique.set(seat.signerId, {
        userId: seat.signerId,
        status: reviewerStatus({
          sop,
          returned: submissions.some((item) => item.sopId === sop.id && item.reviewerId === seat.signerId),
          hasOpenComments: progress.comments.some((item) => item.sop_id === sop.id && item.review_cycle === sop.reviewCycle && item.created_by === seat.signerId),
          allSeatsSigned: Boolean(sop.contentHash) && seats
            .filter((item) => item.sopId === sop.id && item.signerId === seat.signerId)
            .every((item) => progress.signatures.some((signature) =>
              signature.sop_id === sop.id && signature.signer_id === seat.signerId &&
              signature.seat_department_id === item.departmentId &&
              signature.review_cycle === sop.reviewCycle && signature.signed_content_hash === sop.contentHash)),
        }),
        name:
          profileNames.get(seat.signerId) ||
          submittedNameByUserId.get(seat.signerId) ||
          "Assigned reviewer",
      });
    }
    return { sopId: sop.id, participants: Array.from(unique.values()) };
  });

  return { currentUserId, submissions, participantGroups };
}
