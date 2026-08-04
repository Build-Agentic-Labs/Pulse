# SOP Measured Auto-Pagination Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace `SopPrintPreview`'s hand-assigned page count with a measured paginator so every rendered sheet is a real 8.5×11in page carrying its own header, footer, and truthful "Page N of M".

**Architecture:** Two passes. A pure greedy packer (`src/domain/sop/pagination.ts`) owns all layout policy and is unit-tested against synthetic heights. The preview renders blocks into an offscreen container at true page width; a hook measures each leaf block by successive `offsetTop` deltas (margins included — rect heights would under-measure) and feeds two segments (sections, trailing) through the packer, keeping flowchart sheets in their current document position. Cut paragraphs render as clipping windows over the whole text, so on-screen wrapping is identical to the measured pass. `sop-print-preview.tsx` renders the resulting plans as real `DocumentPage`s.

**Tech Stack:** TypeScript, React 19, Next.js 16 (App Router), Vitest (node project for `.ts`, jsdom project for `.tsx`).

**Spec:** `docs/superpowers/specs/2026-08-03-sop-measured-pagination-design.md`

## Global Constraints

- Domain logic in `src/domain/` is pure — no React, no DOM, no Supabase — and gets a test file next to it (CLAUDE.md).
- Feature CSS stays in the component that uses it. Nothing goes into `app/globals.css`.
- No `console.log`. `console.warn` is the established convention for degraded non-fatal paths.
- Controlled documents use `formatDateControlled`. Do not add local date helpers.
- Minimum lines either side of a mid-paragraph split: **2**.
- Page geometry: 8.5in × 11in, padding `0.52in 0.75in 0.42in`. Usable body height is **measured at runtime**, never hardcoded — the header grows when a long title wraps.
- Every rendered fragment, including continuations, must carry `data-review-category`, or review-mode scroll tracking reports the wrong section.
- Every failure path must still render a document. `SopPrintPreview` is what reviewers and approvers sign against; failing closed would block approvals.
- Branch `feat/sop-measured-pagination`. Commit after each task. CI must be green before merge.

## File Structure

| File | Responsibility |
|---|---|
| `src/domain/sop/pagination.ts` | **Create.** Pure packer. All layout policy: fitting, splitting, orphan control, overflow flagging. |
| `src/domain/sop/pagination.test.ts` | **Create.** Unit tests against synthetic heights. Node env. |
| `src/components/sop/print-blocks.tsx` | **Create.** Decomposes a `Sop` into renderable leaf-block descriptors. |
| `src/components/sop/print-blocks.test.tsx` | **Create.** Decomposition tests. jsdom env. |
| `src/components/sop/use-paginated-pages.ts` | **Create.** Offscreen render → measure → call packer → return plan. |
| `src/components/sop/sop-print-preview.tsx` | **Modify.** Consume the plan; replace hand-assigned pages and the `totalPages` arithmetic at `:342`; CSS at `:543`, `:655`, `:668`. |

---

### Task 1: Pure packer

**Files:**
- Create: `src/domain/sop/pagination.ts`
- Test: `src/domain/sop/pagination.test.ts`

**Interfaces:**
- Consumes: nothing — this is the foundation task.
- Produces: `MeasuredBlock`, `PlacedBlock`, `PlacedLineRange`, `ContinuedSection`, `PagePlan`, `packBlocks(blocks, usableHeight, continuationHeadingHeight = 0)`, and the exported constant `MIN_SPLIT_LINES = 2`. Tasks 3 and 4 depend on these exact names. `PlacedLineRange` carries `lineHeight` so a cut fragment renders as a clipping window over the whole paragraph. `ContinuedSection` is `{ title: string; category: string }` — the category must travel with the title or the "(cont.)" heading cannot carry `data-review-category`. The third parameter reserves room at the top of any page that opens with a continuation, because the "(cont.)" heading itself occupies height the packer would otherwise not know about.

- [ ] **Step 1: Write the failing test**

Create `src/domain/sop/pagination.test.ts`:

```ts
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

  // A page that fits the heading but can never fit heading + MIN_SPLIT_LINES:
  // breaking again cannot help (the fresh page holds only the carried heading),
  // so a minimal chunk lands under the heading on a flagged page. The heading
  // must never end up alone — that is this module's headline rule.
  it("keeps a heading with content even when the pair can never co-fit legally", () => {
    const pages = packBlocks([atom("h", 20, { keepWithNext: true }), text("para", 5)], 25);
    expect(pages[0].blocks.map((b) => b.blockId)).toEqual(["h", "para"]);
    expect(pages[0].overflowing).toBe(true);
    for (const page of pages) {
      expect(page.blocks.map((b) => b.blockId)).not.toEqual(["h"]);
    }
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
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npx vitest run src/domain/sop/pagination.test.ts
```

