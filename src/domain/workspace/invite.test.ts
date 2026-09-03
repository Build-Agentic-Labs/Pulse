import { describe, expect, it } from "vitest";
import {
  inviteeHasCompletedSetup,
  isAlreadyRegisteredAuthError,
  parseWorkspaceInviteAcceptanceHash,
  qualityModuleAccessForRole,
  qualityModuleAccessLabel,
  qualityModuleInviteRedirect,
  workspaceInviteAcceptanceUrl,
} from "./invite";

describe("Quality Module invitations", () => {
  it("maps the selected access type to the pending Quality permission", () => {
    expect(qualityModuleAccessForRole("viewer")).toBe("view");
    expect(qualityModuleAccessForRole("editor")).toBe("edit");
    expect(qualityModuleAccessForRole("admin")).toBe("edit");
    expect(qualityModuleAccessForRole("owner")).toBe("edit");
  });

  it("uses the access type labels shown in the invitation UI", () => {
    expect(qualityModuleAccessLabel("view")).toBe("Viewer");
    expect(qualityModuleAccessLabel("edit")).toBe("Editor");
    expect(qualityModuleAccessLabel("none")).toBe("No access");
  });

  it("returns invited users to the password-creation flow", () => {
    expect(qualityModuleInviteRedirect("https://pulse.example.com/api/invites")).toBe(
      "https://pulse.example.com/?invite=1",
    );
  });

  it("uses the public Pulse URL when an invite is sent from local support", () => {
    expect(
      qualityModuleInviteRedirect(
        "http://localhost:3000/api/invites",
        "https://pulse.anacorp.com/settings",
      ),
    ).toBe("https://pulse.anacorp.com/?invite=1");
  });

  it("builds a scanner-safe Pulse link without putting the credential in the request URL", () => {
    const url = workspaceInviteAcceptanceUrl(
      "https://pulse.anacorp.com/?invite=1",
      " First.User@anacorp.com ",
      "hashed-token",
    );

    expect(url).toBe(
      "https://pulse.anacorp.com/invite#email=first.user%40anacorp.com&token_hash=hashed-token&type=invite",
    );
    expect(new URL(url).search).toBe("");
  });

  it("parses invite and recovery credentials from the fragment", () => {
    expect(
      parseWorkspaceInviteAcceptanceHash(
        "#email=first.user%40anacorp.com&token_hash=hashed-token&type=invite",
      ),
    ).toEqual({ email: "first.user@anacorp.com", tokenHash: "hashed-token", type: "invite" });
    expect(
      parseWorkspaceInviteAcceptanceHash(
        "#email=first.user%40anacorp.com&token_hash=recovery-token&type=recovery",
      ),
    ).toEqual({ email: "first.user@anacorp.com", tokenHash: "recovery-token", type: "recovery" });
    expect(parseWorkspaceInviteAcceptanceHash("#type=invite")).toBeNull();
  });
});

describe("resend detection", () => {
  it("recognises GoTrue's already-registered rejection by code or message", () => {
    expect(isAlreadyRegisteredAuthError({ code: "email_exists", message: "" })).toBe(true);
    expect(
      isAlreadyRegisteredAuthError({ message: "A user with this email address has already been registered" }),
    ).toBe(true);
    expect(isAlreadyRegisteredAuthError({ message: "User has already been invited" })).toBe(true);
    expect(isAlreadyRegisteredAuthError({ message: "Database error" })).toBe(false);
    expect(isAlreadyRegisteredAuthError(null)).toBe(false);
  });

  it("treats an invitee as set up only once they have signed in", () => {
    expect(inviteeHasCompletedSetup({ last_sign_in_at: null })).toBe(false);
    expect(inviteeHasCompletedSetup(undefined)).toBe(false);
    expect(inviteeHasCompletedSetup({ last_sign_in_at: "2026-08-02T00:00:00Z" })).toBe(true);
  });
});
