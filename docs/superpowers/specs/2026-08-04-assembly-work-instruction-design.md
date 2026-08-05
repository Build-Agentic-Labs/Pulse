# Assembly work instruction: ISO-conformant ledger template

**Date:** 2026-08-04
**Status:** Approved, not yet implemented
**Area:** `src/domain/work-instruction/`, `src/components/work-instruction/`,
`app/projects/[projectId]/planner/work-instructions/print/`, Work Instructions
module in `src/components/line-workspace/setup-panels.tsx`

## Problem

The Product space has a Work Instructions module that counts work instructions
but cannot produce one.

`WorkInstructionsPanel` (`setup-panels.tsx:404`) lists every leaf work-task
grouped by zone and labels each **Incomplete → Ready → Created**, where "Ready"
means the task's steps carry both tools and quality checks
(`setup-panels.tsx:425`). Clicking a row navigates to the Procedure module. The
`Task.workInstructionLink` field holds an external URL.

So the page's whole vocabulary — "ready to **generate**", "**Created**" — points
at a generator that does not exist. The tools+checks gate is literally a test for
"is there enough data to fill a work instruction yet", and nothing consumes it.

Meanwhile the data to fill one is already there and largely unused:

```
Task                                   ManufacturingStep
├── manufacturingCode                  ├── sequence
├── name / description                 ├── name
├── plannedDurationMinutes             ├── instruction
├── plannedOperators                   ├── durationMinutes
├── safetyNotes                        ├── qualityCheck ──► getManufacturingStepCheckState()
├── toolsRequired[]                    └── partReferenceIds[]
├── equipmentRequired[]
├── materialKit                        customFields (step-id keyed maps)
├── partReferences[]                   ├── stepToolLists    ──► getStepToolList(task, stepId)
├── drawingLink / sopLink              └── stepPhotoAttachments ──► StepPhotoAttachment[]
└── qualityGate                                                    (dataUrl, caption, annotations)
```

The step-id-keyed maps in `customFields` are the important discovery: **tools and
photos are step-scoped, not task-scoped**. `getTaskStepToolListMap`
(`step-tools.ts:16`) and `STEP_PHOTO_ATTACHMENTS_FIELD` (`step-photos.ts:3`) both
key by step id. Any layout that hoists tools to a task-level sidebar would be
displaying a rollup the schema does not natively hold.

The document number generator also already exists and is already displayed:
`documentDisplayCode(task, "WI", 1)` (`nomenclature.ts:110`) returns
`{manufacturingCode}-WI1`, rendered in the task drawer at `drawer.tsx:509` as
"Work instruction code pending" when unset. `stepDisplayCode`
(`nomenclature.ts:125`) extends it per step.

## Decision history

Four decisions were taken during brainstorming, recorded here because two of them
overrode the recommendation.

1. **Deliverable: generated, with blank fallback.** Not a static form, and not
   generation only. One renderer, two states.

2. **Document control: out of scope for now.** The user's words: *"for now lets
   just build the W.I then we will implement a control process and library
   similar to the SOP system we have."* So no lifecycle, no migrations, no
   signatures in this phase — but the metadata shape is designed so the later
   control layer is a data-source swap, not a rewrite.

3. **Layout: photo-first 3×2 grid (option B), against the recommendation of a
   left-rail 2×2 (option A).** The recommendation was wrong on the merits: it was
   argued from a Task/ManufacturingStep split that put tools at task level, and
   the schema puts them at step level. B's per-card tool list is the accurate
   rendering. B also yields 6 steps per sheet instead of 4.

4. **Card is split horizontally, not stacked.** At true ledger dimensions a 3×2
   card is 5.25 × 4.32in. A full-width photo band across it is a wide letterbox
   that crops every 4:3 shop photo. Photo left, text right gives the photo a
   2.45 × 3.20in box that holds both portrait and landscape shots under
   `object-fit: contain`.

5. **No signature surface anywhere** (added 2026-08-04, after first review).
   The user's reasoning: *"i dont think we will have a signature area in the
   Assembly work instructions since these will be repeated - we can reference a
   checklist action if we need a signature on the action item."* A work
   instruction is a reusable master reprinted for every build, so both the
   document-level Prepared/Reviewed/Approved-by blocks **and** the per-card
   Op/QA initials boxes are gone. Where a signature is required it belongs on
   the referenced checklist action. The revision-history table stays — it is a
   document-control record, not a signature.

