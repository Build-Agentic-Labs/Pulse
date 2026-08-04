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
  it("ignores dropped separator punctuation when a run-on list becomes bullets", () => {
    const before = "items, including:  Policies;  Quality manuals";
    const after = "items, including:\n• Policies\n• Quality manuals";
    // ";" is punctuation, not a letter/digit, so the projection is identical.
    // This is intentional: separators ARE the thing being restructured.
    expect(restructurePreservesWording(before, after)).toBe(true);
  });

  // Case is content. Restructuring moves text; it never re-cases it.
  it("rejects a case-only change", () => {
    expect(restructurePreservesWording("Use the Template.", "Use the template.")).toBe(false);
  });

  // NFC normalization closes both normalization-form holes at once: a genuinely
  // dropped diacritic is caught (the letters differ after normalization), and
  // identical text that merely arrives in a different encoding form is not a
  // false positive.
  it("rejects a dropped diacritic even in decomposed form", () => {
    const decomposed = "Führung"; // escape: u + combining diaeresis (NFD) — raw glyphs get silently NFC-normalized by editors and model transcription, so escapes are the only reliable carrier
    expect(restructurePreservesWording(decomposed, "Fuhrung")).toBe(false);
  });

  it("accepts identical text in different Unicode normalization forms", () => {
    const nfc = "Führung"; // escape: precomposed u-umlaut (NFC)
    const nfd = "Führung"; // escape: u + combining diaeresis (NFD)
    expect(restructurePreservesWording(nfc, nfd)).toBe(true);
  });
});
