# SOP approvals: one source of truth, populated on conversion

**Date:** 2026-07-28
**Status:** Approved

## Decision

The **Approvals page — the department routing roster — is the source of truth** for who approves an
SOP. It decides which signatures are collected, and it is what the printed Change Approvals table
is built from, in both PDF and Word.

Two consequences:

1. **Word stops printing its own table.** It renders the same signature-derived entries the PDF
   already does.
2. **Conversion populates the roster.** Departments named in a legacy document's approval table
   are mapped to real departments in the background and added as seats, with a verification
   notice on the Approvals page so the author confirms them.

## Why

The static `sop.approvals` array on the document has no editing UI anywhere in the app. Nothing
writes it except the converter. Yet `export-docx.ts:425` prints it verbatim as "Change Approvals",
so a hand-authored SOP exports **five rows of blank names, positions and dates** onto a controlled
document.

Meanwhile the print preview builds a *different* Change Approvals table from real e-signatures
(`sop-print-preview.tsx:902`). Same section title, two sources, two answers for one SOP.

Deriving both from signatures ends the disagreement and makes the roster's authority real rather
than nominal.

## The Quality correction

"Quality is always the final approval" is already true — but **not as a row on the roster.**

Quality is the release gate: it signs `quality_approval` on the `approved → effective` edge,
separately from departmental approvals. The database forbids it holding a seat —
`'The Quality approver must not hold a review seat on this SOP'`
(`20260710123000_sop_transition_guard_v3.sql:202`, and again in `sign_sop`) — and
`sop-roster-editor.tsx:56` already filters the quality-gate department out of the addable list.

So a legacy document's **"Quality Approval" row must NOT become a seat.** Mapping it to one would
produce an SOP that passes conversion and can then never be released. It is recognised, skipped,
and reported in the notice as already covered by the Quality gate.

## Live-state findings (2026-07-28)

- Conversion already extracts the legacy approval table: `{role, name, position, date}` per row
  (`extraction.ts`), kept by `sopFromExtraction` when present (`store.ts:411`). Converted SOPs
  therefore hold real names; only hand-authored ones get the five blank defaults from
  `DEFAULT_APPROVAL_ROLES`.
- Conversion creates **no seats at all** today. `handleConvert` saves the document and navigates;
  the roster starts empty.
- Unstaffed seats are already legal in a draft: `20260715130000_allow_unstaffed_draft_sop_seats.sql`
  dropped `seat_signer_required` precisely so inferred department rows can sit in a draft, while
  `enforce_sop_review_seats_staffed_on_submit` still blocks submission until every seat has a
  reviewer. This feature needs exactly that behavior and requires no schema change to get it.
- The PDF's entry builder is ~60 lines inside a `useEffect` (`sop-print-preview.tsx:323-395`). It
  needs `getSopControl`, `listSeats`, `listSignatures`, `getSopAuthorDisplayName`,
  `listDepartments`, `listMembersForDepartments`, `listProfileNames` — none of which the Word
  exporter has, because `exportSopToDocx(sop)` takes only the document.
- `sop_review_seats` normalizes every seat to `rasic = 'responsible'` under a CHECK constraint
  (`20260723133000`), so a created seat needs no rasic decision.

## Changes

### Domain

- `SopApproval` gains `departmentCode?: string` — the validated mapping result, or absent. Additive
  to the jsonb; existing documents are unaffected.
- `src/domain/sop/approval-mapping.ts`, pure and tested:
  - `mapApprovalsToDepartments(approvals, departments)` → for each row, the matched department, or
    `quality-gate` when the row is the Quality approval, or `unmapped`. Matching is
    case-insensitive on department code and name, plus the row's `position` against
    `standardPositionTitlesForDepartment`.
  - The Quality row is detected by the matched department's `isQualityGate`, not by string
    matching on "Quality" — a department may be renamed, but the flag is the truth.

### Extraction

The tool schema gains `department` per approval row: the department the model believes signed,
named as it appears in the source. Prompt guidance instructs it to leave the field empty rather
than guess. **The hint is never trusted directly** — it is resolved against the workspace's real
departments and discarded when it matches none. The model suggests; the app decides.

### Conversion

After `saveSop`, `handleConvert` maps the extracted rows and creates one unstaffed seat per
distinct mapped department (`upsertSeat` with `signerId: null`). Seats are deliberately unstaffed:
the legacy document names a person who may not be a Pulse user, and the submit gate already
insists a real reviewer is chosen before review begins.

Seat creation failures do not fail the conversion — the document is saved and the author lands in
the editor either way, with the notice showing what did not map.

### Approvals page notice

On a converted SOP, `SopRosterEditor` shows a notice listing each legacy approval row and its
outcome: mapped to a department, skipped as the Quality gate, or unmapped and needing manual
assignment. Derived by comparing `sop.approvals` against the current seats — **no new storage and
no dismissal state**: the notice reflects reality, so it stops being interesting once the roster is
right.

### One approval-entry builder, two outputs

The PDF's inline entry-building moves to `src/lib/sop/approval-entries.ts` as
`buildApprovalEntries(sopId, client?)`, returning the existing `ApprovalSignatureEntry[]` shape.
The print preview calls it instead of inlining, and `exportSopToDocx` takes the entries as a second
argument, rendering the same rows.

This is the change that makes "source of truth" real: one function feeds both documents, so they
cannot drift again.

`sop.approvals` stays on the document as the legacy record of what the original said, and as the
input to the mapping notice. It is no longer printed.

## Deliberately not doing

- **Not adding an editor for `sop.approvals`.** The roster plus signatures is the source of truth;
  a second hand-maintained list is exactly the divergence being removed.
- **Not mapping the Quality row to a seat.** It would make the SOP unreleasable.
- **Not staffing inferred seats by matching names to users.** A legacy name is not identity
  evidence, and picking the wrong approver is worse than leaving the seat empty for the author.
- **Not blocking conversion on unmapped rows.** One odd row must not stop a document entering the
  system; the notice surfaces it instead.
- **No schema change.** Unstaffed draft seats and free-text `procedure.roles` already permit
  everything here.

## Verification

1. Domain unit tests for `mapApprovalsToDepartments`: exact code and name matches, case
   insensitivity, position-title fallback, the quality-gate row, and an unmappable row.
2. A component test that the notice lists mapped, quality-skipped and unmapped rows.
3. `buildApprovalEntries` covered by the existing print-preview behavior; a unit test asserts a
   seat with no signature still yields a row (the blank-signature case the PDF renders today).
4. `npm run typecheck`, `lint`, `test`, `build`.
5. `supabase db reset` + `supabase test db` — unchanged suites must stay green; no migration ships.
6. Drive it live: convert a Word SOP with an approval table, confirm the roster is pre-populated
   with unstaffed seats, the notice lists the outcomes including the skipped Quality row, and the
   Word export's Change Approvals matches the PDF's.
