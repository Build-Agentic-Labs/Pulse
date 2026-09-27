// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { SopReviewLoading } from "./sop-review-loading";
afterEach(cleanup);
it("keeps loading in the document area and permits immediate return to the queue", () => {
  const close = vi.fn();
  const {container} = render(<SopReviewLoading label="Review document" onClose={close} />);
  expect(screen.getByRole("status", { name: "Opening document" })).toBeInTheDocument();
  expect(container.firstElementChild).not.toHaveClass("fixed", "bg-black/60");
  fireEvent.click(screen.getByRole("button",{name:"Back to review queue"}));
  expect(close).toHaveBeenCalledOnce();
});
it("shows a recoverable error without a screen-covering backdrop", () => {
  render(<SopReviewLoading label="Final approval" error="Could not load" onClose={vi.fn()} />);
  expect(screen.getByRole("alert")).toHaveTextContent("Could not load");
  expect(screen.queryByRole("status")).not.toBeInTheDocument();
  expect(screen.getByRole("button",{name:"Back to review queue"})).toBeEnabled();
});
