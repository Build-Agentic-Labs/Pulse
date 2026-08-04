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

## Page geometry

```
@page { size: 17in 11in; margin: 0; }
```

Explicit dimensions, **not** the `ledger` keyword. CSS Paged Media defines
`ledger` as 11in × 17in — portrait — and browsers disagree about how
`size: ledger landscape` resolves. Explicit `17in 11in` is unambiguous.

Sheet padding `0.45in 0.5in 0.35in`, giving a 16.0in content column and 10.20in
of content height.

```
┌─ 17in ───────────────────────────────────────────────────────────────┐
│ ┌──────────────────────────────────────────────────────────────────┐ │
│ │ ANA logo │ title + doc no.        │ rev / date / page │ PPE strip │ │  0.90in
│ └──────────────────────────────────────────────────────────────────┘ │
│ ┌────────────┐ ┌────────────┐ ┌────────────┐                         │
│ │  step 1    │ │  step 2    │ │  step 3    │                         │  4.32in
│ └────────────┘ └────────────┘ └────────────┘                         │  11in
│ ┌────────────┐ ┌────────────┐ ┌────────────┐                         │
│ │  step 4    │ │  step 5    │ │  step 6    │                         │  4.32in
│ └────────────┘ └────────────┘ └────────────┘                         │
│ ┌──────────────────────────────────────────────────────────────────┐ │
│ │ ANA INC. CONFIDENTIAL …                          Page 2 of 4     │ │  0.30in
│ └──────────────────────────────────────────────────────────────────┘ │
└──────────────────────────────────────────────────────────────────────┘
```

Height closes as `0.90 + 4.32 + 4.32 + 0.30 + 0.36 gaps = 10.20in`. Width closes
as `(16.0 − 0.24 gaps) / 3 = 5.25in` per card.

Card internals, 5.25 × 4.32in with 0.1in padding (inner 5.05 × 4.12):

| Element | Size |
|---|---|
| Header row — step no. badge, `stepDisplayCode`, step name | 0.28in, full width |
| Photo box (left) | 2.45w × 3.20h, `object-fit: contain` |
| Text column (right) | 2.50w × 3.20h — instruction, tools, checks |
| Footer strip — duration, Op initials box, QA initials box | 0.30in, full width |
| Gaps | 0.34in |

Within the 3.20in text column: instruction ~1.6in, tools ~0.7in, checks ~0.7in.
At 9pt in a 2.5in column (~45 characters per line), the instruction budget is
roughly 8 lines ≈ **360 characters**.

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

### Sheet 1 — setup sheet

ISO 9001:2015 §7.5 asks that documented information carry identification,
format, review and approval. Sheet 1 is where the non-step content lives:

| Block | Source |
|---|---|
| Purpose / scope | `task.description` |
| Safety & PPE | `task.safetyNotes` |
| Tools & equipment | union of `getTaskStepToolListMap(task)` values + `task.toolsRequired` + `task.equipmentRequired` |
| Parts / materials | `task.partReferences[]` (part no., description, qty) + `task.materialKit` |
| Reference documents | `task.drawingLink`, `task.sopLink` / `sopId` |
| Production data | `plannedDurationMinutes`, `plannedOperators`, zone, component |
| Revision history | blank ruled table |
| Approvals | prepared by / reviewed by / approved by — blank ruled boxes |

The last two render empty in this phase. They are the seam the control layer
plugs into: `WorkInstructionMeta` declares the fields, the renderer already draws
the boxes, and phase 2 supplies values instead of blanks.

### Step sheets — 3×2 cards

Each card renders, in order: step number badge and `stepDisplayCode`, step name,
photo with caption (annotated variant when `annotations` is present), instruction
text, per-step tools from `getStepToolList(task, step.id)`, quality-check chips
from `getManufacturingStepCheckState(step.qualityCheck, definitions)`
(`manufacturing-step-checks.ts:133`), planned duration, and Op / QA initials
boxes.

The initials boxes are what let the printed sheet double as a build traveler —
carried over from the traveler-table layout that was not chosen.

## Architecture

Modelled on `work-order-print.tsx`, which is the closest precedent in the repo: a
**pure render with no data fetching**, shared by two routes, with paper colors
hardcoded rather than themed so it prints identically in light and dark app
themes (`work-order-print.tsx:3-13`).

| Layer | File | Responsibility |
|---|---|---|
| Domain | `src/domain/work-instruction/schema.ts` | `WorkInstruction`, `WorkInstructionMeta`, `WorkInstructionCard`, `WorkInstructionSheet` |
| Domain | `src/domain/work-instruction/build.ts` | `buildWorkInstruction(task, product, zone, component)` — pure |
| Domain | `src/domain/work-instruction/paginate.ts` | `paginateWorkInstruction(wi)` → sheets — pure |
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

A fixed 3×2 grid has six slots of known size. Pagination is
`chunk(steps, 6)`: pure, synchronous, unit-testable, no DOM. Choosing a rigid
grid removed an entire category of complexity, and this is the main reason the
build is small.

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

## Overflow

Overflow is **visible, never silent**, following the `sop-print-page-overflowing`
precedent (`sop-print-preview.tsx:811-814`).

An instruction exceeding the ~270-character budget renders the card with a
warning outline and a continuation marker rather than clipping the text. Silently
truncating an assembly instruction is a safety problem; the loud failure tells
the author to split the step, which is the correct fix.

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
