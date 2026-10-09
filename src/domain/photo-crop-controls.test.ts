import { describe, expect, it } from "vitest";
import { adjustPhotoCrop } from "./photo-crop-controls";
const full = { left: 0, right: 0, top: 0, bottom: 0 };
describe("crop control bounds", () => {
 it("moves an edge inward and preserves the other edges", () => {
  expect(adjustPhotoCrop(full, "e", -.1, 0)).toEqual({ ...full, right: .1 });
 });
 it("keeps the minimum size and prevents edges leaving the image", () => {
  expect(adjustPhotoCrop(full, "nw", 2, 2)).toEqual({ ...full, left: .95, top: .95 });
  expect(adjustPhotoCrop(full, "se", 2, 2)).toEqual(full);
 });
 it("moves a crop without resizing and clamps at the image boundary", () => {
  expect(adjustPhotoCrop({ left: .1, right: .1, top: .2, bottom: .2 }, "move", 1, -1)).toEqual({ left: .2, right: 0, top: 0, bottom: .4 });
 });
});
