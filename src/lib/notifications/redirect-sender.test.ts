import { describe, expect, it } from "vitest";
import type { EmailSender } from "@/lib/sop/notifications-drain";
import { withRecipientRedirect } from "./redirect-sender";

const content = { subject: "Review requested: SOP-0042", text: "Body line.\n\nOpen it: https://x", html: "<div><p>Body</p></div>" };

describe("withRecipientRedirect", () => {
  it("sends to the redirect address, prefixes the subject with the original recipient, and keeps the key", async () => {
    const seen: { to: string; subject: string; text: string; html: string; key: string }[] = [];
    const inner: EmailSender = async (to, mail, options) => {
      seen.push({ to, subject: mail.subject, text: mail.text, html: mail.html, key: options.idempotencyKey });
      return { ok: true, id: "re_1" };
    };
    const send = withRecipientRedirect(inner, "rlopez@anacorp.com");
    const result = await send("jli@anacorp.com", content, { idempotencyKey: "sop_notifications:9" });
    expect(result).toEqual({ ok: true, id: "re_1" });
    expect(seen).toHaveLength(1);
    expect(seen[0].to).toBe("rlopez@anacorp.com");
    expect(seen[0].subject).toBe("[TEST → jli@anacorp.com] Review requested: SOP-0042");
    expect(seen[0].text.startsWith("TEST REDIRECT — this email was addressed to jli@anacorp.com.")).toBe(true);
    expect(seen[0].text).toContain("Body line.");
    expect(seen[0].html).toContain("addressed to jli@anacorp.com");
    expect(seen[0].html).toContain("<p>Body</p>");
    expect(seen[0].key).toBe("sop_notifications:9");
  });

  it("escapes the original address in the html banner", async () => {
    const seen: string[] = [];
    const inner: EmailSender = async (_to, mail) => {
      seen.push(mail.html);
      return { ok: true, id: "re_2" };
    };
    await withRecipientRedirect(inner, "rlopez@anacorp.com")("<b>x</b>@y.com", content, { idempotencyKey: "k" });
    expect(seen[0]).not.toContain("<b>x</b>");
    expect(seen[0]).toContain("&lt;b&gt;x&lt;/b&gt;@y.com");
  });

  it("passes provider failures through unchanged", async () => {
    const inner: EmailSender = async () => ({ ok: false, status: 422, error: "Invalid `to` field", failure: "recipient" });
    const result = await withRecipientRedirect(inner, "rlopez@anacorp.com")("a@b.com", content, { idempotencyKey: "k" });
    expect(result).toEqual({ ok: false, status: 422, error: "Invalid `to` field", failure: "recipient" });
  });
});
