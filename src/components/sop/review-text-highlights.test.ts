// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { reviewQuotes, reviewTextRange } from "./review-text-highlights";

describe("review text highlights", () => {
  it("extracts each saved quote without highlighting the comment prose", () => {
    expect(reviewQuotes('Selected text: “technical functions”\nChange the title.\n\nSelected text: “Purpose”\nClarify.')).toEqual(["technical functions", "Purpose"]);
    expect(reviewQuotes("Old section comment")).toEqual([]);
  });
  it("highlights only the selected words across nested text nodes", () => {
    const root = document.createElement("div");
    root.innerHTML = '<section data-review-category="responsible">director of <b>technical</b> functions</section>';
    expect(reviewTextRange(root, "responsible", "technical functions")?.toString()).toBe("technical functions");
    expect(reviewTextRange(root, "purpose", "technical functions")).toBeNull();
  });
  it("does not guess when text has changed or occurs multiple times", () => {
    const root = document.createElement("div");
    root.innerHTML = '<section data-review-category="purpose">review review</section>';
    expect(reviewTextRange(root, "purpose", "review")).toBeNull();
    expect(reviewTextRange(root, "purpose", "missing")).toBeNull();
  });
});
