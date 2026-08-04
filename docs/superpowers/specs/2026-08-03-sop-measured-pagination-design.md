# SOP print preview: measured auto-pagination

**Date:** 2026-08-03
**Status:** Approved, not yet implemented
**Area:** `src/components/sop/sop-print-preview.tsx`, `src/domain/sop/`

## Problem

`SopPrintPreview` assigns content to pages by hand. The page count is structural,
never measured:

```ts
// sop-print-preview.tsx:342
const totalPages = (hasAttachedForms ? 3 : 2) + flowPages.length;
```

Only the flowchart sheets are genuinely paginated (`buildProcedureSvgPages`).
Everything else is placed by hand. "Page 1" is a single `<article>` holding seven
sections — Purpose, Scope, Definitions, Responsible Person(s), References,
Measurement, and the entire Procedure narrative.

The page box has a floor but no ceiling:

```css
/* sop-print-preview.tsx:543 */
.sop-print-page { width: 8.5in; min-height: 11in; }  /* no max-height */
```

So the sheet grows to whatever its content needs. On SOP-QAS-### (Document &
Records Control) that is several sheets' worth of prose in one logical page.

### Why it degrades silently in print

```css
/* sop-print-preview.tsx:668-671 */
.sop-print-page { width: 8.5in; height: 11in; min-height: 11in;
                  break-after: page; page-break-after: always; }
```

Print pins the height at 11in, but the content is taller and overflow is
visible, so it spills across physical sheets. `DocumentHeader` and
`DocumentFooter` render **once per `<article>`**
(`sop-print-preview.tsx:103`, `:105`), so spilled sheets carry no ANA header, no
confidentiality footer, and no page number — and the printed sheet count does
not match the "Page 1 / 5" the footer claims. The `break-inside: avoid` on
`.sop-export-section` (`:574`) cannot help, because the sections' parent is a
fixed-height overflow box.

This survived because `min-height` reads like a page size but is a *minimum*.
Short SOPs fit inside 11in, so the floor was also the ceiling. Only a
content-heavy SOP exposes it.

### Coupled defect: collapsed Procedure prose

