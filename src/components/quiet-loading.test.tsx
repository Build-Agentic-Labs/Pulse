// @vitest-environment jsdom

import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { QuietLoading } from "./quiet-loading";

describe("QuietLoading", () => {
  it("reserves space without rendering a visual skeleton", () => {
    const { container } = render(<QuietLoading label="Loading SOPs" />);

    expect(screen.getByRole("status", { name: "Loading SOPs" })).toBeTruthy();
    expect(container.querySelector(".ui-skeleton-line")).toBeNull();
  });

  it("is silent while its preloaded panel is inactive", () => {
    render(<QuietLoading active={false} label="Loading SOPs" />);

    expect(screen.queryByRole("status")).toBeNull();
  });
});
