import { describe, expect, it } from "vitest";
import { feedbackReceivedAt, reviewReceivedAt } from "./queue-received";

const sops = [{ id: "s1", reviewCycle: 2 }];
const event = (over: Partial<Parameters<typeof reviewReceivedAt>[0][number]> = {}) => ({
  sopId: "s1",
  reviewCycle: 2,
  eventType: "review_sent",
  details: {},
  createdAt: "2026-09-20T10:00:00Z",
  ...over,
});

describe("reviewReceivedAt", () => {
  it("is when the author sent the current cycle for review", () => {
    expect(reviewReceivedAt([event()], sops, "me")).toEqual({ s1: "2026-09-20T10:00:00Z" });
  });

  it("moves to a later reassignment of the seat to the viewer, not to someone else", () => {
    const events = [
      event(),
      event({ eventType: "seat_reassigned", details: { to_signer_id: "other" }, createdAt: "2026-09-21T10:00:00Z" }),
      event({ eventType: "seat_reassigned", details: { to_signer_id: "me" }, createdAt: "2026-09-22T10:00:00Z" }),
    ];
    expect(reviewReceivedAt(events, sops, "me")).toEqual({ s1: "2026-09-22T10:00:00Z" });
  });

  it("ignores earlier cycles and unknown SOPs", () => {
    expect(reviewReceivedAt([event({ reviewCycle: 1 }), event({ sopId: "gone" })], sops, "me")).toEqual({});
  });
});

describe("feedbackReceivedAt", () => {
  it("is when the last current-cycle review came back", () => {
    const returns = [
      { sopId: "s1", reviewCycle: 2, submittedAt: "2026-09-21T09:00:00Z" },
      { sopId: "s1", reviewCycle: 2, submittedAt: "2026-09-22T09:00:00Z" },
      { sopId: "s1", reviewCycle: 1, submittedAt: "2026-09-25T09:00:00Z" },
    ];
    expect(feedbackReceivedAt(returns, sops)).toEqual({ s1: "2026-09-22T09:00:00Z" });
  });
});
