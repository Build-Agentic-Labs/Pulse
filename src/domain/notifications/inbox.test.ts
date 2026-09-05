import { describe, expect, it } from "vitest";
import { inboxEntryFromEmail } from "./inbox";

describe("inboxEntryFromEmail", () => {
  const content = {
    subject: 'Reminder: Review requested: SOP-0042 "Line Clearance" (Rev C)',
    text: "Sam Submitter sent SOP-0042 \"Line Clearance\" for review.\n\nPlease review it and return your result.\n\nOpen it: https://x",
    html: "<p>…</p>",
  };

  it("uses the email subject as the title and the first paragraph as the body", () => {
    expect(inboxEntryFromEmail(content, { link: "/sops/sop-1", entityType: "sop", entityId: "sop-1" })).toEqual({
      title: 'Reminder: Review requested: SOP-0042 "Line Clearance" (Rev C)',
      body: 'Sam Submitter sent SOP-0042 "Line Clearance" for review.',
      link: "/sops/sop-1",
      entityType: "sop",
      entityId: "sop-1",
    });
  });

  it("caps the body so a long remark cannot bloat the inbox row", () => {
    const long = { ...content, text: "x".repeat(1000) };
    expect(inboxEntryFromEmail(long, { link: null, entityType: null, entityId: null }).body).toHaveLength(280);
  });

  it("tolerates empty text", () => {
    expect(inboxEntryFromEmail({ ...content, text: "" }, { link: null, entityType: null, entityId: null }).body).toBe("");
  });
});
