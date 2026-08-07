import { describe, expect, it } from "vitest";
import {
  qualityModuleAccessForRole,
  qualityModuleAccessLabel,
  qualityModuleInviteRedirect,
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
});