Expected: FAIL — `Failed to resolve import "./pagination"`.

- [ ] **Step 3: Write minimal implementation**

Create `src/domain/sop/pagination.ts`:

```ts
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
  /** Rendered height in CSS pixels at true page width. */
  height: number;
  /** Drives `data-review-category` on every fragment, continuations included. */
  category: string;
  /** Repeated as "<title> (cont.)" when the section carries onto a new page. */
  sectionTitle: string;
  /** A heading: must not be the last thing on a page. */
  keepWithNext?: boolean;
  /** Text that may be cut between lines. Requires `height === lines × lineHeight`. */
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

    const lineHeight = block.lineHeight;
    const totalLines = Math.max(1, Math.round(block.height / lineHeight));
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
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
npx vitest run src/domain/sop/pagination.test.ts
```

Expected: PASS, 17 tests.

- [ ] **Step 5: Typecheck and lint**

```bash
npm run typecheck && npm run lint
```

Expected: both clean, no warnings.

- [ ] **Step 6: Commit**

```bash
git add src/domain/sop/pagination.ts src/domain/sop/pagination.test.ts
git commit -m "feat: add pure page packer for SOP print preview"
```

---

### Task 2: Block decomposition

**Files:**
- Create: `src/components/sop/print-blocks.tsx`
- Test: `src/components/sop/print-blocks.test.tsx`

**Interfaces:**
- Consumes: `MeasuredBlock` from Task 1 (this task produces everything except `height`).
- Produces: `PrintBlock` (a `MeasuredBlock` minus `height`/`lineHeight`, plus `render: (lineRange?: PlacedLineRange) => ReactNode`), `PrintBlockExtras`, and `buildPrintBlocks(sop, extras?): { sections: PrintBlock[]; trailing: PrintBlock[] }`. Two segments because the flowchart sheets must stay where the controlled document has them today — after the Procedure narrative, before Annexes. One flat list would silently reorder the document (flowcharts after Change Approvals). Task 3 measures both segments in one offscreen pass but packs them separately; Task 4 renders sections → flow pages → trailing.
- Rule for every block: **the root element `render` returns carries `data-review-category={category}`** — headings, list items, and table rows included, not just prose. Review-mode scroll tracking reads that attribute; any fragment missing it makes the review panel report the wrong section.

- [ ] **Step 1: Write the failing test**

Create `src/components/sop/print-blocks.test.tsx`:

