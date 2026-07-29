// @vitest-environment jsdom

import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { BuilderLoadingSidebar } from "./sop-detail-loading-state";

function navItem(label: string): HTMLElement {
  const item = screen.getByText(label).closest(".ui-nav-item");
  if (!(item instanceof HTMLElement)) throw new Error(`Missing ${label} loading nav item`);
  return item;
}

describe("BuilderLoadingSidebar", () => {
  it("shows completed builder checks on the first Draft Review frame", () => {
    render(<BuilderLoadingSidebar initialView="draft-review" />);

    for (const label of ["Document", "Overview", "Procedure", "Annexes & history", "Approvals"]) {
      expect(navItem(label).querySelector("svg.lucide-check")).not.toBeNull();
    }
    expect(navItem("Draft Review")).toHaveClass("ui-nav-item-active");
    expect(
      navItem("Final Approval").querySelector('[data-sop-step-icon="pending"]'),
    ).not.toBeNull();
    expect(navItem("Final Approval")).not.toHaveTextContent("7");
  });

  it("shows completed prior review stages for later workflow views", () => {
    const { rerender } = render(<BuilderLoadingSidebar initialView="final-approval" />);
    expect(navItem("Draft Review").querySelector("svg.lucide-check")).not.toBeNull();
    expect(navItem("Final Approval")).toHaveClass("ui-nav-item-active");

    rerender(<BuilderLoadingSidebar initialView="quality-approval" />);
    expect(navItem("Draft Review").querySelector("svg.lucide-check")).not.toBeNull();
    expect(navItem("Final Approval").querySelector("svg.lucide-check")).not.toBeNull();
    expect(navItem("Quality Approval")).toHaveClass("ui-nav-item-active");
  });
});
