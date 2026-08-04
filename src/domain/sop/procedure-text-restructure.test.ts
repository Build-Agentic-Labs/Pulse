import { describe, expect, it } from "vitest";
import { restructurePreservesWording } from "./procedure-text-restructure";

describe("restructurePreservesWording", () => {
  it("accepts pure whitespace restructuring", () => {
    const before = "Step one happens. Step two follows.";
    const after = "Step one happens.\n\nStep two follows.";
    expect(restructurePreservesWording(before, after)).toBe(true);
  });

  it("accepts added bullet glyphs", () => {
    const before = "The creator shall: Use the template. Apply clear language.";
    const after = "The creator shall:\n• Use the template.\n• Apply clear language.";
    expect(restructurePreservesWording(before, after)).toBe(true);
  });

  it("rejects any wording change", () => {
    const before = "Use the approved corporate template.";
    const after = "Use the approved company template.";
    expect(restructurePreservesWording(before, after)).toBe(false);
  });

  it("rejects dropped content", () => {
    const before = "First sentence. Second sentence.";
    const after = "First sentence.";
    expect(restructurePreservesWording(before, after)).toBe(false);
  });

  it("rejects reordered content", () => {
    const before = "Alpha then beta.";
    const after = "Beta then alpha.";
    expect(restructurePreservesWording(before, after)).toBe(false);
  });

  // Restructuring may normalize punctuation spacing but never letters/digits.
  it("ignores punctuation and case only where whitespace collapse implies it", () => {
    const before = "items, including:  Policies;  Quality manuals";
    const after = "items, including:\n• Policies\n• Quality manuals";
    // Semicolons dropped when converting a run-on list to bullets is a wording
    // change by the letters-only projection? No — ";" is punctuation, not a
    // letter/digit, so the projection is identical. This is intentional:
    // separators ARE the thing being restructured.
    expect(restructurePreservesWording(before, after)).toBe(true);
  });
});
