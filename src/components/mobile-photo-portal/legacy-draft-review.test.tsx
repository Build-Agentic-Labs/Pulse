import { fireEvent, render, screen } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { LegacyDraftReview } from "./legacy-draft-review";
const draft = { key: "legacy", taskId: "t", stepId: "s", name: "Old step", instruction: "<script>unsafe text</script>", durationText: "5", tools: [], photos: [], checks: [], updatedAt: "2026-10-04T00:00:00Z" };

it("reviewing and going back do not invoke adoption", () => {
  const onUse = vi.fn(); const onBack = vi.fn();
  const { container } = render(<LegacyDraftReview draft={draft} reviewing onReview={vi.fn()} onDismiss={vi.fn()} onBack={onBack} onUse={onUse} />);
  expect(onUse).not.toHaveBeenCalled();
  expect(container.querySelector("script")).toBeNull();
  expect(screen.getByText(draft.instruction)).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Back" }));
  expect(onBack).toHaveBeenCalledOnce(); expect(onUse).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Use this draft" }));
  expect(onUse).toHaveBeenCalledOnce();
});

it("an existing owned draft disables adoption while allowing return", () => {
  const onUse = vi.fn();
  render(<LegacyDraftReview draft={draft} reviewing blocked onReview={vi.fn()} onDismiss={vi.fn()} onBack={vi.fn()} onUse={onUse} />);
  expect(screen.getByRole("button", { name: "Use this draft" })).toBeDisabled();
  fireEvent.click(screen.getByRole("button", { name: "Use this draft" }));
  expect(onUse).not.toHaveBeenCalled();
  expect(screen.getByRole("button", { name: "Back" })).toBeEnabled();
});
