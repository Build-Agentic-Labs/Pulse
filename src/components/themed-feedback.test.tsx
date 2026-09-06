// @vitest-environment jsdom

import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ThemedFeedbackLayer } from "./themed-feedback";

afterEach(() => {
  vi.useRealTimers();
});

describe("ThemedFeedbackLayer auto-dismiss", () => {
  it("renders a compact lifecycle toast and dismisses it after the requested delay", () => {
    vi.useFakeTimers();
    const onDismissToast = vi.fn();

    render(
      <ThemedFeedbackLayer
        toasts={[
          {
            id: 7,
            title: "Deleted photo",
            body: "Removed from this manufacturing step.",
            autoDismissMs: 4000,
          },
        ]}
        onDismissToast={onDismissToast}
        onCancelConfirm={vi.fn()}
        onConfirm={vi.fn()}
      />,
    );

    const toast = screen.getByRole("status");
    expect(toast).toHaveClass("ui-feedback-toast", "ui-feedback-toast-auto");
    expect(toast).toHaveStyle({ "--toast-duration": "4000ms" });

    act(() => vi.advanceTimersByTime(3999));
    expect(onDismissToast).not.toHaveBeenCalled();

    act(() => vi.advanceTimersByTime(1));
    expect(onDismissToast).toHaveBeenCalledWith(7);
  });
});


describe("ThemedFeedbackLayer persistent notices", () => {
  it("keeps actionable notices until dismissed and preserves the content", () => {
    vi.useFakeTimers();
    const dismiss = vi.fn();
    render(<ThemedFeedbackLayer toasts={[{ id: 9, title: "Photo placed", body: "Placed on Step 7.", tone: "success", persistent: true }]} onDismissToast={dismiss} onCancelConfirm={vi.fn()} onConfirm={vi.fn()} />);
    expect(screen.getByText("Photo placed")).toBeVisible();
    expect(screen.getByText("Placed on Step 7.")).toBeVisible();
    act(() => vi.advanceTimersByTime(30000));
    expect(dismiss).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Dismiss notification" }));
    expect(dismiss).toHaveBeenCalledWith(9);
  });
});