6. **Sheet 1 carries the first three steps** (added 2026-08-04, same review):
   *"the first page can start to show some of the procedure already. to try to
   conserve page count."* The setup band is sized to exactly one card row, so
   the bottom half of sheet 1 is a normal row of three cards. An 8-step
   instruction drops from three sheets to two.

7. **Long steps continue onto further cards; they are never handed back to the
   author** (added 2026-08-04, same review): *"this text should be broken into
   chunks as well."* This replaces the original design's "flag it and tell the
   author to split the step", which pushed page geometry onto the person least
   able to see it.

8. **Document control moves entirely into the header** (added 2026-08-04,
   second review): *"for the header lets do the Revision, effective table -
   then revision history - then production data in the header. this will allow
   us to remove the revision history from the sheet canvas."* The header grew
   to 1.20in to hold it. Because the header is on every sheet, every card row
   shrinks equally, so cards stay a uniform size.

9. **A material kit is a part number** (same review): *"combine material kits
   and parts - a kit will be a part number in that list."* The separate
   Material kit block is gone and `materialKit` is folded into `parts` as the
   first row, which is also the order it is picked in.

10. **Every setup container is the same height** (same review): *"Make all the
    containers in the sheet canvas the same fixed height as the tools and
    equipment, dont change the procedure items."* One block per column, all
    stretched to the band height, so the band reads as a single rank of boxes.
    Step cards were explicitly left alone.

