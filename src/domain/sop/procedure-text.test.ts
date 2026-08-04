import { describe, expect, it } from "vitest";
import { classifyProcedureLine } from "./procedure-text";

describe("classifyProcedureLine", () => {
  // The real lines from SOP-QAS-### that motivated this feature.
  it("classifies numbered sub-headings by shape", () => {
    expect(classifyProcedureLine("4.4 Document Creation")).toEqual({
      kind: "heading",
      text: "4.4 Document Creation",
    });
    expect(classifyProcedureLine("4.11 Document Changes and Revisions")).toEqual({
      kind: "heading",
      text: "4.11 Document Changes and Revisions",
    });
    expect(classifyProcedureLine("4.1.2 Retention Schedule")).toEqual({
      kind: "heading",
      text: "4.1.2 Retention Schedule",
    });
  });

  it("classifies bullet-glyph lines and strips the glyph", () => {
    expect(classifyProcedureLine("• Use the approved corporate template.")).toEqual({
      kind: "bullet",
      text: "Use the approved corporate template.",
    });
  });

  it("accepts the hyphen an author types by hand", () => {
    expect(classifyProcedureLine("- Apply clear and unambiguous language.")).toEqual({
      kind: "bullet",
      text: "Apply clear and unambiguous language.",
    });
  });

  // Conservative by design: a missed heading renders as today; a false positive
  // would mis-bold a controlled document.
  it("keeps near-miss numbered lines as paragraphs", () => {
    // Lowercase after the number: a measurement, not a title.
    expect(classifyProcedureLine("4.5 mm tolerance applies.").kind).toBe("paragraph");
    // Terminal period: a numbered instruction sentence, not a title.
    expect(classifyProcedureLine("4.4 Insert the pin.").kind).toBe("paragraph");
    // One numeric level only: a quantity-leading sentence.
    expect(classifyProcedureLine("4 bolts secure the cover").kind).toBe("paragraph");
  });

  it("caps headings at 80 characters", () => {
    const long = `4.4 ${"Word ".repeat(20)}`.trim(); // > 80 chars
    expect(classifyProcedureLine(long).kind).toBe("paragraph");
    const exactly80 = `4.4 ${"A".repeat(76)}`; // 4 + 76 = 80
    expect(exactly80).toHaveLength(80);
    expect(classifyProcedureLine(exactly80).kind).toBe("heading");
  });

  it("treats surrounding whitespace as insignificant for detection", () => {
    expect(classifyProcedureLine("  4.4 Document Creation  ").kind).toBe("heading");
    expect(classifyProcedureLine("  • Indented bullet").kind).toBe("bullet");
  });

  it("classifies everything else as paragraph, including empty lines", () => {
    expect(classifyProcedureLine("The creator shall:")).toEqual({
      kind: "paragraph",
      text: "The creator shall:",
    });
    expect(classifyProcedureLine("")).toEqual({ kind: "paragraph", text: "" });
    expect(classifyProcedureLine("   ")).toEqual({ kind: "paragraph", text: "   " });
  });

  // A bare glyph with no content is authored noise, not a list item.
  it("keeps a lone glyph as a paragraph", () => {
    expect(classifyProcedureLine("•").kind).toBe("paragraph");
    expect(classifyProcedureLine("-").kind).toBe("paragraph");
  });
});