```tsx
import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { buildPrintBlocks } from "./print-blocks";
import { createEmptySop } from "@/domain/sop/schema";

// createEmptySop(id, now) — both arguments are required; fixed values keep tests deterministic.
function sopWith(overrides: Record<string, unknown>) {
  return {
    ...createEmptySop("sop-test", "2026-08-03T00:00:00.000Z"),
    ...overrides,
  } as Parameters<typeof buildPrintBlocks>[0];
}

describe("buildPrintBlocks", () => {
  it("emits a keepWithNext heading before each section's content", () => {
    const { sections } = buildPrintBlocks(sopWith({ purpose: "Establish a method." }));
    const purpose = sections.filter((b) => b.category === "purpose");
    expect(purpose[0].keepWithNext).toBe(true);
    expect(purpose[1].keepWithNext).toBeFalsy();
  });

  it("splits prose into one splittable block per line", () => {
    const { sections } = buildPrintBlocks(sopWith({ purpose: "First line.\nSecond line.\nThird line." }));
    const body = sections.filter((b) => b.category === "purpose" && !b.keepWithNext);
    expect(body).toHaveLength(3);
    expect(body.every((b) => b.splittable)).toBe(true);
  });

  // The six SOPs whose Procedure has zero newlines are exactly why a single
  // paragraph must still be marked splittable: the packer cuts it by line count.
  it("marks a paragraph with no newlines as splittable", () => {
    const { sections } = buildPrintBlocks(sopWith({ purpose: "A".repeat(4000) }));
    const body = sections.filter((b) => b.category === "purpose" && !b.keepWithNext);
    expect(body).toHaveLength(1);
    expect(body[0].splittable).toBe(true);
  });

  it("emits one non-splittable block per list item", () => {
    const { sections } = buildPrintBlocks(sopWith({ measurements: ["First KPI", "Second KPI"] }));
    const body = sections.filter((b) => b.category === "measurements" && !b.keepWithNext);
    expect(body).toHaveLength(2);
    expect(body.every((b) => b.splittable)).toBeFalsy();
  });

  it("gives every block a unique id across both segments", () => {
    const { sections, trailing } = buildPrintBlocks(
      sopWith({ purpose: "One.\nTwo.", scope: "Three." }),
    );
    const ids = [...sections, ...trailing].map((b) => b.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("carries the review category onto every block so scroll tracking still works", () => {
    const { sections } = buildPrintBlocks(sopWith({ purpose: "One.\nTwo." }));
    expect(sections.filter((b) => b.category === "purpose")).toHaveLength(3);
  });

  // Blocks are self-contained: a list item brings its own section shell and
  // single-item ul, so stacking blocks needs no grouping helper.
  it("renders a list item as a self-contained block with its review category", () => {
    const { sections } = buildPrintBlocks(sopWith({ measurements: ["First KPI"] }));
    const body = sections.filter((b) => b.category === "measurements" && !b.keepWithNext);
    const { container } = render(<>{body[0].render()}</>);
    expect(container.querySelector("[data-review-category='measurements']")).not.toBeNull();
    expect(container.querySelector("ul.sop-export-list li")?.textContent).toBe("First KPI");
  });

  it("routes annexes and change history into the trailing segment", () => {
    const { sections, trailing } = buildPrintBlocks(
      sopWith({
        changeHistory: [{ version: "1.0", changes: "Initial release", createdByDate: "2026-08-01" }],
      }),
    );
    expect(trailing.some((b) => b.category === "history")).toBe(true);
    expect(sections.some((b) => b.category === "history")).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npx vitest run src/components/sop/print-blocks.test.tsx
```

Expected: FAIL — `Failed to resolve import "./print-blocks"`.

- [ ] **Step 3: Write the implementation**

Create `src/components/sop/print-blocks.tsx`. Decompose in the order page 1 currently renders (`sop-print-preview.tsx:715-786`), then the trailing sections:

```tsx
import type { ReactNode } from "react";
import type { PlacedLineRange } from "@/domain/sop/pagination";
import type { Sop } from "@/domain/sop/schema";

/** A leaf block before measurement. Task 3 adds `height`/`lineHeight`. */
export interface PrintBlock {
  id: string;
  category: string;
  sectionTitle: string;
  keepWithNext?: boolean;
  splittable?: boolean;
  /** `lineRange` is supplied when the packer cut this block across pages. */
  render: (lineRange?: PlacedLineRange) => ReactNode;
}
```

Emit two segments. `sections`, in order: `purpose`, `scope`, `definitions` (one block per table row, header repeats), `responsible`, `references`, `measurements`, `procedure`. `trailing`: `annexes`, `history` (one block per Change History row), and the approvals table as **one atomic block** — it renders `ApprovalTable`, whose signature-reveal animation and `data-signature-id` anchors must stay in a single element (a realistic approvals table is a handful of rows; if it ever exceeds a page, the overflow flag warns rather than clipping). For each section emit a heading block with `keepWithNext: true`, then its content blocks. List and table rows are non-splittable.

Interactive and component-state content is injected, keeping this module pure of preview state:

```tsx
export interface PrintBlockExtras {
  /** References section: the preview injects the linked-SOP anchor and annex-open button. */
  renderLinkedSop?: (link: Sop["linkedSops"][number]) => ReactNode;
  renderReferenceDoc?: (doc: NonNullable<Sop["referenceDocs"]>[number]) => ReactNode;
  /** Change History author column ("system author" + formatDateControlled join). */
  changeAuthor?: (entry: Sop["changeHistory"][number]) => string;
  /** Whole approvals table, one atomic trailing block; omitted → section omitted. */
  approvalsTable?: ReactNode;
  /** "Attached form: …" annotations under annex rows, keyed by annex id. */
  annexFileLines?: Map<string, { name: string; error?: string }>;
  annexLoading?: boolean;
}
```

All fields optional with plain-text fallbacks so tests can call `buildPrintBlocks(sop)` bare. The render bodies mirror the existing markup exactly — page 1 sections at `sop-print-preview.tsx:715-786`, annexes/history/approvals at `:796-855`.

