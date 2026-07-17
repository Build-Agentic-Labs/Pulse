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
    expect(hasSubmittedSopReview([completedReview], "sop-new", 0, "reviewer-1", "hash-v1")).toBe(false);
  });

  it("matches the SOP, review cycle, reviewer, and draft content together", () => {
    expect(hasSubmittedSopReview([completedReview], "sop-previous", 0, "reviewer-1", "hash-v1")).toBe(true);
    expect(hasSubmittedSopReview([completedReview], "sop-previous", 1, "reviewer-1", "hash-v1")).toBe(false);
    expect(hasSubmittedSopReview([completedReview], "sop-previous", 0, "reviewer-2", "hash-v1")).toBe(false);
    expect(hasSubmittedSopReview([completedReview], "sop-previous", 0, "reviewer-1", "hash-v2")).toBe(false);
  });
});
