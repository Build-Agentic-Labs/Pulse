import { describe, expect, it } from "vitest";
import { renderPasswordRecoveryEmail } from "./password-recovery";

describe("renderPasswordRecoveryEmail", () => {
  it("renders the OTP in the message body without creating a credential-bearing link", () => {
    const content = renderPasswordRecoveryEmail({
      code: "12345678",
      email: "person@example.com",
      origin: "https://pulse.agenticlabs.studio/",
    });

    expect(content.subject).toBe("Reset your Pulse password");
    expect(content.text).toContain("12345678");
    expect(content.html).toContain("12345678");
    expect(content.html).toContain("user-select:all");
    expect(content.html).toContain("Paste code in Pulse");
    expect(content.html).toContain(
      'href="https://pulse.agenticlabs.studio/#auth=recovery&email=person%40example.com"',
    );
    expect(content.html).not.toMatch(/token|otp|code=|supabase\.co/i);
  });

  it("escapes code text before placing it in html", () => {
    const content = renderPasswordRecoveryEmail({
      code: "<123&>",
      email: "person@example.com",
      origin: "https://pulse.example",
    });

    expect(content.html).toContain("&lt;123&amp;&gt;");
    expect(content.html).not.toContain("<123&>");
  });
});