The prose helper, which every text section routes through. A cut fragment renders
the **whole** paragraph inside a clipping window offset to its line range — never a
sliced string, which would re-wrap the remainder at different points than the
measured pass and detach the packer's arithmetic from what is on screen. Because the
window starts exactly at a wrapped line boundary, no stray leading whitespace can
appear on a continuation; the spec's trim requirement is satisfied by construction.

```tsx
import type { PlacedLineRange } from "@/domain/sop/pagination";

function proseBlocks(category: string, sectionTitle: string, value: string): PrintBlock[] {
  // One block per line. A paragraph containing no newline stays a single block and
  // is still marked splittable — the six SOPs whose Procedure has zero newlines
  // depend on the Range pass cutting it later.
  const lines = value ? value.split(/\r?\n/) : [""];
  return lines.map((line, index) => ({
    id: `${category}-p${index}`,
    category,
    sectionTitle,
    splittable: true,
    render: (lineRange) => {
      const paragraph = (
        <section className="sop-export-section" style={{ marginTop: 0 }} data-review-category={category}>
          <p className={line ? undefined : "sop-export-empty"}>{line || "—"}</p>
        </section>
      );
      if (!lineRange) return paragraph;
      const { startLine, endLine, lineHeight } = lineRange;
      return (
        <div
          data-review-category={category}
          data-line-range={`${startLine}-${endLine}`}
          style={{ height: (endLine - startLine) * lineHeight, overflow: "hidden" }}
        >
          <div style={{ marginTop: -startLine * lineHeight }}>{paragraph}</div>
        </div>
      );
    },
  }));
}
```

The `render` signature in `PrintBlock` is therefore
`render: (lineRange?: PlacedLineRange) => ReactNode`.

**Every block is self-contained**: its `render` output includes its own
`.sop-export-section` shell, so a page (visible or offscreen) is just placed
blocks stacked in order — no grouping helper whose visible and offscreen
versions could diverge. Concretely:

- A **heading** block renders
  `<section className="sop-export-section" data-review-category={category}><h2>{title}</h2></section>`
  and keeps the section's natural `margin-top: 12px` — the gap above a section
  belongs to its heading. The existing `.sop-export-section:first-child
  { margin-top: 0 }` rule absorbs it at the top of a page.
- Every **content** block wraps in the same shell with `style={{ marginTop: 0 }}`
  (the gap already came from the heading block). This is what keeps
  `.sop-export-section p { white-space: pre-wrap }` and friends applying — those
  selectors require the ancestor class, so a bare `<p>` would silently lose its
  styling.
- A **list item** renders as a self-contained single-item
  `<ul className="sop-export-list"><li>…</li></ul>` inside its shell. The list
  reset (`margin: 0`) makes consecutive single-item lists visually identical to
  one list.
- A **table row** renders as a self-contained single-row
  `<table className="sop-export-table">` with the section's full `<colgroup>`
  repeated — identical percentage columns under `table-layout: fixed` keep every
  row's columns aligned across stacked tables. Non-first rows pass
  `style={{ borderTop: 0 }}` on their cells so stacked 1px borders don't double
  into a 2px seam. The header-row block renders the same table with `<thead>`
  only, and reappears via the packer's continuation machinery.

Add matching tests to Step 1's suite:

```tsx
it("renders a cut fragment as a clipping window sized to its line range", () => {
  const { sections } = buildPrintBlocks(sopWith({ purpose: "A".repeat(4000) }));
  const body = sections.filter((b) => b.category === "purpose" && !b.keepWithNext);
  const { container } = render(
    <>{body[0].render({ startLine: 10, endLine: 20, lineHeight: 14 })}</>,
  );
  const window = container.firstElementChild as HTMLElement;
  expect(window.style.height).toBe("140px");
  expect(window.style.overflow).toBe("hidden");
  const inner = window.firstElementChild as HTMLElement;
  expect(inner.style.marginTop).toBe("-140px");
  // The full text is present; the window, not the string, does the cutting.
  expect(container.textContent).toBe("A".repeat(4000));
});

it("renders the plain paragraph when no line range is given", () => {
  const { sections } = buildPrintBlocks(sopWith({ purpose: "Short." }));
  const body = sections.filter((b) => b.category === "purpose" && !b.keepWithNext);
  const { container } = render(<>{body[0].render()}</>);
  expect(container.querySelector("p")?.textContent).toBe("Short.");
  expect(container.querySelector("div")).toBeNull();
});
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
npx vitest run src/components/sop/print-blocks.test.tsx
```

