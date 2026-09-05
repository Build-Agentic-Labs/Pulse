import { describe, expect, it } from "vitest";
import { parseResendWebhookEvent } from "./resend-webhook";

const base = {
  type: "email.delivered",
  created_at: "2026-09-04T12:00:01.000Z",
  data: {
    email_id: "re_123",
    from: "Pulse <notifications@pulse.test>",
    to: ["Reviewer@Anacorp.com"],
    subject: "Review requested",
    created_at: "2026-09-04T12:00:00.000Z",
  },
};

describe("parseResendWebhookEvent", () => {
  it("maps a delivery event, lower-casing the recipient and carrying the Svix event id", () => {
    expect(parseResendWebhookEvent(base, "msg_1")).toEqual({
      eventId: "msg_1",
      type: "email.delivered",
      messageId: "re_123",
      recipients: ["reviewer@anacorp.com"],
      occurredAt: "2026-09-04T12:00:01.000Z",
      suppress: null,
    });
  });

  it("suppresses every recipient of a permanent bounce", () => {
    const bounced = {
      ...base,
      type: "email.bounced",
      data: { ...base.data, to: ["a@x.com", "b@x.com"], bounce: { type: "Permanent", subType: "General", message: "550" } },
    };
    expect(parseResendWebhookEvent(bounced, "msg_2")?.suppress).toEqual([
      { email: "a@x.com", reason: "hard_bounce" },
      { email: "b@x.com", reason: "hard_bounce" },
    ]);
  });

  it("does not suppress on a transient bounce", () => {
    const soft = { ...base, type: "email.bounced", data: { ...base.data, bounce: { type: "Transient", subType: "MailboxFull" } } };
    expect(parseResendWebhookEvent(soft, "msg_3")?.suppress).toBeNull();
  });

  it("suppresses on a complaint", () => {
    const complaint = { ...base, type: "email.complained" };
    expect(parseResendWebhookEvent(complaint, "msg_4")?.suppress).toEqual([{ email: "reviewer@anacorp.com", reason: "complaint" }]);
  });

  it("falls back to the outer timestamp shape Resend used before created_at was standardised", () => {
    const legacy = { type: "email.sent", data: { email_id: "re_9", to: ["x@y.com"] } };
    const parsed = parseResendWebhookEvent(legacy, "msg_5", new Date("2026-09-04T13:00:00Z"));
    expect(parsed?.occurredAt).toBe("2026-09-04T13:00:00.000Z");
  });

  it("returns null for a payload that is not a Resend email event", () => {
    expect(parseResendWebhookEvent({ hello: "world" }, "msg_6")).toBeNull();
    expect(parseResendWebhookEvent("nope", "msg_7")).toBeNull();
    expect(parseResendWebhookEvent({ type: "contact.created", data: {} }, "msg_8")).toBeNull();
  });
});
