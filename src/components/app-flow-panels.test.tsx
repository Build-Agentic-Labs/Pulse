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
  it("moves from email request to six-digit code verification", async () => {
    const onResetPassword = vi.fn().mockResolvedValue(true);
    const onVerifyRecoveryCode = vi.fn().mockResolvedValue(true);

    render(
      <AuthFormPanel
        message=""
        isSubmitting={false}
        onSignIn={vi.fn()}
        onCreateAccount={vi.fn()}
        onResetPassword={onResetPassword}
        onVerifyRecoveryCode={onVerifyRecoveryCode}
      />,
    );

    fireEvent.change(screen.getByLabelText("Work email"), { target: { value: "person@example.com" } });
    fireEvent.click(screen.getByRole("button", { name: "Forgot password?" }));
    expect(screen.getByRole("heading", { name: "Reset password" })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Send recovery code" }));
    await waitFor(() => expect(onResetPassword).toHaveBeenCalledWith("person@example.com"));
    expect(await screen.findByRole("heading", { name: "Enter recovery code" })).toBeInTheDocument();
    expect(screen.getByLabelText("Work email")).toBeDisabled();

    readClipboard.mockResolvedValueOnce("98 76-54 32");
    fireEvent.click(screen.getByRole("button", { name: "Paste code" }));
    await waitFor(() => expect(screen.getByLabelText("Recovery code")).toHaveValue("98765432"));

    fireEvent.change(screen.getByLabelText("Recovery code"), { target: { value: "12a3456789" } });
    fireEvent.click(screen.getByRole("button", { name: "Verify code" }));

    await waitFor(() =>
      expect(onVerifyRecoveryCode).toHaveBeenCalledWith("person@example.com", "12345678"),
    );
  });

  it("opens an emailed recovery link directly on the code-entry step", async () => {
    window.history.replaceState(null, "", "/#auth=recovery&email=person%40example.com");

    render(
      <AuthFormPanel
        message=""
        isSubmitting={false}
        onSignIn={vi.fn()}
        onCreateAccount={vi.fn()}
        onResetPassword={vi.fn().mockResolvedValue(true)}
        onVerifyRecoveryCode={vi.fn().mockResolvedValue(true)}
      />,
    );

    expect(await screen.findByRole("heading", { name: "Enter recovery code" })).toBeInTheDocument();
    expect(screen.getByLabelText("Work email")).toHaveValue("person@example.com");
    expect(screen.getByLabelText("Work email")).toBeDisabled();
    expect(screen.getByLabelText("Recovery code")).toHaveAttribute("maxlength", "8");
    expect(window.location.hash).toBe("");
  });
});

describe("PasswordUpdatePanel invitation setup", () => {
  it("asks an invited user to create a password", () => {
    render(
      <PasswordUpdatePanel
        mode="invite"
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
    expect(screen.getByRole("button", { name: "Create password" })).toBeInTheDocument();
  });
});
