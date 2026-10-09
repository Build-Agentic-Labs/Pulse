import { expect, it } from "vitest";
import { fillWiPhotoRows, wrapWiPdfText } from "./pdf-layout";

it("uses remaining page space for photos while keeping text-only steps compact", () => {
  expect(fillWiPhotoRows([
    { height: 80, hasPhoto: false },
    { height: 100, hasPhoto: false },
    { height: 220, hasPhoto: true },
  ], 700)).toEqual([80, 100, 520]);
});

it("shares spare height between photos without imposing a step count", () => {
  const rows = [80, 220, 80, 220].map((height) => ({ height, hasPhoto: height === 220 }));
  expect(fillWiPhotoRows(rows, 800)).toEqual([80, 320, 80, 320]);
  expect(fillWiPhotoRows([{ height: 90, hasPhoto: false }], 800)).toEqual([90]);
  expect(fillWiPhotoRows(rows, 600)).toEqual([80, 220, 80, 220]);
});

it("stops stretching a wide image once it fills its column and gives room to taller photos", () => {
  expect(fillWiPhotoRows([
    { height: 100, hasPhoto: true, maxHeight: 120 },
    { height: 220, hasPhoto: true, maxHeight: 600 },
  ], 700)).toEqual([120, 580]);
  expect(fillWiPhotoRows([{ height: 100, hasPhoto: true, maxHeight: 160 }], 800)).toEqual([160]);
});

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
