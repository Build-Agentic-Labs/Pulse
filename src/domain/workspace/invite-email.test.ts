import { describe, expect, it } from "vitest";
import { renderQualityModuleInviteEmail } from "./invite-email";

describe("Quality Module invitation email", () => {
  it("includes the invited email, access, and one-time password link", () => {
    const content = renderQualityModuleInviteEmail({
      actionLink: "https://project.supabase.co/auth/v1/verify?token=test",
      accessLabel: "Editor",
      email: "first.user@anacorp.com",
      origin: "https://pulse.anacorp.com",
    });

    expect(content.subject).toBe("Create your Pulse password");
    expect(content.text).toContain("first.user@anacorp.com");
    expect(content.html).toContain("first.user@anacorp.com");
    expect(content.html).toContain("Editor");
    expect(content.html).toContain("https://project.supabase.co/auth/v1/verify?token=test");
    expect(content.html).toContain("Create password and sign in");
  });
});
