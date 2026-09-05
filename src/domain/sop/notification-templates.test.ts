import { describe, expect, it } from "vitest";
import { renderSopNotificationEmail, type SopEmailInput } from "./notification-templates";

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

  it("review_complete tells the author every reviewer is done and what to do next", () => {
    const out = renderSopNotificationEmail(input({ kind: "review_complete", actorName: "Ann Acct" }));
    expect(out.subject).toBe('Ready for final approval: SOP-0042 "Line Clearance"');
    expect(out.text).toContain("Every reviewer has responded");
    expect(out.text).toContain("send it for final approval");
    expect(out.html).toContain("author of this SOP");
  });

  it("stall_escalated names who the SOP waits on and speaks to a workspace manager", () => {
    const out = renderSopNotificationEmail(
      input({
        kind: "stall_escalated",
        stalled: [
          { name: "Tomas Bach", departmentName: "Engineering", waitingDays: 11 },
          { name: "Ana Author", departmentName: null, waitingDays: 9 },
        ],
      }),
    );
    expect(out.subject).toBe('Stalled: SOP-0042 "Line Clearance" needs a nudge');
    expect(out.text).toContain("Tomas Bach (Engineering seat) — 11 days; Ana Author — 9 days");
    expect(out.html).toContain("owner or admin of this workspace");
  });

  it("the Phase 1 kinds each have a subject that says what happened", () => {
    const subjects = (["released", "seat_assigned", "objection_raised", "objection_resolved", "remark_added"] as const).map(
      (kind) => renderSopNotificationEmail(input({ kind, actorName: "Quinn Quality" })).subject,
    );
    expect(subjects).toEqual([
      'Now effective: SOP-0042 "Line Clearance"',
      'Review seat assigned to you: SOP-0042 "Line Clearance"',
      'Objection raised: SOP-0042 "Line Clearance"',
      'Objection resolved: SOP-0042 "Line Clearance"',
      'New remark: SOP-0042 "Line Clearance"',
    ]);
  });

  it("released tells Informed seats why they got it and seat_assigned names the department", () => {
    expect(renderSopNotificationEmail(input({ kind: "released" })).html).toContain("author or hold a seat");
    expect(renderSopNotificationEmail(input({ kind: "seat_assigned" })).text).toContain("Engineering seat");
  });

  it("stall_escalated degrades gracefully without names", () => {
    expect(renderSopNotificationEmail(input({ kind: "stall_escalated" })).text).toContain("has not responded to two reminders");
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
    const out = renderSopNotificationEmail(input({ title: "<img src=x onerror=1>" }));
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