Expected: PASS, 10 tests.

- [ ] **Step 5: Commit**

```bash
git add src/components/sop/print-blocks.tsx src/components/sop/print-blocks.test.tsx
git commit -m "feat: decompose SOP sections into measurable print blocks"
```

---

### Task 3: Measuring hook

**Files:**
- Create: `src/components/sop/use-paginated-pages.ts`

**Interfaces:**
- Consumes: `packBlocks`, `MeasuredBlock`, `PagePlan` (Task 1); `PrintBlock` (Task 2).
- Produces: `usePaginatedPages(segments: { sections: PrintBlock[]; trailing: PrintBlock[] }): { sectionPages: PagePlan[]; trailingPages: PagePlan[]; measuring: boolean; failed: boolean; offscreenRef: RefObject<HTMLDivElement | null> }`. Task 4 consumes all five fields and owns rendering the offscreen tree the hook measures (the hook is `.ts` and renders nothing).

- [ ] **Step 1: Implement the hook**

```ts
const FONTS_READY_TIMEOUT_MS = 3000;
const REMEASURE_DEBOUNCE_MS = 150;

export interface PaginatedSegments {
  sections: readonly PrintBlock[];
  trailing: readonly PrintBlock[];
}

export function usePaginatedPages({ sections, trailing }: PaginatedSegments) {
  const offscreenRef = useRef<HTMLDivElement | null>(null);
  const [sectionPages, setSectionPages] = useState<PagePlan[]>([]);
  const [trailingPages, setTrailingPages] = useState<PagePlan[]>([]);
  const [measuring, setMeasuring] = useState(true);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setMeasuring(true);

    // getBoundingClientRect ignores margins, and this document's spacing is
    // margin-driven (.sop-export-section margin-top, p margin-bottom) — rect
    // heights would under-measure every page and the page box would clip the
    // shortfall. Successive offsetTops inside a position:relative segment
    // container attribute every margin to a block, so the sum matches the
    // real flowed layout exactly.
    function measureSegment(root: HTMLElement, blocks: readonly PrintBlock[], segment: string): MeasuredBlock[] {
      const container = root.querySelector<HTMLElement>(`[data-segment="${segment}"]`);
      if (!container) return [];
      const nodes = blocks.map((block) =>
        container.querySelector<HTMLElement>(`[data-block-id="${block.id}"]`),
      );
      const bottom = container.scrollHeight;
      return blocks.map((block, index) => {
        const node = nodes[index];
        const top = node?.offsetTop ?? 0;
        const nextTop = nodes[index + 1]?.offsetTop ?? bottom;
        const height = Math.max(0, nextTop - top);
        const probe = node?.querySelector<HTMLElement>("p") ?? node;
        const raw = probe ? window.getComputedStyle(probe).lineHeight : "normal";
        const parsed = Number.parseFloat(raw);
        return {
          id: block.id,
          category: block.category,
          sectionTitle: block.sectionTitle,
          keepWithNext: block.keepWithNext,
          splittable: block.splittable,
          height,
          lineHeight: block.splittable
            ? (Number.isFinite(parsed) && parsed > 0 ? parsed : height)
            : undefined,
        };
      });
    }

    function usableHeight(root: HTMLElement): number {
      // The probe page replicates the real article: header + empty body + footer
      // at fixed 11in. The body's clientHeight IS the usable space — measured,
      // never hardcoded, because the header grows when a long title wraps.
      const body = root.querySelector<HTMLElement>("[data-measure-body]");
      if (!body) return 0;
      const paddingTop = Number.parseFloat(window.getComputedStyle(body).paddingTop) || 0;
      return body.clientHeight - paddingTop;
    }

    function continuationHeadingHeight(root: HTMLElement): number {
      // The "(cont.)" heading occupies real height on continuation pages; the
      // packer must budget it or those pages overfill by one heading. Read the
      // sentinel's offsetTop, not the section's offsetHeight — the h2's bottom
      // margin escapes by collapse and offsetHeight would under-budget it.
      return root.querySelector<HTMLElement>("[data-measure-cont-end]")?.offsetTop ?? 0;
    }

    async function measure(): Promise<void> {
      try {
        // Measuring before webfonts settle makes every height wrong by a few
        // percent, and reproduces only on cold loads. The race keeps a hung
        // fonts promise from blanking the preview forever.
        await Promise.race([
          document.fonts.ready,
          new Promise((resolve) => setTimeout(resolve, FONTS_READY_TIMEOUT_MS)),
        ]);
        const root = offscreenRef.current;
        if (!root || cancelled) return;

        const usable = usableHeight(root);
        const contHeading = continuationHeadingHeight(root);
        const measuredSections = measureSegment(root, sections, "sections");
        const measuredTrailing = measureSegment(root, trailing, "trailing");

        if (cancelled) return;
        setSectionPages(packBlocks(measuredSections, usable, contHeading));
        setTrailingPages(packBlocks(measuredTrailing, usable, contHeading));
        setFailed(false);
      } catch (error: unknown) {
        const detail = error instanceof Error ? error.message : String(error);
        console.warn(`SOP preview pagination failed; falling back to the unpaginated layout: ${detail}`);
        if (!cancelled) setFailed(true);
      } finally {
        if (!cancelled) setMeasuring(false);
      }
    }

    let timer = window.setTimeout(() => { void measure(); }, REMEASURE_DEBOUNCE_MS);
    let observerPrimed = false;
    const observer = new ResizeObserver(() => {
      // ResizeObserver fires once immediately on observe(); that initial
      // delivery would bypass the debounce and double-measure every change.
      if (!observerPrimed) {
        observerPrimed = true;
        return;
      }
      window.clearTimeout(timer);
      timer = window.setTimeout(() => { void measure(); }, REMEASURE_DEBOUNCE_MS);
    });
    if (offscreenRef.current) observer.observe(offscreenRef.current);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
      observer.disconnect();
    };
  }, [sections, trailing]);

  return { sectionPages, trailingPages, measuring, failed, offscreenRef };
}
```

