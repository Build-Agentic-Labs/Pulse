import { describe, expect, it } from "vitest";
import { hasSubmittedSopReview, type SopReviewSubmission } from "./review-annotations";

const completedReview: SopReviewSubmission = {
  id: "submission-1",
  sopId: "sop-previous",
  reviewCycle: 0,
  reviewerId: "reviewer-1",
  reviewerName: "Rosendo Lopez",
  noChanges: true,
  contentHash: "hash-v1",
  submittedAt: "2026-07-15T12:00:00.000Z",
};

describe("hasSubmittedSopReview", () => {
  it("does not let a completed review hide another SOP in the same review cycle", () => {
    expect(hasSubmittedSopReview([completedReview], "sop-new", 0, "reviewer-1")).toBe(false);
  });

  it("matches the SOP, review cycle, and reviewer together", () => {
    expect(hasSubmittedSopReview([completedReview], "sop-previous", 0, "reviewer-1")).toBe(true);
    expect(hasSubmittedSopReview([completedReview], "sop-previous", 1, "reviewer-1")).toBe(false);
    expect(hasSubmittedSopReview([completedReview], "sop-previous", 0, "reviewer-2")).toBe(false);
  });

  it("still counts the round after the author edits the draft (one round per cycle)", () => {
    // The author recalling and editing changes the content hash. Under the
    // single-round policy the reviewer is NOT asked again for the same cycle.
    expect(hasSubmittedSopReview([completedReview], "sop-previous", 0, "reviewer-1")).toBe(true);
  });
});
