import { describe, expect, it } from "vitest";
import { reviewerStatus } from "./reviewer-status";

const sop = {
  status: "in_review" as const, rejectedReason: null, contentHash: "current",
  finalApprovalRequestedAt: null as string | null, finalApprovalContentHash: null as string | null,
};
const input = { sop, returned: true, hasOpenComments: true, allSeatsSigned: false };

describe("reviewerStatus", () => {
  it("clears red when the author's resolutions close the feedback", () => {
    expect(reviewerStatus(input)).toBe("changes_requested");
    expect(reviewerStatus({ ...input, hasOpenComments: false })).toBe("review_complete");
  });
  it("switches from feedback to awaiting signature to signed", () => {
    const final = { ...input, sop: { ...sop, finalApprovalRequestedAt: "today", finalApprovalContentHash: "current" } };
    expect(reviewerStatus(final)).toBe("awaiting_signature");
    expect(reviewerStatus({ ...final, allSeatsSigned: true })).toBe("signed");
  });
  it("does not use a final approval request for an older document", () => {
    expect(reviewerStatus({ ...input, sop: { ...sop, finalApprovalRequestedAt: "today", finalApprovalContentHash: "old" } })).toBe("changes_requested");
  });
  it("keeps a missing review pending", () => {
    expect(reviewerStatus({ ...input, returned: false })).toBe("reviewing");
  });
});
