import { describe, expect, it } from "vitest";
import type { QueueData } from "@/lib/sop/review-queue-data";
import { badgeLabel, excludeAcknowledged, summarizeQueue } from "./queue-summary";

// Compact builders: only identity fields vary; the rest are constants that
// satisfy the lib types without mattering to the summary.
function seat(sopId: string, sopNumber: string, title: string): QueueData["awaitingMe"][number] {
  return {
    sopId,
    sopNumber,
    title,
    departmentId: "d1",
    departmentCode: "ENG",
    sopDepartmentId: "d1",
    sopDepartmentCode: "ENG",
    rasic: "responsible",
    version: "A",
    status: "in_review",
    contentHash: "h",
    finalApprovalRequestedAt: null,
    finalApprovalContentHash: null,
    reviewCycle: 0,
    updatedAt: "2026-07-22T00:00:00Z",
  };
}

function sopItem(id: string, sopNumber: string, title: string): QueueData["sentBack"][number] {
  return {
    id,
    sopNumber,
    title,
    version: "A",
    source: "authored",
    status: "draft",
    updatedAt: "2026-07-22T00:00:00Z",
    departmentId: "d1",
    departmentCode: "ENG",
    effectiveDate: null,
    nextReviewDate: null,
    createdBy: "u1",
    rejectedReason: "needs work",
    reviewCycle: 0,
    contentHash: "h",
    finalApprovalRequestedAt: null,
    finalApprovalContentHash: null,
  };
}

function qualityItem(id: string, sopNumber: string, title: string): QueueData["awaitingQuality"][number] {
  return { ...sopItem(id, sopNumber, title), status: "approved", departmentCode: "ENG", departmentName: "Engineering" };
}

function queue(over: Partial<QueueData> = {}): QueueData {
  return {
    awaitingMe: [],
    finalApprovals: [],
    sentBack: [],
    awaitingQuality: [],
    allInFlight: [],
    isQualityApprover: false,
    ...over,
  };
}

describe("summarizeQueue", () => {
  it("totals the four actionable sections and never counts allInFlight", () => {
    const summary = summarizeQueue(
      queue({
        awaitingMe: [seat("s1", "SOP-1", "One")],
        finalApprovals: [seat("s2", "SOP-2", "Two")],
        awaitingQuality: [qualityItem("s3", "SOP-3", "Three")],
        sentBack: [sopItem("s4", "SOP-4", "Four")],
        allInFlight: [sopItem("s9", "SOP-9", "Noise"), sopItem("s10", "SOP-10", "Noise")],
      }),
    );
    expect(summary.total).toBe(4);
  });

  it("keeps the fixed section order and exact labels", () => {
    const summary = summarizeQueue(
      queue({
        sentBack: [sopItem("s4", "SOP-4", "Four")],
        awaitingMe: [seat("s1", "SOP-1", "One")],
        awaitingQuality: [qualityItem("s3", "SOP-3", "Three")],
        finalApprovals: [seat("s2", "SOP-2", "Two")],
      }),
    );
    expect(summary.sections.map((section) => section.label)).toEqual([
      "Awaiting my review",
      "Signature needed",
      "Ready for release",
      "Sent back",
    ]);
  });

  it("omits empty sections", () => {
    const summary = summarizeQueue(queue({ sentBack: [sopItem("s4", "SOP-4", "Four")] }));
    expect(summary.sections.map((section) => section.key)).toEqual(["sentBack"]);
    expect(summary.total).toBe(1);
  });

  it("maps items from both row shapes and gives each workflow event a stable notification ID", () => {
    const summary = summarizeQueue(
      queue({
        awaitingMe: [seat("seat-sop", "SOP-1", "Seat Row")],
        sentBack: [sopItem("list-sop", "SOP-4", "List Row")],
      }),
    );
    expect(summary.sections[0].items).toEqual([
      {
        notificationId: "awaitingMe:seat-sop:d1:0:h",
        sopId: "seat-sop",
        sopNumber: "SOP-1",
        title: "Seat Row",
      },
    ]);
    expect(summary.sections[1].items).toEqual([
      {
        notificationId: "sentBack:list-sop:0:h:needs%20work",
        sopId: "list-sop",
        sopNumber: "SOP-4",
        title: "List Row",
      },
    ]);
  });

  it("an SOP in two sections counts once per section (no cross-section dedupe)", () => {
    const summary = summarizeQueue(
      queue({
        awaitingMe: [seat("same", "SOP-1", "Same")],
        sentBack: [sopItem("same", "SOP-1", "Same")],
      }),
    );
    expect(summary.total).toBe(2);
  });

  it("empty queue summarizes to zero sections and zero total", () => {
    expect(summarizeQueue(queue())).toEqual({ total: 0, sections: [] });
  });
});

describe("excludeAcknowledged", () => {
  it("removes an acknowledged item, its empty section, and its badge count", () => {
    const summary = summarizeQueue(
      queue({
        awaitingMe: [seat("s1", "SOP-1", "One")],
        sentBack: [sopItem("s2", "SOP-2", "Two")],
      }),
    );
    const acknowledgedId = summary.sections[0].items[0].notificationId;

    expect(excludeAcknowledged(summary, new Set([acknowledgedId]))).toEqual({
      total: 1,
      sections: [summary.sections[1]],
    });
  });

  it("allows a later review cycle for the same SOP to appear as a new notification", () => {
    const firstSeat = seat("same", "SOP-1", "Same");
    const first = summarizeQueue(queue({ awaitingMe: [firstSeat] }));
    const next = summarizeQueue(
      queue({
        awaitingMe: [{ ...firstSeat, reviewCycle: 1, contentHash: "new-content" }],
      }),
    );

    expect(
      excludeAcknowledged(next, new Set([first.sections[0].items[0].notificationId])).total,
    ).toBe(1);
  });
});

describe("badgeLabel", () => {
  it("shows exact counts through 9 and caps at 9+", () => {
    expect(badgeLabel(0)).toBe("0");
    expect(badgeLabel(1)).toBe("1");
    expect(badgeLabel(9)).toBe("9");
    expect(badgeLabel(10)).toBe("9+");
    expect(badgeLabel(47)).toBe("9+");
  });
});
