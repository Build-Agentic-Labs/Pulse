import { describe, expect, it } from "vitest";
import { MIN_SPLIT_LINES, packBlocks, type MeasuredBlock } from "./pagination";

/** A block that cannot be cut — a list item, a table row, an SVG. */
function atom(id: string, height: number, extra: Partial<MeasuredBlock> = {}): MeasuredBlock {
  return { id, height, category: "purpose", sectionTitle: "Purpose", ...extra };
}

/** A block of text that may be cut between lines. `height` must be lines × lineHeight. */
function text(id: string, lines: number, lineHeight = 10, extra: Partial<MeasuredBlock> = {}): MeasuredBlock {
  return {
    id,
    height: lines * lineHeight,
    lineHeight,
    splittable: true,
    category: "procedure",
    sectionTitle: "Procedure",
    ...extra,
  };
}

describe("packBlocks", () => {
  it("puts everything on one page when it all fits", () => {
    const pages = packBlocks([atom("a", 30), atom("b", 30)], 100);
    expect(pages).toHaveLength(1);
    expect(pages[0].blocks.map((b) => b.blockId)).toEqual(["a", "b"]);
  });

  it("fills a page exactly to the boundary without spilling", () => {
    const pages = packBlocks([atom("a", 60), atom("b", 40)], 100);
    expect(pages).toHaveLength(1);
  });

  // One pixel over is the case the old min-height CSS got wrong: it grew the page
  // instead of starting a new one.
  it("starts a new page when a block overflows by a single pixel", () => {
    const pages = packBlocks([atom("a", 60), atom("b", 41)], 100);
    expect(pages).toHaveLength(2);
    expect(pages[1].blocks.map((b) => b.blockId)).toEqual(["b"]);
  });

  it("never leaves a heading as the last thing on a page", () => {
    const blocks = [
      atom("body", 70),
      atom("heading", 20, { keepWithNext: true }),
      text("para", 5),
    ];
    const pages = packBlocks(blocks, 100);
    expect(pages[0].blocks.map((b) => b.blockId)).toEqual(["body"]);
    expect(pages[1].blocks.map((b) => b.blockId)).toEqual(["heading", "para"]);
  });

  it("cuts a long paragraph across pages and flags the continuation", () => {
    const pages = packBlocks([text("para", 20)], 100);
    expect(pages).toHaveLength(2);
    expect(pages[0].blocks[0]).toMatchObject({
      blockId: "para",
      continued: false,
      lineRange: { startLine: 0, endLine: 10, lineHeight: 10 },
    });
    expect(pages[1].blocks[0]).toMatchObject({
      blockId: "para",
      continued: true,
      lineRange: { startLine: 10, endLine: 20, lineHeight: 10 },
    });
  });

  it("records the section to repeat as a continued heading, with its category", () => {
    const pages = packBlocks([text("para", 20)], 100);
    expect(pages[1].continuedSections).toEqual([{ title: "Procedure", category: "procedure" }]);
  });

  it("reserves the continuation-heading allowance on pages that open with a continuation", () => {
    const pages = packBlocks([text("para", 20)], 100, 15);
    // Page 1 has no continuation: full 10 lines. Page 2 opens with one: only
    // floor((100 - 15) / 10) = 8 lines fit under the "(cont.)" heading.
    expect(pages).toHaveLength(3);
    expect(pages[0].blocks[0].lineRange).toMatchObject({ startLine: 0, endLine: 10 });
    expect(pages[1].blocks[0].lineRange).toMatchObject({ startLine: 10, endLine: 18 });
    expect(pages[2].blocks[0].lineRange).toMatchObject({ startLine: 18, endLine: 20 });
  });

  // Cutting after line 11 of 12 would strand a single line. Pull the cut back so
  // MIN_SPLIT_LINES carry over instead.
  it("never strands fewer than MIN_SPLIT_LINES on the next page", () => {
    const pages = packBlocks([text("para", 12)], 110);
    expect(pages).toHaveLength(2);
    const carried = pages[1].blocks[0].lineRange!;
    expect(carried.endLine - carried.startLine).toBeGreaterThanOrEqual(MIN_SPLIT_LINES);
  });

  it("moves a splittable block to a fresh page rather than cutting off one line", () => {
    const pages = packBlocks([atom("a", 85), text("para", 6)], 100);
    expect(pages[0].blocks.map((b) => b.blockId)).toEqual(["a"]);
    expect(pages[1].blocks[0]).toMatchObject({ blockId: "para", continued: false });
    // Placed whole in one piece — no clipping window needed at render time.
    expect(pages[1].blocks[0].lineRange).toBeUndefined();
  });

  // linesLeft = 3 cannot split into two legal chunks (each side needs
  // MIN_SPLIT_LINES); the remainder moves to a fresh page whole.
  it("moves an uncuttable short remainder whole instead of stranding one line", () => {
    const pages = packBlocks([atom("a", 85), text("para", 3)], 105);
    expect(pages[0].blocks.map((b) => b.blockId)).toEqual(["a"]);
    expect(pages[1].blocks[0]).toMatchObject({ blockId: "para", continued: false });
    expect(pages[1].blocks[0].lineRange).toBeUndefined();
  });

  it("carries a trailing heading onto the oversized atom's page instead of orphaning it", () => {
    const blocks = [atom("h", 20, { keepWithNext: true }), atom("huge", 250)];
    const pages = packBlocks(blocks, 100);
    expect(pages).toHaveLength(1);
    expect(pages[0].blocks.map((b) => b.blockId)).toEqual(["h", "huge"]);
    expect(pages[0].overflowing).toBe(true);
  });

  // Degenerate: a page shorter than two text lines. The two-line paragraph cannot
  // legally split, places whole, and the page is flagged rather than silently clipped.
  it("flags a page overfilled by an uncuttable remainder on a degenerate tiny page", () => {
    const pages = packBlocks([text("para", 2)], 15);
    expect(pages).toHaveLength(1);
    expect(pages[0].blocks[0].lineRange).toBeUndefined();
    expect(pages[0].overflowing).toBe(true);
  });

  it("gives an oversized indivisible block its own page and flags it", () => {
    const pages = packBlocks([atom("a", 30), atom("huge", 250)], 100);
    expect(pages).toHaveLength(2);
    expect(pages[1].blocks.map((b) => b.blockId)).toEqual(["huge"]);
    expect(pages[1].overflowing).toBe(true);
  });

  it("does not flag pages that merely fill completely", () => {
    const pages = packBlocks([atom("a", 100)], 100);
    expect(pages[0].overflowing).toBe(false);
  });

  it("returns no pages for no blocks", () => {
    expect(packBlocks([], 100)).toEqual([]);
  });

  // Guards the caller's fallback path: a zero or negative usable height means
  // measurement failed, and the component renders unpaginated instead.
  it("returns no pages when the usable height is not positive", () => {
    expect(packBlocks([atom("a", 10)], 0)).toEqual([]);
    expect(packBlocks([atom("a", 10)], -5)).toEqual([]);
  });
});
