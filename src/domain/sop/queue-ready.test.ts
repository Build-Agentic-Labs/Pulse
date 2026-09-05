import { describe, expect, it } from "vitest";
import type { SopListItem } from "@/lib/sop/store";
import { selectReadyForFinalApproval, type ReadyForFinalApprovalInput } from "./queue-ready";

const AUTHOR = "author";

function sop(over: Partial<SopListItem> = {}): SopListItem {
  return {
    id: "sop-1",
    sopNumber: "",
    title: "Line Clearance",
    version: "A",
    source: "authored",
    status: "in_review",
    updatedAt: "2026-07-29T00:00:00Z",
    departmentId: "d-prd",
    departmentCode: "PRD",
    effectiveDate: null,
    nextReviewDate: null,
    createdBy: AUTHOR,
    rejectedReason: null,
    reviewCycle: 1,
    contentHash: "h1",
    finalApprovalRequestedAt: null,
    finalApprovalContentHash: null,
    ...over,
  };
}

function input(over: Partial<ReadyForFinalApprovalInput> = {}): ReadyForFinalApprovalInput {
  return {
    userId: AUTHOR,
    sops: [sop()],
    seats: [
      { sopId: "sop-1", rasic: "responsible", signerId: "resp" },
      { sopId: "sop-1", rasic: "informed", signerId: null },
    ],
    submissions: [{ sopId: "sop-1", reviewCycle: 1, reviewerId: "resp" }],
    openAnnotations: [],
    ...over,
  };
}

describe("selectReadyForFinalApproval", () => {
  it("lists an authored SOP whose every required approver has returned and nothing is open", () => {
    expect(selectReadyForFinalApproval(input()).map((item) => item.id)).toEqual(["sop-1"]);
  });

  it("ignores SOPs the viewer did not author", () => {
    expect(selectReadyForFinalApproval(input({ userId: "someone-else" }))).toEqual([]);
  });

  it("waits while a required approver has not returned this cycle", () => {
    const stale = input({ submissions: [{ sopId: "sop-1", reviewCycle: 0, reviewerId: "resp" }] });
    expect(selectReadyForFinalApproval(stale)).toEqual([]);
    const twoSeats = input({
      seats: [
        { sopId: "sop-1", rasic: "responsible", signerId: "resp" },
        { sopId: "sop-1", rasic: "accountable", signerId: "acct" },
      ],
    });
    expect(selectReadyForFinalApproval(twoSeats)).toEqual([]);
  });

  it("holds while a current-cycle remark is unresolved", () => {
    expect(selectReadyForFinalApproval(input({ openAnnotations: [{ sopId: "sop-1", reviewCycle: 1 }] }))).toEqual([]);
    expect(
      selectReadyForFinalApproval(input({ openAnnotations: [{ sopId: "sop-1", reviewCycle: 0 }] })).map((s) => s.id),
    ).toEqual(["sop-1"]);
  });

  it("drops the SOP once final approval is underway or it has left review", () => {
    const underway = input({ sops: [sop({ finalApprovalRequestedAt: "2026-07-30T00:00:00Z", finalApprovalContentHash: "h1" })] });
    expect(selectReadyForFinalApproval(underway)).toEqual([]);
    expect(selectReadyForFinalApproval(input({ sops: [sop({ status: "draft" })] }))).toEqual([]);
  });

  it("re-lists an SOP whose content changed after a stale final-approval request", () => {
    const reset = input({ sops: [sop({ finalApprovalRequestedAt: "2026-07-30T00:00:00Z", finalApprovalContentHash: "old" })] });
    expect(selectReadyForFinalApproval(reset).map((s) => s.id)).toEqual(["sop-1"]);
  });

  it("needs at least one seated required approver — an unstaffed SOP is not 'complete'", () => {
    expect(selectReadyForFinalApproval(input({ seats: [{ sopId: "sop-1", rasic: "informed", signerId: null }] }))).toEqual([]);
  });
});