Behaviour notes, beyond what the code states:

1. The hook renders nothing — Task 4 owns the offscreen tree (`[data-segment]`
   containers, `[data-block-id]` wrappers, the `[data-measure-body]` probe page,
   the `[data-measure-cont]` heading probe). The hook only queries it.
2. Heights come from offsetTop deltas, so the block wrappers must be plain
   in-flow `<div>`s inside `position: relative` segment containers.
3. `measuring` resets to `true` on every `sections`/`trailing` identity change,
   and re-measures are debounced so editor keystrokes do not reflow five pages
   per character.
4. On any throw, or a rejected fonts promise: `console.warn` and `failed: true` —
   Task 4 falls back to the unpaginated layout, which is today's behaviour.

- [ ] **Step 2: Verify it compiles**

```bash
npm run typecheck && npm run lint
```

Expected: both clean.

- [ ] **Step 3: Commit**

```bash
git add src/components/sop/use-paginated-pages.ts
git commit -m "feat: measure SOP print blocks offscreen and pack them into pages"
```

---

### Task 4: Wire into the preview

**Files:**
- Modify: `src/components/sop/sop-print-preview.tsx` (`:342` page count, `:543` page CSS, `:655` responsive CSS, `:668` print CSS, `:714-855` page rendering)

**Interfaces:**
- Consumes: `usePaginatedPages` (Task 3), `buildPrintBlocks` (Task 2), `PagePlan` (Task 1).
- Produces: no new exports. `SopPrintPreview`'s public props are unchanged.

- [ ] **Step 1: Wire the hook and replace the hand-assigned pages**

```tsx
const segments = useMemo(() => buildPrintBlocks(sop, extras), [sop, extras]);
const { sectionPages, trailingPages, measuring, failed, offscreenRef } = usePaginatedPages(segments);
```

`extras` is memoized from the preview's own state (approvals table node, annex file
lines, reference renderers) — see `PrintBlockExtras` in Task 2.

**Page order is unchanged from today's controlled document:** section pages →
flowchart pages → trailing pages (Annexes, Change History, Change Approvals) →
attachment sheets. Packing sections and trailing separately is what keeps the
flowcharts in their current position; a single flat plan would silently move them
after the approvals table.

Replace `:342` — attachment sheets stay **outside** the count, exactly as today
(they carry their own "Appendix · Page x of y" label and no document footer):

```ts
const totalPages = sectionPages.length + flowPages.length + trailingPages.length;
```

Render placed blocks by id lookup, skipping ids that no longer resolve — during
the debounce window after an edit, the plan is one render behind the blocks:

```tsx
const blockById = useMemo(
  () => new Map([...segments.sections, ...segments.trailing].map((b) => [b.id, b])),
  [segments],
);
```

Blocks are self-contained (Task 2), so a page body is placed blocks stacked in
order — no grouping helper, and the offscreen tree stacks the identical output,
which is what keeps measurement honest:

