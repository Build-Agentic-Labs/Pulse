// @vitest-environment jsdom

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("@/components/theme-provider", () => ({
  useTheme: () => ({ theme: "light", toggleTheme: vi.fn() }),
}));

import { AuthFormPanel } from "./app-flow-panels";

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

    readClipboard.mockResolvedValueOnce("98 76-54");
    fireEvent.click(screen.getByRole("button", { name: "Paste code" }));
    await waitFor(() => expect(screen.getByLabelText("Recovery code")).toHaveValue("987654"));

    fireEvent.change(screen.getByLabelText("Recovery code"), { target: { value: "12a34567" } });
    fireEvent.click(screen.getByRole("button", { name: "Verify code" }));

    await waitFor(() =>
      expect(onVerifyRecoveryCode).toHaveBeenCalledWith("person@example.com", "123456"),
    );
  });
});
