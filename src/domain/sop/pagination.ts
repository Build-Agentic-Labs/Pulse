/**
 * Page packing for the controlled-document preview.
 *
 * This module is deliberately pure: it consumes blocks whose heights were already
 * measured in the browser and decides only *where the page breaks go*. Keeping the
 * policy here — rather than inline in the preview — is what makes widow/orphan rules
 * testable at all. jsdom performs no real layout, so a DOM-coupled paginator could
 * only ever be tested against the browser's font metrics.
 *
 * The rules encoded below:
 *   - a heading never ends a page (`keepWithNext`)
 *   - a cut paragraph leaves at least MIN_SPLIT_LINES either side
 *   - an indivisible block taller than the page gets its own page, flagged, and the
 *     caller renders it with visible overflow rather than clipping it. In an
 *     ISO-controlled document silently swallowed text is far worse than obviously
 *     broken layout.
 */

/** Minimum lines either side of a mid-paragraph split. */
export const MIN_SPLIT_LINES = 2;

export interface MeasuredBlock {
  /** Stable identity, used for React keys and to look the block back up when rendering. */
  id: string;
  /**
   * FLOW height in CSS pixels at true page width: the offsetTop delta to the
   * next block, margins included. This is what a placement costs the page.
   */
  height: number;
  /**
   * Height of the text box alone (lines × lineHeight), excluding collapsed
   * margins that `height` carries. Line arithmetic for cutting uses this;
   * budgeting always uses `height`. Falls back to `height` when absent —
   * correct whenever the two are equal, as in synthetic tests.
   */
  contentHeight?: number;
  /** Drives `data-review-category` on every fragment, continuations included. */
  category: string;
  /** Repeated as "<title> (cont.)" when the section carries onto a new page. */
  sectionTitle: string;
  /** A heading: must not be the last thing on a page. */
  keepWithNext?: boolean;
  /** Text that may be cut between lines. */
  splittable?: boolean;
  /** Height of a single line. Required when `splittable`. */
  lineHeight?: number;
}

export interface PlacedLineRange {
  startLine: number;
  endLine: number;
  /**
   * Carried through to render time so the fragment can be shown as a clipping
   * window over the *whole* paragraph. Slicing the string instead would re-wrap
   * the remainder at different points than the measured pass, and the packer's
   * arithmetic would stop describing what is on screen.
   */
  lineHeight: number;
}

export interface PlacedBlock {
  blockId: string;
  /** Present only for a cut block: the [startLine, endLine) placed on this page. */
  lineRange?: PlacedLineRange;
  /** True when this fragment continues from the previous page. */
  continued: boolean;
}

export interface ContinuedSection {
  title: string;
  category: string;
}

export interface PagePlan {
  blocks: PlacedBlock[];
  /**
   * Sections to repeat as "<title> (cont.)" at the top of this page. A
   * continuation is always the first block on its page, so this holds at most
   * one entry — it stays an array for shape stability.
   */
  continuedSections: ContinuedSection[];
  /** Set when this page holds content taller than the page that nothing could split. */
  overflowing: boolean;
}

/** How much of `block` must fit for it to be worth starting after a heading. */
function minimumFirstChunk(block: MeasuredBlock | undefined): number {
  if (!block) return 0;
  if (block.splittable && block.lineHeight) {
    return Math.min(block.height, block.lineHeight * MIN_SPLIT_LINES);
  }
  return block.height;
}

