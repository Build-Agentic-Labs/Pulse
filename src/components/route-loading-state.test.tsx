import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { RouteLoadingState } from "./route-loading-state";

// Smoke test proving the jsdom + Testing Library project works. First component
// test in the repo — the component-testing toolchain itself is what's under test.

describe("RouteLoadingState", () => {
  it("renders the default label as a polite status region", () => {
    render(<RouteLoadingState />);

    const status = screen.getByRole("status");
    expect(status).toHaveTextContent("Loading workspace");
    expect(status).toHaveAttribute("aria-live", "polite");
  });

  it("renders a custom label", () => {
    render(<RouteLoadingState label="Loading planner" />);

    expect(screen.getByRole("status")).toHaveTextContent("Loading planner");
  });
});
