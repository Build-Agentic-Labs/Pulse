// @vitest-environment jsdom

import { describe, expect, it, vi } from "vitest";
import { clearSopSearchMatch, revealSopSearchMatch } from "./sop-search-match";

describe("revealSopSearchMatch", () => {
  it("highlights the result without moving focus out of the search field", () => {
    const searchInput = document.createElement("input");
    const editor = document.createElement("div");
    const match = document.createElement("input");
    searchInput.value = "alpha";
    match.value = "Alpha review";
    editor.append(match);
    document.body.append(searchInput, editor);
    searchInput.focus();
    vi.spyOn(match, "getBoundingClientRect").mockReturnValue({
      x: 100,
      y: 50,
      left: 100,
      top: 50,
      right: 400,
      bottom: 86,
      width: 300,
      height: 36,
      toJSON: () => ({}),
    });
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({
      font: "",
      measureText: (text: string) => ({
        width: text.length * 7,
        actualBoundingBoxAscent: 8,
        actualBoundingBoxDescent: 2,
      }),
    } as unknown as CanvasRenderingContext2D);

    const revealed = revealSopSearchMatch({
      root: editor,
      result: {
        id: "purpose",
        stepId: "overview",
        section: "Overview",
        label: "Purpose",
        value: "Alpha review",
      },
      query: "alpha",
      resultIndexInStep: 0,
    });

    expect(revealed?.target).toBe(match);
    expect(searchInput).toHaveFocus();
    expect(match).not.toHaveAttribute("data-sop-search-match");
    expect(revealed?.overlay).toHaveAttribute("data-sop-search-match", "true");
    expect(Number.parseFloat(revealed?.overlay.style.left ?? "0")).toBeGreaterThanOrEqual(99);
    expect(Number.parseFloat(revealed?.overlay.style.width ?? "0")).toBeGreaterThan(0);

    clearSopSearchMatch(revealed);
    expect(document.querySelector("[data-sop-search-match]")).toBeNull();
  });
});