```tsx
{page.blocks.map((placed) => {
  const block = blockById.get(placed.blockId);
  if (!block) return null;
  return <Fragment key={placed.blockId + (placed.lineRange ? `@${placed.lineRange.startLine}` : "")}>{block.render(placed.lineRange)}</Fragment>;
})}
```

At the top of any page whose `continuedSections` is non-empty, render before the
first fragment, as its own self-contained heading:

```tsx
{page.continuedSections.map((section) => (
  <section key={section.category} className="sop-export-section" style={{ marginTop: 0 }} data-review-category={section.category}>
    <h2>{section.title} (cont.)</h2>
  </section>
))}
```

- [ ] **Step 2: Render the offscreen measurement tree**

The hook queries it; this component renders it. Placement and hiding are
load-bearing:

- Inside the overlay root but **after** the visible `.sop-preview-content` in DOM
  order, and **outside** `.sop-preview-scroll` — `handleReviewScroll` reads
  `data-review-category` inside the scroll container, and duplicated anchors
  there would corrupt review tracking.
- Hidden with `position: absolute; left: -99999px; top: 0; visibility: hidden;
  pointer-events: none;` and `aria-hidden`. **Never `display: none`** — that
  collapses layout to 0×0 and every measurement silently reads zero, reproducing
  the original bug with `failed` still false.
- The signature-reveal effect at `:325` must scope its query to the visible
  pages (`.sop-print-pages [data-signature-id=…]`) so the offscreen approvals
  clone can never steal the `scrollIntoView`.

```tsx
<div ref={offscreenRef} aria-hidden style={{ position: "absolute", left: -99999, top: 0, visibility: "hidden", pointerEvents: "none" }}>
  {/* Probe page: real header + empty body + footer at true geometry → usable height. */}
  <article className="sop-print-page" data-measure-page>
    <DocumentHeader sop={sop} />
    <main className="sop-print-page-body" data-measure-body />
    <DocumentFooter page={1} total={1} />
  </article>
  {/* Probe for the height a "(cont.)" heading adds to a continuation page.
      Measured via a sentinel's offsetTop, not offsetHeight — the h2's bottom
      margin escapes the section by margin collapse and offsetHeight would
      under-budget every continuation page by that margin. */}
  <div style={{ position: "relative" }}>
    <section className="sop-export-section" style={{ marginTop: 0 }}>
      <h2>Procedure (cont.)</h2>
    </section>
    <div data-measure-cont-end />
  </div>
  {(["sections", "trailing"] as const).map((name) => (
    <div
      key={name}
      data-segment={name}
      className="sop-print-page"
      style={{ position: "relative", display: "block", width: "7in", height: "auto", minHeight: 0, overflow: "visible", padding: 0, boxShadow: "none" }}
    >
      {segments[name].map((block) => (
        <div key={block.id} data-block-id={block.id}>{block.render()}</div>
      ))}
    </div>
  ))}
</div>
```

The segment containers reuse the `.sop-print-page` class purely for its typography
(font family, 10pt, line-height 1.35) with the box overridden inline to a 7in
content column (8.5in minus 0.75in side padding) — content must wrap at exactly
the width it will render at, or line counts are wrong. Blocks render their normal
self-contained output; the offscreen copies of `data-review-category` are outside
`.sop-preview-scroll`, so `handleReviewScroll` never sees them. One known 4px
niceness: a cut block's final window clips the paragraph's `margin-bottom`, so
pages following a cut under-fill by 4px per cut — safe direction, invisible.

- [ ] **Step 3: Update the CSS**

At `:543` — replace the unbounded floor with a real page box:

```css
.sop-print-page {
  box-sizing: border-box; width: 8.5in; height: 11in; overflow: hidden;
  /* …existing declarations unchanged… */
}
.sop-print-page-overflowing { height: auto; min-height: 11in; overflow: visible; }
```

`overflow: hidden` is deliberate teeth. The original bug survived because overflow was *visible* — the preview looked merely long rather than wrong, so nothing flagged it. Clipping on screen turns a silent print defect into an obvious preview defect. `.sop-print-page-overflowing` is the single sanctioned exception, applied only when `PagePlan.overflowing` is set.

At `:655` — swap fluid reflow for a scaled sheet so breaks match print at every
viewport. The scale is computed, not a dangling CSS variable, and uses `zoom`
(supported in all evergreen browsers since 2024), which — unlike `transform:
scale()` — shrinks *layout* size too, so no height compensation is needed:

