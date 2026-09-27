// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import { QualitySkeleton } from "./quality-skeleton";
afterEach(cleanup);
it.each(["list", "form", "dashboard", "document"] as const)("announces %s loading once and keeps decorative placeholders out of accessibility", variant => {
  const { container } = render(<QualitySkeleton variant={variant} label="Loading Quality" />);
  expect(screen.getByRole("status", { name: "Loading Quality" })).toHaveAttribute("aria-busy", "true");
  expect(container.querySelector('.quality-skeleton')).toHaveAttribute("aria-hidden", "true");
  expect(container.querySelectorAll('.ui-skeleton-line').length).toBeGreaterThan(0);
});
it("does not animate or announce a hidden panel", () => {
  const { container } = render(<QualitySkeleton active={false} />);
  expect(screen.queryByRole("status")).toBeNull();
  expect(container.querySelector('.quality-skeleton')).toBeNull();
});
it("keeps document placeholders on the continuous surface across loading stages", () => {
  const { container, rerender } = render(<QualitySkeleton variant="document" label="Opening document" />);
  expect(container.querySelector('.quality-skeleton-document')).toBeInTheDocument();
  rerender(<QualitySkeleton variant="document" label="Preparing document" />);
  expect(container.querySelector('.quality-skeleton-document')).toBeInTheDocument();
});