11. **"No photo" is not the same as "write here"** (added 2026-08-04, third
    review). One class, `.wi-card-photo-empty`, was doing both jobs: ruled
    writing lines for a blank template slot, reused as the placeholder when a
    real step simply had no photo. A populated card therefore printed a ruled
    writing box where its photo belonged. Split into `.wi-card-photo-missing`
    (flat, labelled "No photo", reads as absence) and `.wi-rule-lines` (the
    blank form's writing surface, and only that).

12. **One sentence per step** (same review): *"the text should also just be one
    sentence for each step."* This is an authoring convention, not a truncation
    rule — the sample models it and a test enforces it there. Real
    multi-sentence steps still flow onto continuation cards rather than being
    cut, because silently dropping half an assembly instruction is a safety
    problem. Enforcement in the authoring UI is not built.

13. **Header trimmed to 1.05in** (same review), which grows every card to
    5.25 × 4.25in.

14. **The card grid is a layout variant, not a fork** (added 2026-08-04, fourth
    review): *"can you create a v2 to show me what 4 work instructions per page
    max would look like? mainly for a bigger photo. On the first page just show
    2 steps."* `WORK_INSTRUCTION_LAYOUTS` holds both; pagination, text budgets
    and the CSS grid all read from it, the last via custom properties. Two
    renderers would have drifted within a week.

    | | v1 | v2 |
    |---|---|---|
    | Grid | 3×2 | 2×2 |
    | Steps per sheet | 6 | 4 |
    | Steps beside the setup band | 3 | 2 |
    | Card | 5.25 × 4.25in | 7.94 × 4.25in |
    | **Photo** | **2.45 × 3.53in** | **4.40 × 3.53in** |
    | Text budget (measured) | 600 (worst case 685) | 880 (worst case 954) |

    The trade is sheets for photo size: nine steps is 2 sheets in v1 and 3 in
    v2. Preview either at `/design/work-instruction` and `?v=2`.

15. **A placeholder must not draw what its container already provides** (same
    review). Twice now the step photo has read as two nested boxes: first from
    the fixture SVG's own inset stroke, then — once v2 made the slot landscape
    while the SVG stayed portrait — from `object-fit: contain` pillarboxing a
    contrasting fill into a visible inner rectangle. The placeholder now draws
    no frame and fills with `.wi-card-photo`'s exact background, which holds at
    any aspect ratio. Real photos still letterbox against that neutral, which is
    correct behind a photograph.

## Page geometry

```
@page { size: 17in 11in; margin: 0; }
```

Explicit dimensions, **not** the `ledger` keyword. CSS Paged Media defines
`ledger` as 11in × 17in — portrait — and browsers disagree about how
`size: ledger landscape` resolves. Explicit `17in 11in` is unambiguous.

Sheet padding `0.45in 0.5in 0.35in`, giving a 16.0in content column and 10.20in
of content height.

A step sheet, and sheet 1 where the setup band takes the first card row:

```
┌─ 17in ───────────────────────────────────────────────────────────────┐
│ ┌──────────────────────────────────────────────────────────────────┐ │
│ │ logo │ title + doc no. │ rev/eff/product/sheet │ rev history │ PD │ │  1.05in
│ └──────────────────────────────────────────────────────────────────┘ │
│ ┌──────────────────────────────────────────────────────────────────┐ │
│ │ purpose │ safety │ tools │ parts │ references   (setup band)      │ │  4.25in
│ └──────────────────────────────────────────────────────────────────┘ │  11in
│ ┌────────────┐ ┌────────────┐ ┌────────────┐                         │
│ │  step 1    │ │  step 2    │ │  step 3    │                         │  4.25in
│ └────────────┘ └────────────┘ └────────────┘                         │
│ ┌──────────────────────────────────────────────────────────────────┐ │
│ │ ANA INC. CONFIDENTIAL …                          Page 1 of 3     │ │  0.30in
│ └──────────────────────────────────────────────────────────────────┘ │
└──────────────────────────────────────────────────────────────────────┘
```

Height closes as `1.05 + 4.25 + 4.25 + 0.30 + 0.36 gaps = 10.21in`. Width closes
as `(16.0 − 0.24 gaps) / 3 = 5.25in` per card.

The setup band occupies row 1 of the same two-row grid the step sheets use, so a
card is 5.25 × 4.25in wherever it lands. Growing the header shrinks both rows
equally on **every** sheet, which is why cards stay uniform.

Card internals, 5.25 × 4.25in with 0.1in padding:

| Element | Size |
|---|---|
| Header row — step no. badge, name, part label, duration, `stepDisplayCode` | 0.28in, full width |
| Photo box (left) | 2.45w, `object-fit: contain` |
| Text column (right) | 2.50w — instruction, tools, checks |
| Caption | 0.14in |

A continuation card drops the photo column, so its text runs the full 5.05in.

The instruction budget is **measured, not derived**. Binary-search the rendered
box (Chrome, `/design/work-instruction`) for the point where `scrollHeight`
first exceeds `clientHeight`.

Measure the **worst case**, not whatever the sample happens to contain: a card
crowded with all five check types and a six-tool list, since checks and tools
share the text column. That reads **645** at a 1.20in header and **685** at 1.05in.
`INSTRUCTION_BUDGET_CHARS` stays **600** through both — more headroom than the
~7% convention, kept because steps are authored one sentence long and raising it
buys nothing. A continuation card runs the full width and holds **1,851**;
`CONTINUATION_BUDGET_CHARS` is **1700**.

The first-principles estimate was 360, which would have split steps that fit
with room to spare. If the card layout changes, re-run the measurement rather
than re-deriving it — both values were re-measured after the header grew to
1.20in and both held.

## Document anatomy

### Header band — every sheet

Mirrors `DocumentHeader` in `sop-print-preview.tsx:47`, widened for ledger:

- ANA logo, `/sop/ana-logo.png`, 150 × 42 (same asset, same box as the SOP)
- Document number `documentDisplayCode(task, "WI", 1)` and title (task name)
- Revision / effective date / `Page N of M`
- Compact PPE icon strip derived from `task.safetyNotes`

The PPE strip is the deliberate fix for layout B's one weakness. In a pure B
layout, safety data would live only on sheet 1 and an operator working from
sheet 3 would have to flip back. Hazard information appears on every sheet.

### Footer — every sheet

Product / zone / manufacturing code on the left, `Page N of M` on the right, and
the confidentiality line copied verbatim from `sop-print-preview.tsx:67`:

> ANA INC. CONFIDENTIAL: This copyrighted work and all information is the
> property of ANA INC. All rights reserved

### Sheet 1 — setup band plus the first three steps

ISO 9001:2015 §7.5 asks that documented information carry identification,
format, review and approval. The setup band is where the non-step content
lives. It occupies the top card row of sheet 1; the bottom row is three real
step cards.

| Block | Source |
|---|---|
| Purpose / scope | `task.description` |
| Safety & PPE | `task.safetyNotes` |
| Tools & equipment | union of `getTaskStepToolListMap(task)` values + `task.toolsRequired` + `task.equipmentRequired` |
| Parts / materials | `task.materialKit` as the first row, then `task.partReferences[]` (part no., description, qty) |
| Reference documents | `task.drawingLink`, `task.sopLink` / `sopId` |

Production data and the revision history live in the **header**, not here — see
decision 8. There is deliberately no approvals block either (decision 5). The
revision history renders empty in this phase and is the seam the control layer
plugs into: `WorkInstructionMeta` declares the fields, the header already draws
the table, and phase 2 supplies rows instead of blanks.

One block per column, every container the same height (decision 10), so the band
reads as a single rank of boxes. The leftover inside each is useful ruled space
for handwritten notes.

### Step sheets — 3×2 cards

Each card renders, in order: step number badge, step name, part label when the
step is continued, planned duration, `stepDisplayCode`, photo with caption,
instruction text, per-step tools from `getStepToolList(task, step.id)`, and
quality-check chips from
`getManufacturingStepCheckState(step.qualityCheck, definitions)`
(`manufacturing-step-checks.ts:133`).

No initials boxes — see decision 5. The printed sheet is a reusable master, not
a per-build traveler.

## Architecture

Modelled on `work-order-print.tsx`, which is the closest precedent in the repo: a
**pure render with no data fetching**, shared by two routes, with paper colors
hardcoded rather than themed so it prints identically in light and dark app
themes (`work-order-print.tsx:3-13`).

| Layer | File | Responsibility |
|---|---|---|
| Domain | `src/domain/work-instruction/schema.ts` | `WorkInstruction`, `WorkInstructionMeta`, `WorkInstructionCard`, `WorkInstructionSheet` |
| Domain | `src/domain/work-instruction/build.ts` | `buildWorkInstruction(task, product, zone, component)` — pure |
| Domain | `src/domain/work-instruction/split-instruction.ts` | `splitInstruction(text, first, rest)` → chunks — pure |
| Domain | `src/domain/work-instruction/paginate.ts` | `paginateWorkInstruction(wi)` → sheets — pure |
| Domain | `src/domain/work-instruction/sample.ts` | Fixture for `/design/work-instruction`, built through `buildWorkInstruction` |
| UI | `src/components/work-instruction/work-instruction-document.tsx` | Pure render, no fetching |
| UI | `src/components/work-instruction/work-instruction-print.tsx` | Preview shell, print bar, loading/error states |
| Route | `app/projects/[projectId]/planner/work-instructions/print/page.tsx` | Reads `?taskIds=`, loads state, renders |

Data flow:

```
Work Instructions panel row
  └─ "Generate" ─► router.push(
                     `/projects/${projectId}/planner/work-instructions/print`
                     + `?taskIds=${ids}&scenarioId=${scenarioId}`)
                                    │
       print route ────────────────►│ loadPlannerStateFromSupabase(projectId, scenarioId)
       (supabase-planner.ts:2597)   │
                                    ▼
                         buildWorkInstruction(task, …)   ── pure, tested
                                    ▼
                         paginateWorkInstruction(wi)     ── pure, tested
                                    ▼
                         <WorkInstructionDocument />     ── pure render
```

Comma-separated `taskIds` batch multiple documents into one print job, matching
`work-order-board.tsx:262`.

Both route parameters are already reachable from `WorkInstructionsPanel`'s
existing props — no new prop threading is needed: `projectId` from
`product.projectId` (`types.ts:93`) and `scenarioId` from `task.scenarioId`
(`types.ts:273`). If `product.projectId` is absent the Generate action is
disabled rather than pushing a route that cannot load.

### Why pagination is trivial here

`sop-print-preview` needs *measured* pagination — an offscreen measurement tree,
`offsetTop` deltas, an overflow class — because SOP content is variable-height
prose that must flow across pages (`use-paginated-pages.ts`,
`domain/sop/pagination.ts`).

A fixed 3×2 grid has slots of known size, so pagination is arithmetic: three
cards onto sheet 1 beside the setup band, then `chunk(rest, 6)`. Pure,
synchronous, unit-testable, no DOM.

The variable-height problem does not disappear — it moves into
`splitInstruction`, where it is solved once against a measured character budget
rather than by measuring the DOM on every render. Choosing a rigid grid is what
made that trade available, and it is the main reason the build is small.

### Styles

An inline `PRINT_STYLES` template const inside the document component, matching
both existing print documents (`work-order-print.tsx:56`,
`sop-print-preview.tsx:745`). CLAUDE.md forbids feature styles in
`app/globals.css`; a component-owned const satisfies that and reads like the
surrounding code.

## Blank template mode

The same renderer with no data bound. Reached two ways:

- `?blank=1` on the print route, for a printable empty form
- automatically, when a task has no `manufacturingSteps`

Every slot keeps its fixed height and prints ruled lines instead of collapsing —
that is the single rule that makes one component serve both states. A card with
no photo draws an empty ruled photo box, never a shrunken card. Sheet 1 draws all
its blocks with ruled blank rows.

Blank mode emits one setup sheet plus one step sheet of six empty cards.

16. **v2 is the default, and the app generates it** (2026-08-04, fifth review).
    `DEFAULT_WORK_INSTRUCTION_LAYOUT` is v2; the standalone `CARDS_PER_SHEET` /
    `INSTRUCTION_BUDGET` constants are now *derived* from it, so flipping the
    default cannot leave them describing a layout the app no longer produces.
    Work Instructions rows carry a **Preview** action, the header a **Preview
    all** batch and **Blank template**, and the print toolbar carries a v1/v2
    switch (`?v=`) plus the ledger print settings.

17. **The text budget is in LINES, not characters** (same review) — found on
    real data, not the sample. FlexBoost CLU-SUB-10 step 1 is 487 characters
    that pass an 880-character budget, and it was **silently clipped**: those
    487 characters are 17 hard lines which `white-space: pre-wrap` renders as 20
    visual lines into a box holding 18. A character count is only a proxy for
    height when text actually flows, and the original measurement used
    continuous filler that never wrapped like authored text.

    `estimate-lines.ts` now models wrapping (`sum of max(1, ceil(len /
    charsPerLine))` per hard line) and every budget is `{ lines, charsPerLine }`,
    measured per card shape with a detached probe. The splitter packs whole hard
    lines and **preserves the author's line breaks** — operators write steps as
    blank-line-separated sub-actions, and reflowing them into a paragraph to save
    space destroys the structure they wrote.

    | | chars/line | lines (crowded) |
    |---|---|---|
    | v1 first / continuation | 45 / 91 | 16 / 19 |
    | v2 first / continuation | 58 / 139 | 16 / 19 |

    Verified across the whole FlexBoost project: 25 documents, 49 sheets, 97
    step cards, **0 clipped**, 9 continuations, 72 real photos.

## Long steps: continuation cards

A step whose text does not fit one card produces **several cards** — parts 1..n
of the same step — rather than being clipped or flagged.
`splitInstruction(text, firstBudget, restBudget)` breaks at sentence boundaries
where it can, word boundaries where it must, and never mid-word.

The photo, tools and duration ride on part 1; the checks ride on the last part,
where the step is actually verified. A continuation card drops the photo column
entirely and runs text the full card width, which is why it gets its own,
roughly 3× larger budget — so a long step usually needs only one continuation.

Overflow now means only one thing: a **single unsplittable token wider than the
card**. That still renders with a red outline and a "shorten this step" marker,
never clipped, following the `sop-print-page-overflowing` precedent
(`sop-print-preview.tsx:811-814`). It is the one case a human must resolve.

The budgets must be honest for any of this to work. A conservative budget splits
steps that fit, scattering one operation across cards for no reason; a generous
one clips. Hence the measured values above.

## Testing

Per CLAUDE.md, domain logic is pure and tested, and the feature is driven live
before merge.

| Test | Covers |
|---|---|
| `build.test.ts` | field mapping, step-id-keyed tool/photo lookup, missing-data fallbacks, blank construction |
| `paginate.test.ts` | chunking at 6, sheet counts, `Page N of M`, single-step and zero-step cases |
| `work-instruction-document.test.tsx` | renders populated and blank states; ruled slots present when empty; overflow class applied past budget |

Then: typecheck, lint, tests, and drive the real route in the browser at ledger
size — a green suite does not prove a rendered sheet.

## Out of scope

Deferred to the document-control phase:

- No migrations, no RLS, no new tables. Nothing here writes to the database.
- No approval workflow, no e-signatures, no RASIC seats.
- No work-instruction library or registry.
- No DOCX export.
- Revision history and approval blocks render as blank ruled boxes.

The phase-2 seam is `WorkInstructionMeta`. It declares `documentNumber`,
`revision`, `effectiveDate`, `preparedBy`, `reviewedBy`, `approvedBy` and
`revisionHistory[]` now, populated from task data or left blank. The control
layer changes where those values come from, not how they are drawn.
