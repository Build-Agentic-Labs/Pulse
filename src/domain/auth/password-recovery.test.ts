import { describe, expect, it } from "vitest";
import { passwordResetUrl, renderPasswordRecoveryEmail } from "./password-recovery";

describe("passwordResetUrl", () => {
  it("puts the token in the fragment of /reset-password, never in the path or query", () => {
    const url = passwordResetUrl("https://pulse.example/", " Person@Example.com ", "hash-123");
    const parsed = new URL(url);
    expect(parsed.origin).toBe("https://pulse.example");
    expect(parsed.pathname).toBe("/reset-password");
    expect(parsed.search).toBe("");
    expect(parsed.hash).toBe("#email=person%40example.com&token_hash=hash-123&type=recovery");
  });
});

describe("renderPasswordRecoveryEmail", () => {
  const actionLink =
    "https://pulse.example/reset-password#email=person%40example.com&token_hash=hash-123&type=recovery";
  const content = renderPasswordRecoveryEmail({
    actionLink,
    email: "person@example.com",
    origin: "https://pulse.example/",
  });

  it("is a single call to action with nothing to type", () => {
    expect(content.subject).toBe("Reset your Pulse password");
    expect(content.html).toContain(`href="${actionLink}"`);
    expect(content.html).toContain("Set a new password");
    expect(content.text).toContain(actionLink);
    expect(content.html).not.toMatch(/recovery code|paste code|one-time code/i);
    expect(content.text).not.toMatch(/recovery code|one-time code/i);
    expect(content.html).not.toContain("supabase.co");
  });

  it("names the account, explains expiry, and reassures an unintended recipient", () => {
    expect(content.html).toContain("person@example.com");
    expect(content.text).toMatch(/expires/i);
    expect(content.text).toMatch(/did not request/i);
  });

  it("escapes the address before placing it in html", () => {
    const hostile = renderPasswordRecoveryEmail({
      actionLink,
      email: "<b>x</b>@example.com",
      origin: "https://pulse.example",
    });
    expect(hostile.html).not.toContain("<b>x</b>");
    expect(hostile.html).toContain("&lt;b&gt;x&lt;/b&gt;@example.com");
  });
});
