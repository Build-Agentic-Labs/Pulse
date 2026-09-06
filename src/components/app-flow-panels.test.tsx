// @vitest-environment jsdom

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("@/components/theme-provider", () => ({
  useTheme: () => ({ theme: "light", toggleTheme: vi.fn() }),
}));

import { AuthFormPanel, PasswordUpdatePanel } from "./app-flow-panels";

const readClipboard = vi.fn();

beforeAll(() => {
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    value: vi.fn().mockReturnValue({ matches: true }),
  });
  Object.defineProperty(navigator, "clipboard", {
    configurable: true,
    value: { readText: readClipboard },
  });
});

describe("AuthFormPanel password recovery", () => {
  it("requests a reset link by email and never asks for a code", async () => {
    const onResetPassword = vi.fn().mockResolvedValue(true);

    render(
      <AuthFormPanel
        message=""
        isSubmitting={false}
        onSignIn={vi.fn()}
        onCreateAccount={vi.fn()}
        onResetPassword={onResetPassword}
      />,
    );

    fireEvent.change(screen.getByLabelText("Work email"), { target: { value: "person@example.com" } });
    fireEvent.click(screen.getByRole("button", { name: "Forgot password?" }));
    expect(screen.getByRole("heading", { name: "Reset password" })).toBeInTheDocument();
    expect(screen.getByText(/email you a link/i)).toBeInTheDocument();
    expect(screen.queryByLabelText("Password")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Email me a reset link" }));
    await waitFor(() => expect(onResetPassword).toHaveBeenCalledWith("person@example.com"));

    // Still on the reset step: the person may need another link, or may go back.
    expect(await screen.findByRole("button", { name: "Send another link" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Reset password" })).toBeInTheDocument();
    expect(screen.queryByLabelText(/recovery code/i)).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /paste code/i })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Back to sign in" }));
    expect(screen.getByRole("heading", { name: "Sign in" })).toBeInTheDocument();
  });

  it("shows the sent-link confirmation as information, not as an error", () => {
    render(
      <AuthFormPanel
        message="If an account exists, a reset link has been sent."
        isSubmitting={false}
        onSignIn={vi.fn()}
        onCreateAccount={vi.fn()}
        onResetPassword={vi.fn().mockResolvedValue(true)}
      />,
    );

    const notice = screen.getByRole("alert");
    expect(notice).toHaveTextContent("If an account exists, a reset link has been sent");
    expect(notice).toHaveClass("ui-auth-msg-info");
  });
});

describe("PasswordUpdatePanel invitation setup", () => {
  it("asks an invited user to create a password", () => {
    render(
      <PasswordUpdatePanel
        mode="invite"
        email="first.user@anacorp.com"
        message=""
        isSubmitting={false}
        onUpdatePassword={vi.fn()}
      />,
    );

    expect(screen.getByText("Account setup")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Create your password" })).toBeInTheDocument();
    expect(
      screen.getByText("Choose a password to finish setting up your Pulse account."),
    ).toBeInTheDocument();
    expect(screen.getByLabelText("Work email")).toHaveValue("first.user@anacorp.com");
    expect(screen.getByLabelText("Work email")).toHaveAttribute("readonly");
    expect(screen.getByRole("button", { name: "Create password" })).toBeInTheDocument();
  });
});
