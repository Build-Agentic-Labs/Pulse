# SOP Measured Auto-Pagination Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace `SopPrintPreview`'s hand-assigned page count with a measured paginator so every rendered sheet is a real 8.5×11in page carrying its own header, footer, and truthful "Page N of M".

**Architecture:** Two passes. A pure greedy packer (`src/domain/sop/pagination.ts`) owns all layout policy and is unit-tested against synthetic heights. A React hook renders content into an offscreen container at true page width, measures each leaf block with `getBoundingClientRect`, and feeds the packer. `sop-print-preview.tsx` renders the resulting plan as real `DocumentPage`s.

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
- Produces: `MeasuredBlock`, `PlacedBlock`, `PlacedLineRange`, `PagePlan`, `packBlocks(blocks, usableHeight)`, and the exported constant `MIN_SPLIT_LINES = 2`. Tasks 3 and 4 depend on these exact names. `PlacedLineRange` carries `lineHeight` so a cut fragment renders as a clipping window over the whole paragraph.

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

  it("records the section to repeat as a continued heading", () => {
    const pages = packBlocks([text("para", 20)], 100);
    expect(pages[1].continuedSections).toEqual(["Procedure"]);
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

export interface PagePlan {
  blocks: PlacedBlock[];
  /** Section titles to repeat as "(cont.)" at the top of this page. */
  continuedSections: string[];
  /** Set when this page holds a single indivisible block taller than the page. */
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
): PagePlan[] {
  if (usableHeight <= 0) return [];

  const pages: PagePlan[] = [];
  let current: PlacedBlock[] = [];
  let continuedSections: string[] = [];
  let used = 0;

  function flush(overflowing = false): void {
    if (current.length === 0) return;
    pages.push({ blocks: current, continuedSections, overflowing });
    current = [];
    continuedSections = [];
    used = 0;
  }

  for (let index = 0; index < blocks.length; index += 1) {
    const block = blocks[index];

    // A heading that would end a page moves to the next one, together with enough
    // of what follows to be worth reading.
    if (block.keepWithNext) {
      const needed = block.height + minimumFirstChunk(blocks[index + 1]);
      if (needed > usableHeight - used && current.length > 0) flush();
      current.push({ blockId: block.id, continued: false });
      used += block.height;
      continue;
    }

    if (block.height <= usableHeight - used) {
      current.push({ blockId: block.id, continued: false });
      used += block.height;
      continue;
    }

    if (!block.splittable || !block.lineHeight) {
      if (current.length > 0) flush();
      current.push({ blockId: block.id, continued: false });
      used = block.height;
      // Nothing left to split: hand it out alone and let the caller show the overflow.
      if (block.height > usableHeight) flush(true);
      continue;
    }

    const lineHeight = block.lineHeight;
    const totalLines = Math.max(1, Math.round(block.height / lineHeight));
    let placed = 0;

    while (placed < totalLines) {
      const roomLines = Math.floor((usableHeight - used) / lineHeight);
      const linesLeft = totalLines - placed;

      // Too little room for a worthwhile chunk — break to a fresh page first.
      if (roomLines < MIN_SPLIT_LINES && current.length > 0) {
        flush();
        continue;
      }

      let take = Math.min(Math.max(roomLines, 1), linesLeft);
      const leftover = linesLeft - take;
      if (leftover > 0 && leftover < MIN_SPLIT_LINES) {
        take = Math.max(MIN_SPLIT_LINES, linesLeft - MIN_SPLIT_LINES);
      }

      const continued = placed > 0;
      if (continued && !continuedSections.includes(block.sectionTitle)) {
        continuedSections.push(block.sectionTitle);
      }
      current.push({
        blockId: block.id,
        continued,
        lineRange: { startLine: placed, endLine: placed + take, lineHeight },
      });
      used += take * lineHeight;
      placed += take;

      if (placed < totalLines) flush();
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

Expected: PASS, 12 tests.

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
- Produces: `PrintBlock` (a `MeasuredBlock` minus `height`/`lineHeight`, plus `render: (lineRange?: PlacedLineRange) => ReactNode`), and `buildPrintBlocks(sop, options): PrintBlock[]`. Task 3 measures these; Task 4 renders them, passing each `PlacedBlock.lineRange` straight through to `render`.

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
    const blocks = buildPrintBlocks(sopWith({ purpose: "Establish a method." }));
    const purpose = blocks.filter((b) => b.category === "purpose");
    expect(purpose[0].keepWithNext).toBe(true);
    expect(purpose[1].keepWithNext).toBeFalsy();
  });

  it("splits prose into one splittable block per line", () => {
    const blocks = buildPrintBlocks(sopWith({ purpose: "First line.\nSecond line.\nThird line." }));
    const body = blocks.filter((b) => b.category === "purpose" && !b.keepWithNext);
    expect(body).toHaveLength(3);
    expect(body.every((b) => b.splittable)).toBe(true);
  });

  // The six SOPs whose Procedure has zero newlines are exactly why a single
  // paragraph must still be marked splittable: the Range pass cuts it later.
  it("marks a paragraph with no newlines as splittable", () => {
    const blocks = buildPrintBlocks(sopWith({ purpose: "A".repeat(4000) }));
    const body = blocks.filter((b) => b.category === "purpose" && !b.keepWithNext);
    expect(body).toHaveLength(1);
    expect(body[0].splittable).toBe(true);
  });

  it("emits one non-splittable block per list item", () => {
    const blocks = buildPrintBlocks(sopWith({ measurements: ["First KPI", "Second KPI"] }));
    const body = blocks.filter((b) => b.category === "measurements" && !b.keepWithNext);
    expect(body).toHaveLength(2);
    expect(body.every((b) => b.splittable)).toBeFalsy();
  });

  it("gives every block a unique id", () => {
    const blocks = buildPrintBlocks(sopWith({ purpose: "One.\nTwo.", scope: "Three." }));
    const ids = blocks.map((b) => b.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("carries the review category onto every block so scroll tracking still works", () => {
    const blocks = buildPrintBlocks(sopWith({ purpose: "One.\nTwo." }));
    expect(blocks.filter((b) => b.category === "purpose")).toHaveLength(3);
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

Emit, in order: `purpose`, `scope`, `definitions` (one block per table row, header repeats), `responsible`, `references`, `measurements`, `procedure`, then `annexes`, `history`, and the approvals table. For each section emit a heading block with `keepWithNext: true`, then its content blocks. List and table rows are non-splittable.

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
        <p className={line ? undefined : "sop-export-empty"} data-review-category={category}>
          {line || "—"}
        </p>
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

Reuse the existing markup exactly — `sop-export-section`, `sop-export-list`, `sop-export-table` — so the CSS in `sop-print-preview.tsx` continues to apply unchanged.

Add matching tests to Step 1's suite:

```tsx
it("renders a cut fragment as a clipping window sized to its line range", () => {
  const blocks = buildPrintBlocks(sopWith({ purpose: "A".repeat(4000) }));
  const body = blocks.filter((b) => b.category === "purpose" && !b.keepWithNext);
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
  const blocks = buildPrintBlocks(sopWith({ purpose: "Short." }));
  const body = blocks.filter((b) => b.category === "purpose" && !b.keepWithNext);
  const { container } = render(<>{body[0].render()}</>);
  expect(container.querySelector("p")?.textContent).toBe("Short.");
  expect(container.querySelector("div")).toBeNull();
});
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
npx vitest run src/components/sop/print-blocks.test.tsx
```

Expected: PASS, 8 tests.

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
- Produces: `usePaginatedPages(blocks: PrintBlock[]): { pages: PagePlan[]; measuring: boolean; failed: boolean; offscreenRef: RefObject<HTMLDivElement | null> }`. Task 4 consumes all four fields.

- [ ] **Step 1: Implement the hook**

```ts
export function usePaginatedPages(blocks: readonly PrintBlock[]) {
  const offscreenRef = useRef<HTMLDivElement | null>(null);
  const [pages, setPages] = useState<PagePlan[]>([]);
  const [measuring, setMeasuring] = useState(true);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const timer = window.setTimeout(() => { void measure(); }, 150);

    async function measure(): Promise<void> {
      try {
        // Measuring before webfonts settle makes every height wrong by a few
        // percent, and reproduces only on cold loads.
        await document.fonts.ready;
        const root = offscreenRef.current;
        if (!root || cancelled) return;

        const measured: MeasuredBlock[] = blocks.map((block) => {
          const node = root.querySelector<HTMLElement>(`[data-block-id="${block.id}"]`);
          const height = node?.getBoundingClientRect().height ?? 0;
          const raw = node ? window.getComputedStyle(node).lineHeight : "normal";
          const lineHeight = Number.parseFloat(raw);
          return {
            ...block,
            height,
            lineHeight: block.splittable
              ? (Number.isFinite(lineHeight) && lineHeight > 0 ? lineHeight : height)
              : undefined,
          };
        });

        if (cancelled) return;
        setPages(packBlocks(measured, usableHeight(root)));
        setFailed(false);
      } catch (error: unknown) {
        const detail = error instanceof Error ? error.message : String(error);
        console.warn(`SOP preview pagination failed; falling back to a single page: ${detail}`);
        if (!cancelled) setFailed(true);
      } finally {
        if (!cancelled) setMeasuring(false);
      }
    }

    const observer = new ResizeObserver(() => { void measure(); });
    if (offscreenRef.current) observer.observe(offscreenRef.current);
    return () => { cancelled = true; window.clearTimeout(timer); observer.disconnect(); };
  }, [blocks]);

  return { pages, measuring, failed, offscreenRef };
}
```

`usableHeight(root)` reads the live header and footer heights out of the offscreen
container and subtracts them from the page box — never hardcoded, because the header
grows when a long title wraps.

Behaviour, in order:

1. Render nothing until the offscreen container is mounted.
2. `await document.fonts.ready` before measuring. Skipping this makes every height wrong by a few percent and reproduces only on cold loads — the worst kind of bug to chase.
3. Measure each `[data-block-id]` with `getBoundingClientRect().height`.
4. Derive `lineHeight` for splittable blocks from `getComputedStyle(node).lineHeight`, falling back to the block's own height when it resolves to `normal`.
5. Measure usable height as page height minus the live header and footer heights — never hardcoded, because the header grows when a long title wraps.
6. Call `packBlocks`.
7. Re-run on `blocks` identity change, debounced 150ms, and on `ResizeObserver` firing for the offscreen container.
8. On any throw, or if `document.fonts.ready` rejects: `console.warn` and set `failed: true`.

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

- [ ] **Step 1: Replace the hand-assigned pages**

Render `pages.map(...)` as `DocumentPage`s in place of the hardcoded page-1 block at `:714-787` and the trailing pages at `:796-855`. Flow pages and attachment pages keep their existing rendering and append after the prose pages.

```tsx
const printBlocks = useMemo(() => buildPrintBlocks(sop), [sop]);
const { pages, failed, offscreenRef } = usePaginatedPages(printBlocks);
```

Replace `:342`:

```ts
const totalPages = pages.length + flowPages.length + annexPreview.pages.length;
```

At the top of any page whose `continuedSections` is non-empty, render each as a heading reading `<title> (cont.)`, carrying the same `data-review-category`.

- [ ] **Step 2: Update the CSS**

At `:543` — replace the unbounded floor with a real page box:

```css
.sop-print-page {
  box-sizing: border-box; width: 8.5in; height: 11in; overflow: hidden;
  /* …existing declarations unchanged… */
}
.sop-print-page-overflowing { height: auto; min-height: 11in; overflow: visible; }
```

`overflow: hidden` is deliberate teeth. The original bug survived because overflow was *visible* — the preview looked merely long rather than wrong, so nothing flagged it. Clipping on screen turns a silent print defect into an obvious preview defect. `.sop-print-page-overflowing` is the single sanctioned exception, applied only when `PagePlan.overflowing` is set.

At `:655` — swap fluid reflow for a scaled sheet so breaks match print at every viewport:

```css
@media (max-width: 1100px) {
  .sop-print-pages { transform: scale(var(--sop-page-scale, 1)); transform-origin: top center; }
  /* remove the width:100%; min-height:auto override on .sop-print-page */
}
```

- [ ] **Step 3: Add the fallback path**

When `failed` is true, render the pre-existing unpaginated markup. One long page beats no document — this component gates approvals.

- [ ] **Step 4: Warn on overflow**

For each page where `overflowing` is set:

```ts
console.warn(
  `SOP ${sop.meta.sopNumber || sop.id}: block "${blockId}" is taller than one page and cannot be split; it will overflow its sheet.`,
);
```

- [ ] **Step 5: Run the full suite**

```bash
npm run typecheck && npm run lint && npm test
```

Expected: all clean, all tests passing.

- [ ] **Step 6: Commit**

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

Open the browser print preview. The physical sheet count must equal the "of M" in the footer. This is the assertion the old code could never satisfy.

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
