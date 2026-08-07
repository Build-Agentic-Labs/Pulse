import { describe, expect, it } from "vitest";
import { renderPasswordRecoveryEmail } from "./password-recovery";

describe("renderPasswordRecoveryEmail", () => {
  it("renders the OTP in the message body without creating a credential-bearing link", () => {
    const content = renderPasswordRecoveryEmail({
      code: "123456",
      origin: "https://pulse.agenticlabs.studio/",
    });

    expect(content.subject).toBe("Reset your Pulse password");
    expect(content.text).toContain("123456");
    expect(content.html).toContain("123456");
    expect(content.html).toContain("user-select:all");
    expect(content.html).toContain("Paste code in Pulse");
    expect(content.html).toContain('href="https://pulse.agenticlabs.studio"');
    expect(content.html).not.toMatch(/token|otp|code=|supabase\.co/i);
  });

  it("escapes code text before placing it in html", () => {
    const content = renderPasswordRecoveryEmail({ code: "<123&>", origin: "https://pulse.example" });

    expect(content.html).toContain("&lt;123&amp;&gt;");
    expect(content.html).not.toContain("<123&>");
  });
});
