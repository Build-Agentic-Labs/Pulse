import { describe, expect, it } from "vitest";
import {
  resolveEventRecipients,
  resolveReminders,
  renderSopNotificationEmail,
  type NotifiableEvent,
  type SopNotificationContext,
  type SopSnapshot,
  type SopReminderState,
  type SopEmailInput,
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

  it("emails only Responsible and Approve signers", () => {
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

  it("excludes the actor when they hold a quality approver position", () => {
    const c = qctx();
    const withActorAsApprover = {
      ...c,
      qualityApprovers: [
        ...c.qualityApprovers,
        { userId: "resp", holdsSeat: false, overruledThisCycle: false },
      ],
    };
    const out = resolveEventRecipients(approvedEvent(), withActorAsApprover);
    expect(ids(out)).toEqual(["q-clean"]);
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

  it("review_returned with malformed/missing details returns empty", () => {
    const e1 = event({ eventType: "review_returned", actorId: "resp", details: "corrupt" });
    expect(resolveEventRecipients(e1, ctx())).toEqual([]);

    const e2 = event({ eventType: "review_returned", actorId: "resp", details: {} });
    expect(resolveEventRecipients(e2, ctx())).toEqual([]);
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

describe("resolveReminders", () => {
  const NOW = new Date("2026-07-25T12:00:00Z"); // 4 days after 07-21
  const state = (over: Partial<SopReminderState> = {}): SopReminderState => ({
    sop: sop(),
    seats: [
      { departmentId: "d-r", departmentName: "Engineering", rasic: "responsible", signerId: "resp" },
      { departmentId: "d-s", departmentName: "Safety", rasic: "support", signerId: "supp" },
    ],
    qualityApprovers: [],
    currentReviewReturns: [],
    currentDeptApprovals: [],
    approvedAt: null,
    reviewSentAt: "2026-07-21T12:00:00Z",
    reminders: [],
    ...over,
  });

  it("nudges every stalled draft-phase reviewer after 3 days", () => {
    const out = resolveReminders(NOW, [state()]);
    expect(ids(out)).toEqual(["resp", "supp"]);
    expect(out.every((n) => n.kind === "review_requested" && n.reminderIndex === 1 && n.eventId === null)).toBe(true);
  });

  it("does not nudge before the threshold", () => {
    const early = new Date("2026-07-23T12:00:00Z"); // 2 days
    expect(resolveReminders(early, [state()])).toEqual([]);
  });

  it("fires at exactly the 3-day boundary", () => {
    const exact = new Date("2026-07-24T12:00:00Z"); // anchor 2026-07-21T12:00:00Z + exactly 72h
    expect(ids(resolveReminders(exact, [state()]))).toEqual(["resp", "supp"]);
  });

  it("skips reviewers who already returned their review", () => {
    expect(ids(resolveReminders(NOW, [state({ currentReviewReturns: ["resp"] })]))).toEqual(["supp"]);
  });

  it("caps at MAX_REMINDERS", () => {
    const capped = state({
      reminders: [
        { recipientId: "resp", kind: "review_requested", reminderIndex: 1, sentAt: "2026-07-24T12:00:00Z" },
        { recipientId: "resp", kind: "review_requested", reminderIndex: 2, sentAt: "2026-07-28T12:00:00Z" },
      ],
    });
    const late = new Date("2026-08-15T12:00:00Z");
    expect(ids(resolveReminders(late, [capped]))).toEqual(["supp"]);
  });

  it("anchors nudge 2 on nudge 1's sent_at, not the original event", () => {
    const one = state({
      reminders: [{ recipientId: "resp", kind: "review_requested", reminderIndex: 1, sentAt: "2026-07-24T00:00:00Z" }],
    });
    // 07-25 is only 1.5 days after nudge 1: resp not due; supp (no nudges yet) is.
    expect(ids(resolveReminders(NOW, [one]))).toEqual(["supp"]);
    const later = new Date("2026-07-27T06:00:00Z");
    const out = resolveReminders(later, [one]);
    expect(out.find((n) => n.recipientId === "resp")?.reminderIndex).toBe(2);
  });

  it("final-approval phase nudges only unsigned R/A seats", () => {
    const fa = state({
      sop: sop({ finalApprovalRequestedAt: "2026-07-21T12:00:00Z", finalApprovalContentHash: "hash-1" }),
      currentDeptApprovals: [],
    });
    const out = resolveReminders(NOW, [fa]);
    expect(ids(out)).toEqual(["resp"]); // supp is not R/A
    expect(out[0].kind).toBe("final_approval_requested");
  });

  it("final-approval nudge respects an existing signature for that seat", () => {
    const fa = state({
      sop: sop({ finalApprovalRequestedAt: "2026-07-21T12:00:00Z", finalApprovalContentHash: "hash-1" }),
      currentDeptApprovals: [{ signerId: "resp", departmentId: "d-r" }],
    });
    expect(resolveReminders(NOW, [fa])).toEqual([]);
  });

  it("quality stall nudges unbarred approvers, anchored on approved_at", () => {
    const q = state({
      sop: sop({ status: "approved" }),
      approvedAt: "2026-07-21T12:00:00Z",
      qualityApprovers: [
        { userId: "q-clean", holdsSeat: false, overruledThisCycle: false },
        { userId: "q-seated", holdsSeat: true, overruledThisCycle: false },
      ],
    });
    const out = resolveReminders(NOW, [q]);
    expect(ids(out)).toEqual(["q-clean"]);
    expect(out[0].kind).toBe("quality_release_requested");
  });

  it("self-cancels: a recalled SOP produces no reminders", () => {
    expect(resolveReminders(NOW, [state({ sop: sop({ status: "draft" }) })])).toEqual([]);
  });

  it("a reassigned seat's new signer gets nudge 1 (their first contact)", () => {
    const reassigned = state({
      seats: [{ departmentId: "d-r", departmentName: "Engineering", rasic: "responsible", signerId: "new-signer" }],
      reminders: [{ recipientId: "old-signer", kind: "review_requested", reminderIndex: 1, sentAt: "2026-07-22T12:00:00Z" }],
    });
    const out = resolveReminders(NOW, [reassigned]);
    expect(ids(out)).toEqual(["new-signer"]);
    expect(out[0].reminderIndex).toBe(1);
  });
});

describe("renderSopNotificationEmail", () => {
  const input = (over: Partial<SopEmailInput> = {}): SopEmailInput => ({
    kind: "review_requested",
    sopNumber: "SOP-0042",
    title: "Line Clearance",
    version: "C",
    actorName: "Sam Submitter",
    departmentName: "Engineering",
    origin: "https://pulse.example.com",
    sopId: "sop-1",
    reminderIndex: 0,
    waitingDays: null,
    ...over,
  });

  it("review subject carries number, title, and revision", () => {
    expect(renderSopNotificationEmail(input()).subject).toBe('Review requested: SOP-0042 "Line Clearance" (Rev C)');
  });

  it("subjects match the spec shapes for the other kinds", () => {
    expect(renderSopNotificationEmail(input({ kind: "final_approval_requested" })).subject).toBe(
      'Signature needed: SOP-0042 "Line Clearance"',
    );
    expect(renderSopNotificationEmail(input({ kind: "quality_release_requested" })).subject).toBe(
      'Ready for release: SOP-0042 "Line Clearance"',
    );
    expect(renderSopNotificationEmail(input({ kind: "sent_back" })).subject).toBe(
      'Sent back with remarks: SOP-0042 "Line Clearance"',
    );
  });

  it("body links to the SOP in both text and html", () => {
    const { text, html } = renderSopNotificationEmail(input());
    expect(text).toContain("https://pulse.example.com/sops/sop-1");
    expect(html).toContain('href="https://pulse.example.com/sops/sop-1"');
  });

  it("reminders get the prefix and the waiting line", () => {
    const out = renderSopNotificationEmail(input({ reminderIndex: 1, waitingDays: 4 }));
    expect(out.subject).toBe('Reminder: Review requested: SOP-0042 "Line Clearance" (Rev C)');
    expect(out.text).toContain("waiting 4 days");
  });

  it("html-escapes user-controlled fields", () => {
    const out = renderSopNotificationEmail(input({ title: '<img src=x onerror=1>' }));
    expect(out.html).not.toContain("<img");
    expect(out.html).toContain("&lt;img");
  });

  it("falls back gracefully when number/title/version are missing", () => {
    const out = renderSopNotificationEmail(input({ sopNumber: null, title: null, version: null }));
    expect(out.subject).toBe('Review requested: SOP "Untitled SOP"');
  });

  it("brands the html with the Pulse wordmark and an uppercase kind eyebrow", () => {
    const { html } = renderSopNotificationEmail(input());
    expect(html).toContain(">Pulse</span>");
    expect(html).toContain("Review requested</p>");
  });

  it("footer explains why the recipient got the email, per kind", () => {
    expect(renderSopNotificationEmail(input()).html).toContain("you hold a review seat");
    expect(renderSopNotificationEmail(input({ kind: "final_approval_requested" })).html).toContain(
      "you hold a review seat",
    );
    expect(renderSopNotificationEmail(input({ kind: "quality_release_requested" })).html).toContain(
      "Quality approver",
    );
    expect(renderSopNotificationEmail(input({ kind: "sent_back" })).html).toContain("author of this SOP");
  });

  it("text version carries the reason footer too", () => {
    expect(renderSopNotificationEmail(input()).text).toContain("you hold a review seat");
  });

  it("reminder emails mark the eyebrow and render the waiting line as a note", () => {
    const { html } = renderSopNotificationEmail(input({ reminderIndex: 1, waitingDays: 4 }));
    expect(html).toContain("Reminder — Review requested</p>");
    expect(html).toContain("waiting 4 days");
  });

  it("escapes the title inside the card heading", () => {
    const { html } = renderSopNotificationEmail(input({ title: '<b>"sneaky"</b>' }));
    expect(html).not.toContain("<b>");
    expect(html).toContain("&lt;b&gt;");
  });
});
