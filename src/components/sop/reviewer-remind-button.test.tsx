// @vitest-environment jsdom

import { act, fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ReminderCooldownError, remindSopReviewer } from "@/lib/sop/review";
import { ReviewerRemindButton } from "./reviewer-remind-button";

vi.mock("@/lib/sop/review", () => {
  class ReminderCooldownError extends Error {
    constructor(readonly nextAllowedAt: string | null) {
      super("You already reminded this reviewer. You can remind them again later.");
    }
  }
  return { ReminderCooldownError, remindSopReviewer: vi.fn() };
});

const NEXT = "2099-01-02T10:00:00.000Z";

function renderButton(nextAllowedAt: string | null = null, onReminded = vi.fn()) {
  render(
    <ReviewerRemindButton
      sopId="sop-1"
      reviewerId="rev-1"
      reviewerName="Rae Reviewer"
      nextAllowedAt={nextAllowedAt}
      onReminded={onReminded}
    />,
  );
  return onReminded;
}

const button = () => screen.getByRole("button");

beforeEach(() => {
  vi.mocked(remindSopReviewer).mockReset();
});

describe("ReviewerRemindButton", () => {
  it("sends once however fast it is clicked, then reports the next window", async () => {
    let resolve!: (value: string) => void;
    vi.mocked(remindSopReviewer).mockReturnValue(new Promise<string>((r) => (resolve = r)));
    const onReminded = renderButton();

    fireEvent.click(button());
    fireEvent.click(button());
    fireEvent.click(button());
    expect(remindSopReviewer).toHaveBeenCalledTimes(1);
    expect(remindSopReviewer).toHaveBeenCalledWith("sop-1", "rev-1");
    expect(button()).toBeDisabled();
    expect(button().textContent).toContain("Sending");

    await act(async () => resolve(NEXT));
    expect(onReminded).toHaveBeenCalledWith(NEXT);
  });

  it("stays disabled as Reminded while the cooldown window is open", () => {
    renderButton(NEXT);
    expect(button()).toBeDisabled();
    expect(button().textContent).toContain("Reminded");
    fireEvent.click(button());
    expect(remindSopReviewer).not.toHaveBeenCalled();
  });

  it("is available again once the window has passed", () => {
    renderButton("2000-01-01T00:00:00.000Z");
    expect(button()).not.toBeDisabled();
    expect(button().textContent).toContain("Remind");
  });

  it("adopts the database's window when another tab already reminded", async () => {
    vi.mocked(remindSopReviewer).mockRejectedValue(new ReminderCooldownError(NEXT));
    const onReminded = renderButton();
    await act(async () => fireEvent.click(button()));
    expect(onReminded).toHaveBeenCalledWith(NEXT);
  });

  it("shows the database's refusal and lets the author try again", async () => {
    vi.mocked(remindSopReviewer).mockRejectedValue(new Error("This reviewer has already returned their review"));
    renderButton();
    await act(async () => fireEvent.click(button()));
    expect(screen.getByText("This reviewer has already returned their review")).toBeTruthy();
    expect(button()).not.toBeDisabled();
  });
});