The Procedure body on affected SOPs is a run-on: capitalised list items joined by
commas ("…operational suitability, Define affected users and training
requirements, Review and approve documents…"). This is stored data, not
rendering — `.sop-export-section p` already sets `white-space: pre-wrap`
(`:580`), which is why Purpose renders its hyphen bullets correctly. The
Procedure field lost its newlines during extraction; `processFlowDescription` is
a bare `{ type: "string" }` (`src/domain/sop/extraction.ts:131`).

Measured against production (project `neaadefipcpxxcqszpud`, 24 SOPs):

| Metric | Count |
|---|---|
| SOPs total | 24 |
| Procedure longer than 400 chars | 8 |
| …of those, containing **no newline at all** | 6 |
| Matching the comma-joined-capitals signature | 4 |

**This couples the two defects.** Splitting prose at paragraph boundaries cannot
fix the 6 no-newline SOPs — the whole Procedure is one unbreakable block. The
paginator must be able to break *inside* a run of text. The prose fix is tracked
separately; this design must not depend on it landing first.

## Non-goals

- Fixing the collapsed Procedure prose. Separate work; this design is correct
  whether or not it lands.
- DOCX export pagination. Word flows content itself; `export-docx.ts` is
  untouched.
- Optimal page balancing. Greedy fill is sufficient; a sparse final sheet is
  cosmetic.
- Re-verifying `buildProcedureSvgPages`. Flowchart sheets are already paginated
  and pass through unchanged.

## Prior risk, retired

Review annotations are stored as `pageNumber` + `xPercent`/`yPercent`
(`src/lib/sop/review-annotations.ts`), so repagination could in principle
invalidate stored coordinates. Investigation retired this risk:

- `sop_review_annotations` holds **0 rows** in production.
- `onAnnotate` / `onSelectAnnotation` are never passed by any of the five
  `SopPrintPreview` call sites — the pin feature is wired but dormant.
- `addSopReviewAnnotation` has no callers.
- The feature that *is* used, `saveSopReviewRemark`, is keyed by `category` and
  carries no page number, so it is unaffected by construction.

No migration is required. The table does double duty — pins (`category:
"overall"` + coordinates) and section remarks (real category, no coordinates) —
and only the dormant pin half is page-coupled.

## Approach

Three options were weighed.

**A. Structural boundaries only** — break between paragraphs and list items.
Pure, no DOM geometry. Rejected: cannot split the 6 no-newline SOPs, which is
exactly the failing case.

**B. Structural boundaries + `Range`-based text fragmentation** — *chosen.*
Split into leaf blocks at newlines and list items; for any leaf still taller than
a page, binary-search a DOM `Range` over the already-rendered text to find the
character offset crossing the page boundary. Range geometry is queried without
re-rendering: one offscreen render plus cheap rect lookups. Handles arbitrary
text and keeps working after the prose fix lands.

**C. Re-render binary search** — same result as B, but re-renders React at each
candidate offset. O(log n) renders per oversized block; janky on a 5-page SOP.

## Architecture

The algorithm is pure; the measuring is React. This follows the split CLAUDE.md
already mandates (domain logic pure and tested, no React/DOM).

```
sop ──► buildBlocks(sop)          pure    sections → leaf blocks
     ──► offscreen render          DOM    fixed 8.5in width, after fonts.ready
     ──► measure + Range splits    DOM    heights, then offsets for oversized leaves
     ──► packBlocks(...)          pure    greedy fill → PagePlan[]
     ──► <DocumentPage> × N        React  real sheets, header + footer each
```

### `src/domain/sop/pagination.ts` (+ `pagination.test.ts`)

```ts
packBlocks(blocks: MeasuredBlock[], usableHeight: number): PagePlan[]
```

Pure. No React, no DOM, no Supabase. Consumes blocks that already know their
height and emits a page plan. All layout policy lives here:

- a heading never orphans from its first line (`keepWithNext`)
- a fragment continuing from the previous page carries `continued: true`
- minimum 2 lines either side of a split inside a paragraph
- a block taller than `usableHeight` is emitted with a requested split offset
- an indivisible block taller than `usableHeight` is emitted alone, flagged

Testable with synthetic heights, so tests stay deterministic. jsdom performs no
real layout, which is precisely why the policy must not depend on measurement.

### `src/components/sop/use-paginated-pages.ts`

The DOM half. Renders blocks into an offscreen container fixed at true page
width, measures each with `getBoundingClientRect`, resolves oversized leaves to
character offsets via `Range`, calls `packBlocks`, returns the plan.

### `sop-print-preview.tsx`

Consumes the plan and renders real `DocumentPage`s. The file is 942 lines today;
moving pagination out keeps it from growing further.

## Block model

Sections decompose into leaf blocks before measurement:

| Source | Leaf blocks | Splittable |
|---|---|---|
| `<h2>` heading | one | no — `keepWithNext` |
| Prose paragraph | one per newline-delimited line | yes, via `Range` |
| `.sop-export-list` | one per `<li>` | no |
| `.sop-export-table` | one per `<tr>` | no — header row repeats on continuation |
| Flowchart SVG | one | no — pre-paginated, passes through |

Continuation pages repeat the section heading marked `(cont.)`, so a reader
holding sheet 3 alone knows which section they are in. Omitting it is a routine
document-control audit finding.

Usable height is **measured per SOP, not hardcoded**. The header is
`min-height: 1.12in` but grows when a long title wraps, so the packer reads
actual header and footer heights rather than assuming ~8.3in.

## Scope

All prose pages, not just page 1:

- Page 1's seven sections
- The Annexes / Change History / Change Approvals pages

The trailing pages carry the identical latent bug and are table-driven — tables
are exactly what grows over a document's life, so a SOP with enough revisions
would reproduce this. One engine covers both.

## Rendering changes

`totalPages` becomes `plan.length + flowPages.length + attachmentPages.length`,
derived from the plan instead of the hand-count at `:342`. "Page N of M" becomes
truthful.

CSS changes are small and targeted:

- `.sop-print-page` gets `height: 11in` (replacing unbounded `min-height`) plus
  `overflow: hidden` **on screen**. A packing bug then shows up immediately in
  preview instead of hiding until print. The current bug survived precisely
  because overflow was visible — the preview looked merely long rather than
  wrong.
- One deliberate exception: a page carrying an oversized indivisible atom gets a
  `.sop-print-page-overflowing` modifier that restores `overflow: visible`.
  Without it the clip introduced above would silently swallow the very content
  the escape hatch exists to preserve. This modifier is the *only* way a page
  renders taller than 11in, and it always comes with the `console.warn` below.
- The `@media print` block largely stops mattering: content already fits, so
  `break-after: page` finally does what it always claimed.
- The `@media (max-width: 1100px)` rule at `:655` changes from fluid reflow to
  `transform: scale()` on a fixed sheet, so page breaks are identical at every
  viewport. What is approved on a laptop is what prints.

## Edge cases

### Handled

| Case | Mechanism |
|---|---|
| Long prose with newlines | split at line leaves |
| Long prose with no newlines (6 SOPs) | `Range` binary search |
| Change History / Approvals growing over time | per-`<tr>` split, header repeats |
| Long Measurement list | per-`<li>` |
| Heading stranded at page bottom | `keepWithNext` |
| Long title wrapping the header taller | usable height measured per SOP |
| Flowchart + attachment sheets | pass through, already fixed-size |
| Widow/orphan inside a split paragraph | minimum 2 lines either side |
| Leading whitespace at a split point | trimmed on continuation |

### Hazards, mitigated

- **Webfont timing.** Measuring before fonts settle makes every height wrong by a
  few percent, reproducing only on cold loads. Gate the measure pass on
  `await document.fonts.ready`; re-measure via `ResizeObserver` on the offscreen
  container.
- **Re-measure churn.** The editor live-updates `sop`, so the plan recomputes on
  change — debounced, or every keystroke reflows five pages.
- **Review-mode category tracking.** `handleReviewScroll` reads
  `data-review-category` to drive the review panel. Every fragment, *including
  continuations*, must carry the attribute, or scrolling a split Procedure
  reports the wrong section.
- **Signature reveal.** `revealSignatureId` scrolls to `[data-signature-id]`;
  the element must remain in the DOM after pagination.

### Accepted limitations

- Greedy fill, so the final sheet may be sparse.
- A single indivisible atom taller than a page (one table cell holding pages of
  text, an unbreakable URL) gets its own page carrying the
  `.sop-print-page-overflowing` modifier — visible overflow — plus a
  `console.warn` naming the SOP and block. Ugly output is honest output: in an
  ISO-controlled document, silently clipped text is far worse than obviously
  broken layout, and the warning identifies what to fix. `console.warn` for
  degraded non-fatal paths is the established convention in this codebase.

## Error handling

Every failure degrades to *today's* behaviour rather than a blank preview. One
long page beats no document — `SopPrintPreview` is what reviewers and approvers
sign against, so a preview that failed closed would block approvals outright.

| Failure | Behaviour |
|---|---|
| Measurement throws, or `fonts.ready` rejects | unpaginated single page, `console.warn` |
| Oversized indivisible atom | own page, visible overflow, `console.warn` |
| Empty plan (no content) | one page with em-dash placeholders, as now |

## Testing

- **`pagination.test.ts`** — the pure packer against synthetic heights: exact
  fit, one-pixel overflow, heading-orphan prevention, continuation flags, table
  header repetition, the min-2-lines rule, the oversized-atom escape hatch.
- **`buildBlocks` tests** — section → leaf decomposition, including the
  no-newline paragraph case.
- **Live verification** (CLAUDE.md: a green suite does not prove a rendered
  screen) — drive in the browser:
  1. SOP-QAS-### Document & Records Control, the SOP that exposed this
  2. a short SOP — must remain 1 page, no regression
  3. one with attached forms
  4. print preview: physical sheet count matches the footer's "of M"

## Open follow-up

The collapsed Procedure prose (6 of 24 SOPs with zero newlines). Investigated and
scoped above; fix not designed here. A parser plus a backfill migration, mirroring
the Responsible Persons collapse fixed 2026-07-25 (`responsible-persons.ts` +
`20260725190000_split_collapsed_responsible_persons.sql`) — same failure shape,
same two-part remedy.
