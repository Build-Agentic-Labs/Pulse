// @vitest-environment jsdom

import { act, render, screen } from "@testing-library/react";
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
