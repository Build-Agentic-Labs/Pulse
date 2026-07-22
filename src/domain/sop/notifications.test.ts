import { describe, expect, it } from "vitest";
import {
  resolveEventRecipients,
  type NotifiableEvent,
  type SopNotificationContext,
  type SopSnapshot,
} from "./notifications";

const sop = (over: Partial<SopSnapshot> = {}): SopSnapshot => ({
  id: "sop-1",
  title: "Line Clearance",
  sopNumber: "SOP-0042",
  version: "C",
  status: "in_review",
  deletedAt: null,
  authorId: "author",
  submittedBy: "submitter",
  contentHash: "hash-1",
  finalApprovalRequestedAt: null,
  finalApprovalContentHash: null,
  rejectedReason: null,
  reviewCycle: 1,
  ...over,
});

const ctx = (over: Partial<SopNotificationContext> = {}): SopNotificationContext => ({
  sop: sop(),
  seats: [
    { departmentId: "d-r", departmentName: "Engineering", rasic: "responsible", signerId: "resp" },
    { departmentId: "d-a", departmentName: "Ops", rasic: "accountable", signerId: "acct" },
    { departmentId: "d-s", departmentName: "Safety", rasic: "support", signerId: "supp" },
    { departmentId: "d-i", departmentName: "HR", rasic: "informed", signerId: "info" },
  ],
  qualityApprovers: [],
  ...over,
});

const event = (over: Partial<NotifiableEvent> = {}): NotifiableEvent => ({
  id: 10,
  sopId: "sop-1",
  eventType: "review_sent",
  actorId: "submitter",
  actorName: "Sam Submitter",
  details: {},
  createdAt: "2026-07-21T12:00:00Z",
  ...over,
});

const ids = (list: { recipientId: string }[]) => list.map((n) => n.recipientId).sort();

describe("resolveEventRecipients: review_sent", () => {
  it("emails every non-informed seat signer, excluding the actor", () => {
    const out = resolveEventRecipients(event(), ctx());
    expect(ids(out)).toEqual(["acct", "resp", "supp"]);
    expect(out.every((n) => n.kind === "review_requested")).toBe(true);
    expect(out.every((n) => n.eventId === 10 && n.reminderIndex === 0)).toBe(true);
  });

  it("never emails informed seats", () => {
    expect(ids(resolveEventRecipients(event(), ctx()))).not.toContain("info");
  });

  it("excludes the actor when they hold a seat", () => {
    const out = resolveEventRecipients(event({ actorId: "supp" }), ctx());
    expect(ids(out)).toEqual(["acct", "resp"]);
  });

  it("dedupes a signer holding two seats", () => {
    const c = ctx();
    const twoSeats = { ...c, seats: [c.seats[0], { ...c.seats[1], signerId: "resp" }] };
    expect(ids(resolveEventRecipients(event(), twoSeats))).toEqual(["resp"]);
  });

  it("skips when the SOP has left in_review (moment passed)", () => {
    const c = ctx({ sop: sop({ status: "draft" }) });
    expect(resolveEventRecipients(event(), c)).toEqual([]);
  });

  it("skips when final approval has since been requested", () => {
    const c = ctx({
      sop: sop({ finalApprovalRequestedAt: "2026-07-21T13:00:00Z", finalApprovalContentHash: "hash-1" }),
    });
    expect(resolveEventRecipients(event(), c)).toEqual([]);
  });
});

describe("resolveEventRecipients: final_approval_requested", () => {
  const fa = () =>
    ctx({
      sop: sop({ finalApprovalRequestedAt: "2026-07-21T13:00:00Z", finalApprovalContentHash: "hash-1" }),
    });

  it("emails only Responsible and Accountable signers", () => {
    const out = resolveEventRecipients(event({ eventType: "final_approval_requested", actorId: "author" }), fa());
    expect(ids(out)).toEqual(["acct", "resp"]);
    expect(out.every((n) => n.kind === "final_approval_requested")).toBe(true);
  });

  it("skips when the content changed after the request (phase reset)", () => {
    const c = ctx({
      sop: sop({ finalApprovalRequestedAt: "2026-07-21T13:00:00Z", finalApprovalContentHash: "old-hash" }),
    });
    expect(resolveEventRecipients(event({ eventType: "final_approval_requested" }), c)).toEqual([]);
  });
});