```tsx
const PAGE_WIDTH_PX = 816; // 8.5in × 96dpi
const [pageScale, setPageScale] = useState(1);
// In an effect: ResizeObserver on the .sop-preview-scroll element →
// setPageScale(Math.min(1, (scrollEl.clientWidth - 32) / PAGE_WIDTH_PX));
```

```tsx
<div className="sop-print-pages" style={{ zoom: pageScale }}>
```

Remove the `width: 100%; min-height: auto` override on `.sop-print-page` inside
`@media (max-width: 1100px)` — pages keep true geometry at every viewport, only
their rendered size shrinks. (The attachment-page aspect-ratio override in that
media block stays.)

- [ ] **Step 4: Add the fallback path**

Keep the current hand-assigned JSX (today's page 1, annex summary, control page)
behind the fallback branch — moved, not deleted. Render it when:

```ts
const fallback = failed || (measuring && sectionPages.length === 0);
```

`measuring && empty` covers first paint before fonts settle; `failed` covers a
measurement throw. In the fallback branch `totalPages` reverts to today's
arithmetic — the plan-derived count would read 0:

```ts
const totalPages = fallback
  ? (hasAttachedForms ? 3 : 2) + flowPages.length
  : sectionPages.length + flowPages.length + trailingPages.length;
```

One long page beats no document — this component gates approvals.

- [ ] **Step 5: Warn on overflow**

For each page where `overflowing` is set:

```ts
console.warn(
  `SOP ${sop.meta.sopNumber || sop.id}: block "${blockId}" is taller than one page and cannot be split; it will overflow its sheet.`,
);
```

- [ ] **Step 6: Run the full suite**

```bash
npm run typecheck && npm run lint && npm test
```

Expected: all clean, all tests passing.

- [ ] **Step 7: Commit**

```bash
git add src/components/sop/sop-print-preview.tsx
git commit -m "feat: render SOP preview from the measured page plan"
```

---

### Task 5: Live verification

**Files:** none — verification only.

**Interfaces:**
- Consumes: the running app.
- Produces: confirmation, or defects to fix before merge.

CLAUDE.md is explicit that a green suite does not prove a rendered screen. Drive it.

- [ ] **Step 1: Start the dev server**

Use the preview tooling (never Bash for dev servers): `preview_start` with `{name: "dev"}`.

- [ ] **Step 2: Open SOP-QAS-### Document & Records Control**

The SOP that exposed this. Confirm: no sheet is taller than 11in; the Procedure splits mid-paragraph; continuation sheets show `Procedure (cont.)`; every sheet has the ANA header and the confidentiality footer.

- [ ] **Step 3: Check a short SOP**

Must still be a single page. This is the regression that matters — short SOPs were never broken.

- [ ] **Step 4: Check an SOP with attached forms**

Attachment sheets still render at full bleed and are counted in "of M".

- [ ] **Step 5: Check the footer count against reality**

Open the browser print preview. The physical count of *main-document* sheets must
equal the "of M" in the footer — this is the assertion the old code could never
satisfy. Appendix sheets sit outside M by design (as today): they carry their own
"Appendix · Page x of y" label and no document footer.

- [ ] **Step 6: Check the console**

`read_console_messages` — no errors, and no overflow warnings on these SOPs.

- [ ] **Step 7: Check review mode**

Open an SOP in review. Scroll through a split Procedure and confirm the review panel still reports "Procedure" across the break — the `data-review-category` continuity requirement.

- [ ] **Step 8: Check the signature reveal still resolves**

Open a signed SOP with `revealSignatureId` set (arrive via the approval flow that
triggers it). The effect at `:325` scrolls to `[data-signature-id="…"]`; confirm the
element still exists after pagination and the reveal animation plays. Pagination moves
the approvals table onto a computed page, so this lookup is the one piece of existing
behaviour that could silently no-op.

- [ ] **Step 9: Commit any fixes and push**

```bash
git push -u origin feat/sop-measured-pagination
```

---

## Follow-up, not in this plan

The collapsed Procedure prose — 6 of 24 SOPs whose Procedure contains no newline at all. Scoped in the spec, not designed. Mirrors the Responsible Persons collapse fixed 2026-07-25 (`responsible-persons.ts` + `20260725190000_split_collapsed_responsible_persons.sql`): a parser plus a backfill migration. This plan is deliberately independent of it — the `Range` splitter handles unbroken paragraphs either way.
