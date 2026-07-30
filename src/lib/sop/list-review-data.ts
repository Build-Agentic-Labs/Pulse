import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";
import { listProfileNames, listSeatsForSops } from "@/lib/sop/review";
import {
  listSopReviewSubmissions,
  type SopReviewSubmission,
} from "@/lib/sop/review-annotations";
import type { SopListItem } from "@/lib/sop/store";

export interface SopListReviewParticipant {
  userId: string;
  name: string;
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
 * Review progress for every in-review SOP visible to the caller. Keeping this
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

  const visibleInReview = sops.filter((sop) => sop.status === "in_review");
  const sopIds = visibleInReview.map((sop) => sop.id);
  const [rawSubmissions, seats] = await Promise.all([
    listSopReviewSubmissions(sopIds, client),
    listSeatsForSops(sopIds, client),
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
    for (const seat of seats) {
      if (seat.sopId !== sop.id || !seat.signerId || unique.has(seat.signerId)) continue;
      unique.set(seat.signerId, {
        userId: seat.signerId,
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