export function packBlocks(
  blocks: readonly MeasuredBlock[],
  usableHeight: number,
  /** Height reserved on pages that open with a continuation — the "(cont.)" heading itself. */
  continuationHeadingHeight = 0,
): PagePlan[] {
  if (usableHeight <= 0) return [];

  const pages: PagePlan[] = [];
  let current: PlacedBlock[] = [];
  let continuedSections: ContinuedSection[] = [];
  let used = 0;
  // Headings at the tail of `current` whose section content has not landed yet.
  // A page break moves them forward instead of leaving page-bottom orphans.
  let trailingHeadings: { placed: PlacedBlock; height: number }[] = [];

  function flush(overflowing = false): void {
    if (current.length === 0) return;
    pages.push({ blocks: current, continuedSections, overflowing });
    current = [];
    continuedSections = [];
    used = 0;
  }

  /** Start a fresh page, carrying any trailing headings onto it. */
  function breakPage(): void {
    const carried = trailingHeadings;
    current.splice(current.length - carried.length);
    flush();
    for (const item of carried) {
      current.push(item.placed);
      used += item.height;
    }
    // Still trailing on the new page: a second break before their content lands
    // must carry them again, or the first break orphans them retroactively.
    trailingHeadings = carried;
  }

  for (let index = 0; index < blocks.length; index += 1) {
    const block = blocks[index];

    // A heading that would end a page moves to the next one, together with enough
    // of what follows to be worth reading.
    if (block.keepWithNext) {
      const needed = block.height + minimumFirstChunk(blocks[index + 1]);
      if (needed > usableHeight - used && current.length > 0) breakPage();
      const placed: PlacedBlock = { blockId: block.id, continued: false };
      current.push(placed);
      used += block.height;
      trailingHeadings.push({ placed, height: block.height });
      // Degenerate: a heading taller than the page overflows its own flagged page
      // (its section content starts on the next page, headingless).
      if (block.height > usableHeight) {
        trailingHeadings = [];
        flush(true);
      }
      continue;
    }

    if (!block.splittable || !block.lineHeight) {
      if (block.height <= usableHeight - used) {
        current.push({ blockId: block.id, continued: false });
        used += block.height;
        trailingHeadings = [];
        continue;
      }
      breakPage();
      current.push({ blockId: block.id, continued: false });
      used += block.height;
      trailingHeadings = [];
      // Nothing left to split: hand it out and let the caller show the overflow.
      if (used > usableHeight) flush(true);
      continue;
    }

    // A splittable block whose FLOW height fits places whole, margins and all,
    // exactly like an atom. Charging lines × lineHeight here instead would drop
    // the paragraph's collapsed bottom margin from the budget — ~4px per block,
    // 80px+ on a page of hyphen-bulleted lines — and push the footer off the
    // sheet. Line arithmetic exists only for blocks that must actually cut.
    if (block.height <= usableHeight - used) {
      current.push({ blockId: block.id, continued: false });
      used += block.height;
      trailingHeadings = [];
      continue;
    }

    const lineHeight = block.lineHeight;
    // Line count comes from the text box, never the flow height: rounding a
    // margin-inflated delta would invent a phantom line at the end of the block.
    const totalLines = Math.max(1, Math.round((block.contentHeight ?? block.height) / lineHeight));
    let placedLines = 0;

    while (placedLines < totalLines) {
      const roomLines = Math.floor((usableHeight - used) / lineHeight);
      const linesLeft = totalLines - placedLines;

      // Too little room for a worthwhile chunk — break to a fresh page first
      // (carrying any heading, so it cannot be orphaned by the break). If the
      // page already holds nothing BUT carried headings, breaking again cannot
      // create room: fall through and place a minimal chunk, letting the
      // overfill check below flag the page instead of orphaning the heading.
      if (roomLines < MIN_SPLIT_LINES && current.length > trailingHeadings.length) {
        breakPage();
        continue;
      }

      let take = Math.min(Math.max(roomLines, 1), linesLeft);
      const leftover = linesLeft - take;
      if (leftover > 0 && leftover < MIN_SPLIT_LINES) {
        if (linesLeft >= MIN_SPLIT_LINES * 2) {
          // Shrink the chunk so at least MIN_SPLIT_LINES carry over. Never
          // overfills: take only decreases here.
          take = linesLeft - MIN_SPLIT_LINES;
        } else if (current.length > trailingHeadings.length) {
          // Fewer than 2×MIN lines cannot split legally — move the remainder
          // whole to a fresh page. Same headings-only guard as above: breaking
          // a page that holds nothing but carried headings cannot create room.
          breakPage();
          continue;
        } else {
          // Fresh page (or headings-only page) and still uncuttable: place
          // whole; the overfill check below flags the page.
          take = linesLeft;
        }
      }

      const continued = placedLines > 0;
      if (continued) {
        continuedSections.push({ title: block.sectionTitle, category: block.category });
      }
      const whole = !continued && take === totalLines;
      current.push({
        blockId: block.id,
        continued,
        lineRange: whole
          ? undefined
          : { startLine: placedLines, endLine: placedLines + take, lineHeight },
      });
      // Fragments charge exact window height. The one imprecision: a remainder
      // placed whole after a page break loses its bottom margin from the budget
      // — at most one collapsed margin of whitespace spilling into the page's
      // bottom padding, never text.
      used += take * lineHeight;
      placedLines += take;
      trailingHeadings = [];

      if (used > usableHeight) {
        // Only reachable via the uncuttable whole placement (or a single line
        // taller than a degenerate page) — flagged, never silently clipped.
        flush(true);
      } else if (placedLines < totalLines) {
        flush();
        // The next chunk opens its page under a "(cont.)" heading; reserve its height.
        used = continuationHeadingHeight;
      }
    }
  }

  flush();
  return pages;
}