describe("resolveEventRecipients: quality gate", () => {
  const approvedEvent = () =>
    event({ eventType: "status_changed", actorId: "resp", details: { from_status: "in_review", to_status: "approved" } });
  const qctx = () =>
    ctx({
      sop: sop({ status: "approved" }),
      qualityApprovers: [
        { userId: "q-clean", holdsSeat: false, overruledThisCycle: false },
        { userId: "q-seated", holdsSeat: true, overruledThisCycle: false },
        { userId: "q-overruled", holdsSeat: false, overruledThisCycle: true },
        { userId: "author", holdsSeat: false, overruledThisCycle: false },
        { userId: "submitter", holdsSeat: false, overruledThisCycle: false },
      ],
    });

  it("emails only unbarred quality approvers", () => {
    const out = resolveEventRecipients(approvedEvent(), qctx());
    expect(ids(out)).toEqual(["q-clean"]);
    expect(out[0].kind).toBe("quality_release_requested");
  });

  it("ignores status_changed events that are not -> approved", () => {
    const e = event({ eventType: "status_changed", details: { to_status: "obsolete" } });
    expect(resolveEventRecipients(e, qctx())).toEqual([]);
  });

  it("skips when the SOP is no longer approved", () => {
    const c = qctx();
    expect(resolveEventRecipients(approvedEvent(), { ...c, sop: sop({ status: "effective" }) })).toEqual([]);
  });

  it("treats malformed details as not-classifiable (no mail, no throw)", () => {
    const e = event({ eventType: "status_changed", details: "corrupt" });
    expect(resolveEventRecipients(e, qctx())).toEqual([]);
  });
});

describe("resolveEventRecipients: sent_back", () => {
  it("review_returned with remarks emails the author", () => {
    const e = event({ eventType: "review_returned", actorId: "resp", details: { no_changes: false } });
    const out = resolveEventRecipients(e, ctx());
    expect(ids(out)).toEqual(["author"]);
    expect(out[0].kind).toBe("sent_back");
  });

  it("review_returned with no_changes=true sends nothing", () => {
    const e = event({ eventType: "review_returned", actorId: "resp", details: { no_changes: true } });
    expect(resolveEventRecipients(e, ctx())).toEqual([]);
  });

  it("review_recalled with an open rejection emails the author", () => {
    const e = event({ eventType: "review_recalled", actorId: "resp" });
    const c = ctx({ sop: sop({ status: "draft", rejectedReason: "Missing PPE step" }) });
    expect(ids(resolveEventRecipients(e, c))).toEqual(["author"]);
  });

  it("review_recalled without a rejection is a recall: no mail", () => {
    const e = event({ eventType: "review_recalled", actorId: "author" });
    const c = ctx({ sop: sop({ status: "draft" }) });
    expect(resolveEventRecipients(e, c)).toEqual([]);
  });

  it("never emails the author about their own action", () => {
    const e = event({ eventType: "review_returned", actorId: "author", details: { no_changes: false } });
    expect(resolveEventRecipients(e, ctx())).toEqual([]);
  });
});

describe("resolveEventRecipients: universal guards", () => {
  it("deleted SOPs never notify", () => {
    const c = ctx({ sop: sop({ deletedAt: "2026-07-20T00:00:00Z" }) });
    expect(resolveEventRecipients(event(), c)).toEqual([]);
  });

  it("unknown event types resolve to nothing", () => {
    expect(resolveEventRecipients(event({ eventType: "remark_added" }), ctx())).toEqual([]);
  });
});
