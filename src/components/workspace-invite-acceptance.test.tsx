// @vitest-environment jsdom

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  refresh: vi.fn(),
  replace: vi.fn(),
  updateUser: vi.fn(),
  verifyOtp: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: mocks.refresh, replace: mocks.replace }),
}));

vi.mock("@/components/theme-provider", () => ({
  useTheme: () => ({ theme: "light", toggleTheme: vi.fn() }),
}));

vi.mock("@/lib/supabase/client", () => ({
  createSupabaseBrowserClient: () => ({
    auth: {
      updateUser: mocks.updateUser,
      verifyOtp: mocks.verifyOtp,
    },
  }),
}));

import { WorkspaceInviteAcceptancePanel } from "./workspace-invite-acceptance";

describe("workspace invite acceptance", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    Object.defineProperty(window, "matchMedia", {
      configurable: true,
      value: vi.fn().mockReturnValue({ matches: true }),
    });
    mocks.verifyOtp.mockResolvedValue({ error: null });
    mocks.updateUser.mockResolvedValue({ error: null });
    window.history.replaceState(
      null,
      "",
      "/invite#email=first.user%40anacorp.com&token_hash=hashed-token&type=invite",
    );
  });

  afterEach(() => {
    window.history.replaceState(null, "", "/");
    window.sessionStorage.clear();
  });

  it("waits for password submission before verifying the one-time token", async () => {
    render(<WorkspaceInviteAcceptancePanel />);

    expect(await screen.findByRole("heading", { name: "Create your password" })).toBeInTheDocument();
    expect(screen.getByDisplayValue("first.user@anacorp.com")).toHaveAttribute("readonly");
    expect(mocks.verifyOtp).not.toHaveBeenCalled();

    fireEvent.change(screen.getByLabelText("New password"), { target: { value: "strong-passphrase" } });
    fireEvent.change(screen.getByLabelText("Confirm password"), { target: { value: "strong-passphrase" } });
    fireEvent.click(screen.getByRole("button", { name: "Create password" }));

    await waitFor(() => {
      expect(mocks.verifyOtp).toHaveBeenCalledWith({ token_hash: "hashed-token", type: "invite" });
      expect(mocks.updateUser).toHaveBeenCalledWith({ password: "strong-passphrase" });
      expect(mocks.replace).toHaveBeenCalledWith("/");
    });
  });
});
