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
    auth: { updateUser: mocks.updateUser, verifyOtp: mocks.verifyOtp },
  }),
}));

vi.mock("@/domain/supabase-planner", () => ({
  getUserFromSession: mocks.getUserFromSession,
}));

import { PasswordResetPanel } from "./credential-link-panel";

function submitPassword(password = "strong-passphrase") {
  fireEvent.change(screen.getByLabelText("New password"), { target: { value: password } });
  fireEvent.change(screen.getByLabelText("Confirm password"), { target: { value: password } });
  fireEvent.click(screen.getByRole("button", { name: "Update password" }));
}

describe("PasswordResetPanel", () => {
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
      "/reset-password#email=person%40example.com&token_hash=hashed-token&type=recovery",
    );
  });

  afterEach(() => {
    window.history.replaceState(null, "", "/");
    window.sessionStorage.clear();
  });

  it("verifies the fragment token only when the new password is submitted", async () => {
    render(<PasswordResetPanel />);

    expect(await screen.findByRole("heading", { name: "Set a new password" })).toBeInTheDocument();
    expect(mocks.verifyOtp).not.toHaveBeenCalled();
    expect(screen.queryByLabelText(/recovery code/i)).not.toBeInTheDocument();

    submitPassword();

    await waitFor(() => {
      expect(mocks.verifyOtp).toHaveBeenCalledWith({ token_hash: "hashed-token", type: "recovery" });
      expect(mocks.updateUser).toHaveBeenCalledWith({ password: "strong-passphrase" });
      expect(mocks.replace).toHaveBeenCalledWith("/");
    });
  });

  it("refuses an invitation-typed link on the reset page", async () => {
    window.history.replaceState(null, "", "/reset-password#email=person%40example.com&token_hash=h&type=invite");

    render(<PasswordResetPanel />);

    expect(await screen.findByRole("heading", { name: "Reset link unavailable" })).toBeInTheDocument();
    expect(screen.getByText(/not a password reset link/i)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Go to sign in" }));
    expect(mocks.replace).toHaveBeenCalledWith("/");
  });

  it("explains an incomplete link and offers the way back", async () => {
    window.history.replaceState(null, "", "/reset-password");

    render(<PasswordResetPanel />);

    expect(await screen.findByRole("heading", { name: "Reset link unavailable" })).toBeInTheDocument();
    expect(screen.getByText(/request a new one from Forgot password/i)).toBeInTheDocument();
  });

  it("points an expired or consumed link back at Forgot password", async () => {
    mocks.verifyOtp.mockResolvedValue({ error: new Error("Token has expired or is invalid") });

    render(<PasswordResetPanel />);
    await screen.findByRole("heading", { name: "Set a new password" });
    submitPassword();

    expect(await screen.findByText(/expired or was already used.*Forgot password/i)).toBeInTheDocument();
    expect(mocks.updateUser).not.toHaveBeenCalled();
  });

  it("finishes with the live session when the same person reloads after verifying", async () => {
    mocks.getUserFromSession.mockResolvedValue({ data: { user: { email: "Person@Example.com" } }, error: null });

    render(<PasswordResetPanel />);
    await screen.findByRole("heading", { name: "Set a new password" });
    submitPassword();

    await waitFor(() => expect(mocks.updateUser).toHaveBeenCalledWith({ password: "strong-passphrase" }));
    expect(mocks.verifyOtp).not.toHaveBeenCalled();
  });
});
