// @vitest-environment jsdom

import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { SopStepNavIcon } from "./sop-step-nav-icon";

describe("SopStepNavIcon", () => {
  it("prioritizes a visible error state over active or complete states", () => {
    const { container } = render(
      <SopStepNavIcon active complete issueCount={2} number={3} />,
    );

    expect(screen.getByRole("img", { name: "2 issues in this step" })).toBeInTheDocument();
    expect(container.querySelector('[data-sop-step-icon="error"]')).not.toBeNull();
    expect(container.querySelector("svg.lucide-triangle-alert")).not.toBeNull();
    expect(container.querySelector("svg.lucide-check")).toBeNull();
  });

  it("keeps the normal active state when the step has no issues", () => {
    const { container } = render(<SopStepNavIcon active issueCount={0} number={3} />);

    expect(container.querySelector('[data-sop-step-icon="active"]')).not.toBeNull();
    expect(screen.queryByRole("img")).not.toBeInTheDocument();
  });
});
