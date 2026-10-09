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

describe("ThemedFeedbackLayer modal contract", () => {
  it.each(["center", "anchor"] as const)("opens %s confirmations as a modal and restores the opener", (placement) => {
    const show = vi.fn(function (this: HTMLDialogElement) { this.open = true; });
    Object.defineProperty(HTMLDialogElement.prototype, "showModal", { configurable: true, value: show });
    const close = vi.fn(function (this: HTMLDialogElement) { this.open = false; });
    Object.defineProperty(HTMLDialogElement.prototype, "close", { configurable: true, value: close });
    const opener = document.createElement("button");
    document.body.append(opener);
    opener.focus();
    const cancel = vi.fn();
    const accept = vi.fn();
    const result = render(<ThemedFeedbackLayer confirm={{ title: "Remove item?", tone: "danger", placement, anchorRect: { top: 10, bottom: 30, left: 10, right: 90, width: 80, height: 20 }, onConfirm: accept }} toasts={[]} onDismissToast={vi.fn()} onCancelConfirm={cancel} onConfirm={accept} />);
    expect(show).toHaveBeenCalledOnce();
    const dialog = screen.getByRole("dialog", { name: "Remove item?" });
    expect(screen.getByRole("button", { name: /^Cancel$/ })).toHaveFocus();
    expect(screen.queryByText("Blocked")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    expect(accept).toHaveBeenCalledOnce();
    const event = new Event("cancel", { cancelable: true });
    fireEvent(dialog, event);
    expect(event.defaultPrevented).toBe(true);
    expect(cancel).toHaveBeenCalledOnce();
    result.unmount();
    expect(close).toHaveBeenCalledOnce();
    expect(opener).toHaveFocus();
    opener.remove();
  });
});
