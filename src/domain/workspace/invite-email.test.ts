import { describe, expect, it } from "vitest";
import { renderWorkspaceInviteEmail } from "./invite-email";

describe("workspace invitation email", () => {
  it("includes the invited email, access summary, and one-time password link", () => {
    const content = renderWorkspaceInviteEmail({
      actionLink: "https://pulse.anacorp.com/invite#token_hash=test&type=invite",
      accessSummary: ["Organization: Member", "Quality Module: Edit", "Planning: No access"],
      email: "first.user@anacorp.com",
      organizationName: "ANA Corp",
      origin: "https://pulse.anacorp.com",
    });

    expect(content.subject).toBe("Create your Pulse password");
    expect(content.text).toContain("first.user@anacorp.com");
    expect(content.html).toContain("first.user@anacorp.com");
    expect(content.html).toContain("Quality Module: Edit");
    expect(content.html).toContain("ANA Corp");
    expect(content.html).toContain("https://pulse.anacorp.com/invite#token_hash=test&type=invite");
    expect(content.html).toContain("Create password and sign in");
    expect(content.text).toContain("setup link expires in 24 hours");
  });
});
