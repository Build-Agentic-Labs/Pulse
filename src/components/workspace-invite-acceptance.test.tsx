// @vitest-environment jsdom

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  refresh: vi.fn(),
  replace: vi.fn(),
  updateUser: vi.fn(),
  verifyOtp: vi.fn(),
  getUserFromSession: vi.fn(),
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

vi.mock("@/domain/supabase-planner", () => ({
  getUserFromSession: mocks.getUserFromSession,
}));

import { WorkspaceInviteAcceptancePanel } from "./workspace-invite-acceptance";

function submitPassword(password = "strong-passphrase") {
  fireEvent.change(screen.getByLabelText("New password"), { target: { value: password } });
  fireEvent.change(screen.getByLabelText("Confirm password"), { target: { value: password } });
  fireEvent.click(screen.getByRole("button", { name: "Create password" }));
}

describe("workspace invite acceptance", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    Object.defineProperty(window, "matchMedia", {
      configurable: true,
      value: vi.fn().mockReturnValue({ matches: true }),
    });
    mocks.verifyOtp.mockResolvedValue({ error: null });
    mocks.updateUser.mockResolvedValue({ error: null });
    mocks.getUserFromSession.mockResolvedValue({ data: { user: null }, error: null });
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

    submitPassword();

    await waitFor(() => {
      expect(mocks.verifyOtp).toHaveBeenCalledWith({ token_hash: "hashed-token", type: "invite" });
      expect(mocks.updateUser).toHaveBeenCalledWith({ password: "strong-passphrase" });
      expect(mocks.replace).toHaveBeenCalledWith("/");
    });
  });

  it("skips token verification when the invitee already has a live session", async () => {
    // Reload after a verified-but-unfinished attempt: the one-time token is
    // consumed, but the session it minted can still finish the password setup.
    mocks.getUserFromSession.mockResolvedValue({
      data: { user: { email: "First.User@anacorp.com" } },
      error: null,
    });

    render(<WorkspaceInviteAcceptancePanel />);
    await screen.findByRole("heading", { name: "Create your password" });
    submitPassword();

    await waitFor(() => {
      expect(mocks.updateUser).toHaveBeenCalledWith({ password: "strong-passphrase" });
      expect(mocks.replace).toHaveBeenCalledWith("/");
    });
    expect(mocks.verifyOtp).not.toHaveBeenCalled();
  });

  it("still verifies the token when a different user is signed in", async () => {
    // An admin opening the invite link must never have their own password
    // replaced — the token flow signs the invitee in first.
    mocks.getUserFromSession.mockResolvedValue({
      data: { user: { email: "admin@anacorp.com" } },
      error: null,
    });

    render(<WorkspaceInviteAcceptancePanel />);
    await screen.findByRole("heading", { name: "Create your password" });
    submitPassword();

    await waitFor(() => {
      expect(mocks.verifyOtp).toHaveBeenCalledWith({ token_hash: "hashed-token", type: "invite" });
      expect(mocks.updateUser).toHaveBeenCalledWith({ password: "strong-passphrase" });
    });
  });

  it("points an expired or consumed link at the forgot-password path", async () => {
    mocks.verifyOtp.mockResolvedValue({ error: new Error("Token has expired or is invalid") });

    render(<WorkspaceInviteAcceptancePanel />);
    await screen.findByRole("heading", { name: "Create your password" });
    submitPassword();

    expect(
      await screen.findByText(/already set a password.*Forgot password/i),
    ).toBeInTheDocument();
    expect(mocks.updateUser).not.toHaveBeenCalled();
  });
});
