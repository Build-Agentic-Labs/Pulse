# SOP numbering convention: DEPT-TYPE-NNN → TYPE-DEPT-NNN

**Date:** 2026-07-22
**Status:** Approved

## Decision

Document numbers flip from `DEPT-TYPE-NNN` (`QA-SOP-014`) to `{DOCTYPE}-{DEPT}-{NNN}`
(`SOP-QAS-014`). Doc type is `SOP` for everything today (DB default), so numbers read
`SOP-INV-001`, `SOP-MFG-001`, etc. Sequences stay per-(workspace, department, doc_type),
zero-padded to 3+ digits. Only the segment order and department codes change.

Target department roster (codes are the numbering identity):

| Code | Department |
|------|------------|
| INV | Inventory |
| INS | Inside Sales |
| PLN | Planning |
| PUR | Purchasing |
| LOG | Logistics |
| MFG | Manufacturing/Production |
| PRO | Process Engineering |
| SVC | Service |
| QAS | Quality (quality gate) |

## Live-state findings (2026-07-22)

- 11 departments exist. Renames needed: `SAL → INS`, `PRD → MFG`, `QA → QAS`.
  Already matching: INV, LOG, PLN, PUR, PRO, SVC.
- `OPS` (Operations) and `PRC` (Procurement) are not on the roster and are empty
  (0 members, 0 SOPs, 0 counters). Owner decision: Operations' scope is Manufacturing,
  Procurement's is Purchasing — both rows are deleted, nothing to move.
- 4 minted numbers exist: `PRO-SOP-008` (effective), `PRO-SOP-011` (in_review),
  `PRO-SOP-012` (draft), `QA-SOP-002` (draft). One draft has the `<UNKNOWN>` placeholder
  and is numbered at approval as usual.
- Counters: QA next_seq 3, PRO next_seq 13 — keyed by department **id**, so code renames
  do not reset sequences.
- The `enforce_sop_transition` trigger blocks `sop_number` changes on non-draft rows for
  every caller; the data migration must disable it around the renumber statement.

## Changes

### Database (one migration, applied to live DB)

1. **`next_sop_number` v2** — same auth, same race-safe counter bump, same
   collision-skip loop; candidate built as `TYPE-CODE-NNN`.
2. **Department renames** — `SAL → INS`, `PRD → MFG`, `QA → QAS`, matched by current
   code + name (pattern of the earlier PEN→PRO migration); aborts if the target code
   already exists in the workspace.
3. **Delete OPS + PRC** — guarded: refuses if any sops, members, or counters reference
   them.
4. **Renumber all existing SOPs** — generic rewrite, not hardcoded rows: join each
   non-deleted SOP to its department, match `OLDCODE-TYPE-NNN` against the pre-rename
   code, emit `TYPE-NEWCODE-NNN`. Updates both `sops.sop_number` and
   `document->meta->sopNumber`. Runs with the transition-guard trigger disabled inside
   the transaction. All statuses are renumbered, including effective (owner decision).

**Deliberately not rewritten:** `sop_revisions` snapshots and `sop_signatures`.
Signatures bind to the content hash of the signed snapshot; rewriting history would
break signature integrity. Past revisions remain the historical record under the old
number.

### App code

- `src/domain/sop/numbering.ts` — `formatSopNumber` / `parseSopNumber` flip to
  type-first; parse still returns `{dept, type, seq}` mapped from the new positions.
- `src/domain/sop/authoring.ts` — `previewSopNumber` → `SOP-QAS-###`.
- Doc-string/comment updates wherever `DEPT-TYPE-NNN` is described
  (`src/lib/sop/review.ts`, `src/lib/departments/store.ts`).
- Tests updated in kind: `numbering.test.ts`, `authoring.test.ts`,
  `supabase/tests/sops_enforcement_test.sql`.

### Rollout

Branch → apply migration to live DB → `npm run gen:types` (signature of
`next_sop_number` is unchanged, expect no diff) → typecheck/lint/tests → browser
verification (new-draft preview shows `SOP-XXX-###`, renamed departments and renumbered
docs render correctly) → merge to main.
