// @vitest-environment jsdom

import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { QualityListLoadingContent } from "./space-loading-states";

describe("QualityListLoadingContent", () => {
  it("renders the structured skeleton reserved for initial Quality entry", () => {
    const { container } = render(<QualityListLoadingContent />);

    expect(container.querySelectorAll(".ui-skeleton-line").length).toBeGreaterThan(0);
  });
});
