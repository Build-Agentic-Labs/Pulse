/**
 * Gate for the author's "Make changes" action on a draft review.
 *
 * The draft may only be recalled for edits once every assigned reviewer has
 * responded AND at least one of them returned feedback. While reviews are
 * outstanding the draft must stay frozen so all reviewers see the same
 * content; when everyone returns "no changes needed" the correct next step
 * is final approval, not another edit cycle.
 */

export interface DraftReviewerLike {
  submission?: { noChanges: boolean };
}

export type DraftReviewGateReason = "no-reviewers" | "waiting" | "approved" | "changes";

export interface DraftReviewGate {
  allResponded: boolean;
  changesRequested: boolean;
  canMakeChanges: boolean;
  reason: DraftReviewGateReason;
}

export function draftReviewGate(reviewers: readonly DraftReviewerLike[]): DraftReviewGate {
  const allResponded = reviewers.length > 0 && reviewers.every((reviewer) => reviewer.submission);
  const changesRequested = reviewers.some(
    (reviewer) => reviewer.submission && !reviewer.submission.noChanges,
  );
  const reason: DraftReviewGateReason = !reviewers.length
    ? "no-reviewers"
    : !allResponded
      ? "waiting"
      : changesRequested
        ? "changes"
        : "approved";
  return {
    allResponded,
    changesRequested,
    canMakeChanges: allResponded && changesRequested,
    reason,
  };
}
