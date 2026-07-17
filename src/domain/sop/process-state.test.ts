import { describe, expect, it } from "vitest";
import { getSopProcessState } from "./process-state";

const base = {
  rejectedReason: null,
  contentHash: "hash-v1",
  finalApprovalRequestedAt: null,
  finalApprovalContentHash: null,
} as const;

describe("getSopProcessState", () => {
  it("distinguishes draft review from final approval", () => {
    expect(getSopProcessState({ ...base, status: "in_review" })).toBe("draft_review");
    expect(
      getSopProcessState({
        ...base,
        status: "in_review",
        finalApprovalRequestedAt: "2026-07-16T12:00:00.000Z",
        finalApprovalContentHash: "hash-v1",
      }),
    ).toBe("final_approval");
  });

  it("does not show final approval for a stale document hash", () => {
    expect(
      getSopProcessState({
        ...base,
        status: "in_review",
        finalApprovalRequestedAt: "2026-07-16T12:00:00.000Z",
        finalApprovalContentHash: "older-hash",
      }),
    ).toBe("draft_review");
  });

  it("maps lifecycle and returned-change states", () => {
    expect(getSopProcessState({ ...base, status: "draft" })).toBe("draft");
    expect(getSopProcessState({ ...base, status: "draft", rejectedReason: "Update the purpose." })).toBe(
      "changes_requested",
    );
    expect(getSopProcessState({ ...base, status: "approved" })).toBe("awaiting_quality");
    expect(getSopProcessState({ ...base, status: "effective" })).toBe("effective");
    expect(getSopProcessState({ ...base, status: "obsolete" })).toBe("retired");
  });
});
