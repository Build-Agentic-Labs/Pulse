import { expect, it } from "vitest";
import { wrapWiPdfText } from "./pdf-layout";

it("wraps measured text and preserves all words, blank lines and Unicode", () => {
  const text = "Check the record\n\n• Confirm café ✓";
  const lines = wrapWiPdfText(text, 10, value => value.length);
  expect(lines).toContain("");
  expect(lines.join(" ").replace(/\s+/g, " ")).toBe(text.replace(/\s+/g, " "));
  expect(lines.every(line => line.length <= 10)).toBe(true);
});

it("splits oversized unbroken tokens without dropping characters", () => {
  const text = "abc".repeat(30);
  const lines = wrapWiPdfText(text, 12, value => value.length);
  expect(lines.join("")).toBe(text);
  expect(lines.every(line => line.length <= 12)).toBe(true);
});
