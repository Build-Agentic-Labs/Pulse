# SOP deferred numbering: a number is earned at release

**Date:** 2026-07-25
**Status:** Approved

## Decision

A document number is assigned when an SOP goes **effective**, not when it is created.

> A number belongs to a document if and only if that document has been released.

Before release — builder, draft review, final approval — the document reads
`SOP-PRO-###`. On the `approved → effective` transition the database mints the next
number for the owning department and stamps it in.

Numbering stays scoped per department exactly as today: `doc_number_counter` remains
keyed by `(workspace_id, department_id, doc_type)`, so `SOP-PRO-###` and `SOP-QAS-###`
keep independent sequences. Only the *moment* of assignment changes.

### Why

Today the number is minted on the first save (`sop-editor.tsx` → `mintSopNumber` →
`next_sop_number`). The counter bumps permanently, so deleting a draft orphans its
number and opens a gap in that department's sequence. Authors who create and discard
drafts while working shred the sequence.

Because a release is irreversible and a released number is never reclaimed, minting at
release makes each department's sequence **gapless by construction** rather than by
periodic cleanup.

## Lifecycle change bundled into this work

Also decided 2026-07-25: an effective SOP is **terminal**.

- `effective → obsolete` is removed. A released document is retired only by being
  *superseded* — releasing a new version retires the old **version**, not the SOP.
- An effective SOP cannot be soft-deleted. Today the guard permits it through its
  `or is_manager` clause; that loophole closes.
- `effective → draft` (the revision path) is untouched. "Terminal" means no exit to
  `obsolete` and no deletion — not frozen.
- `draft → obsolete` and `approved → obsolete` survive. Abandoning an unreleased
  document is unaffected.

Withdrawing a genuinely dead procedure from service has no path for now; the correct
model is deferred to a later spec.

This rides along rather than getting its own branch because it is ~5 lines inside
`enforce_sop_transition`, and the numbering work already rewrites that function. Two
sequential rewrites of the same trigger would force the second migration to reproduce
the first's logic verbatim — one v4 landing both is lower risk than splitting.

## Code-state findings (2026-07-25)

Read from the repo; live row counts were not queried (the Supabase MCP server is
unauthorized in this session), so the migration derives every value it needs from the
data rather than from a snapshot.

- **The placeholder already exists.** `previewSopNumber(deptCode, docType)` →
  `SOP-PRO-###` (`src/domain/sop/authoring.ts:33`). It is applied only while
  `isNew && !persistedUpdatedAt` (`sop-editor.tsx:776`). The change is to key it on
  "no number yet" instead.
- **Two mint call sites**, both client-side: first save
  (`sop-editor.tsx:967`) and the DOCX conversion path (`sop-list.tsx:410`).
- **`content_hash` is `sha256(document::text)`** and `document.meta.sopNumber` lives
  inside that jsonb. Signatures bind to `(content_hash, review_cycle)`, so stamping a
  number at release would void the quality-approval signature that authorized the
  release.
- **`sop_doc_hash` is called only from function bodies** — never from an index or a
  generated column (11 call sites checked). Redefining it is therefore safe; had it
  backed an index, changing an `immutable` function underneath would have silently
  corrupted lookups instead of erroring.
- **`snapshot_sop_revision` reads the OLD row.** It does
  `select * from public.sops where id = p_sop`, and it is called from inside a
  `BEFORE UPDATE` trigger — so a number stamped into `new.document` in the same UPDATE
  would be absent from the frozen snapshot.
- **`next_sop_number` authorizes via `has_department_role(owning_dept)`.** At release the
  caller is the Quality approver, who by Gate C must *not* hold a seat and must differ
  from the author — they generally hold no role in the owning department. Calling the
  existing function from the trigger would fail authorization.
- **The uniqueness index already tolerates unnumbered rows:**
  `sops_workspace_number_unique_idx` is partial —
  `where sop_number is not null and btrim(sop_number) <> '' and deleted_at is null`.
  No schema change needed.
- **Display surfaces already degrade gracefully.** Every list leads with the title and
  treats the number as a secondary label with a fallback (`|| "—"`, `|| "SOP"`,
  `|| "Unnumbered"`). Nothing breaks when the number is absent.
- **`major_version` is a trustworthy "was released" flag.** The guard nulls it on INSERT,
  pins it to `old` on every UPDATE, and sets it to `1` in exactly one place — the
  `approved → effective` branch. So `major_version is null` ⟺ never released,
  unforgeable even by a raw PostgREST write. It is the same test the guard already uses
  to distinguish a first release from a revision.
- **The Retired archive already models versions separately from documents.**
  `buildRetiredEntries` (`retired-sops.tsx:24`) tags entries `"Older version"` (from
  `sop_revisions`) or `"Retired SOP"` (from `status = 'obsolete'`). The lifecycle change
  closes the second route for released documents; the branch stays to render existing
  rows.
- **Nothing in the app reads `sop_revisions.document`.** The frozen jsonb is audit
  record only; every UI surface reads the number from the live `sops` row.

## Changes

### Database (one migration)

1. **`sop_doc_hash` v2** — `sha256((doc #- '{meta,sopNumber}')::text)`. The number
   becomes control metadata rather than signed content, so stamping it at release
   changes no hash and voids no signature.

2. **`snapshot_sop_revision` v3** — gains `p_document jsonb default null`, used as
   `coalesce(p_document, s.document)`. Lets the release trigger hand in the document it
   just stamped so the frozen revision carries its own number. Existing single-argument
   callers are unaffected.

3. **`mint_sop_number_internal(p_workspace, p_department, p_doc_type)`** — the counter
   bump and collision-skip loop from `next_sop_number`, without the department-role
   check. Not callable by clients (`revoke execute ... from public, anon, authenticated`).
   The trigger has already authorized the transition before calling it.

4. **`next_sop_number` — revoke `execute` from `authenticated`.** Nothing may burn a
   number outside a release. The function stays defined for reference and for the
   internal variant to mirror.

5. **`enforce_sop_transition` v4** — supersedes v3. Deltas only:
   - INSERT branch also forces `new.sop_number := null`. Without this a client can POST
     a row squatting a *future* number; the collision-skip loop would step over it and
     open exactly the gap this work removes.
   - UPDATE pins `new.sop_number := old.sop_number` unconditionally (v3 froze it only
     when `old.status <> 'draft'`), so the number is client-unwritable on every edge.
   - `approved → effective` mints when `old.sop_number` is null or blank, stamping both
     `new.sop_number` and `new.document->meta->sopNumber`, then passes the stamped
     document to `snapshot_sop_revision`. A revision of an already-numbered document
     keeps its number — same shape as the existing `if old.major_version is null` test.
   - `effective → obsolete` removed from the case statement.
   - Soft-delete guard: effective rows are never deletable, `is_manager` included.

6. **Data migration**, transition guard suspended inside the transaction (precedented by
   the 2026-07-22 flip):
   - Build an old→new hash mapping in one pass, inlining the new expression so there is
     no dependency on redefinition order. Rewrite `sops.content_hash`,
     `sop_revisions.content_hash`, and `sop_signatures.signed_content_hash` through it.
     `sop_signatures` has `revoke update` for `authenticated` only, so the migration role
     can write it.
   - Reclaim `sop_number` (column and `meta.sopNumber`) from every row where
     `major_version is null` — never released, whatever its current status. This includes
     `obsolete` rows retired straight from draft or approved: they never earned a number,
     so they must not hold a position in the sequence.
   - Reset each `(workspace_id, department_id, doc_type)` counter to `max(seq) + 1` over
     all remaining numbered rows **including soft-deleted ones**, so a later hard-undelete
     cannot collide.
   - Post-conditions: no row with `major_version is null` retains a number; every counter
     is strictly greater than the highest number in its scope.

### App code

- **`src/domain/sop/authoring.ts`** — two pure functions, unit-tested:
  - `documentNumberLabel(sopNumber, deptCode, docType)` → the number, else
    `SOP-PRO-###`. Used wherever the document itself is rendered.
  - `listNumberLabel(sopNumber, deptCode)` → the number, else the bare department code,
    so existing `{number} · {title}` rows render
    `PRO · Value Stream Mapping Standard Practices`.
  - `previewSopNumber` folds into `documentNumberLabel`.
- **`src/lib/sop/review.ts`** — delete `mintSopNumber`.
- **`src/components/sop/sop-editor.tsx`** — drop the first-save mint and the
  `reservedNumber` retry dance (both moot once the DB owns assignment); apply
  `documentNumberLabel` whenever the number is empty rather than only while `isNew`.
- **`src/components/sop/sop-list.tsx`** — drop the conversion mint; a converted document
  enters unnumbered with its extracted number blanked, and earns a number at release like
  any other. Render `listNumberLabel` (the `departments` array is already in scope).
- **`review-queue.tsx`, `notification-bell.tsx`, `retired-sops.tsx`** — render
  `listNumberLabel`; thread `departmentCode` where a surface lacks it (`review-queue`
  already carries it on seat rows).
- **`effective-library.tsx`** — unchanged. Everything there is numbered by definition.
- **`src/lib/sop/store.ts`** — the owning department code is embedded into both projections
  (`department:departments(code)`, a left join on the `sops.department_id` FK) and exposed as
  `departmentCode` on `SopListItem` **and** `SopRecord`. Every surface that renders an SOP
  already loads one of those two, so the code that stands in for the number travels with the
  document instead of being re-derived per screen.
- **`src/components/sop/sop-print-preview.tsx`** — takes `departmentCode` and resolves the
  label once at the top of the component, shadowing the `sop` prop. Four call sites print
  documents (editor, draft review, final approval, quality approval) and three of them only
  ever show *unreleased* ones, so resolving per call site would leave a blank number on a
  controlled copy the first time a new print path was added.
- **`src/domain/sop/queue-summary.ts`** — resolves `QueueSummaryItem.sopNumber` to the label,
  so the notification bell renders it verbatim and cannot drift from the queue page.

### Types

`npm run gen:types` after the migration; commit the updated
`src/lib/database.types.ts`.

## Verification

1. Domain unit tests for `documentNumberLabel` and `listNumberLabel`, including the
   numbered, unnumbered, and blank-department cases.
2. SQL suites. Eleven files reference `sop_number`: `sops_enforcement_test` (6
   references, plus the removed `effective → obsolete` edge and the tightened delete
   guard), `sop_changelog_test` (2), and one reference each in `sop_authz_test`,
   `sop_cycle_test`, `sop_objections_test`, `sop_quorum_test`, `sop_reassign_test`,
   `sop_rls_test`, `sop_seats_test`, `sop_tenancy_test`, and
   `supabase/walkthroughs/sop_lifecycle.sql`. Audit each: a seeded number is now
   silently nulled on INSERT, so suites that merely use it as filler still pass, while
   any that assert on it must move to id-based references. Fix the assertions, not the
   clamp.

   **Audit outcome (2026-07-25):** nine of the eleven seed a number purely as INSERT filler
   and reference the SOP by id thereafter, so they are unaffected — the seeded value is now
   inert. `sops_enforcement_test` was rewritten (see below) and `sop_changelog_test` gained a
   `sop_number is stripped` case to its existing raw-INSERT forge-regression block, which is
   exactly where that assertion belongs. No suite other than the new assertions exercises
   `effective → obsolete` or soft-deletes an effective row, so removing those paths breaks
   nothing that existed.
3. New SQL assertions in `sops_enforcement_test` (plan 12 → 23): neither
   `next_sop_number` nor `mint_sop_number_internal` is callable by a client; an INSERT
   carrying a number has it clamped; an *approved* SOP is still unnumbered; release mints
   `SOP-PRD-001`; the frozen revision carries that number; the quality signature is still
   bound to the released document after the stamp; a client cannot rewrite an effective
   SOP's number; `effective → obsolete` raises; an effective row cannot be soft-deleted; a
   revision keeps the number and advances only the version; and the counter does not move
   for a revision.
4. Migration post-conditions assert inside the transaction, so a bad reclaim aborts.
5. `npm run typecheck`, `lint`, `test`, `build`.
6. Drive it live: build a document, confirm `SOP-PRO-###` through draft review and final
   approval, release it, confirm the number appears only then and that the frozen
   revision carries it.

## Deliberately not doing

- **No withdrawal path for effective SOPs.** Decided: effective is terminal for now,
  correct model deferred.
- **Released numbers are never reclaimed.** Effective and was-effective-then-obsolete
  documents keep their numbers untouched.
- **No renumbering of released documents.** The 2026-07-22 flip already rewrote them
  once; nothing here rewrites a controlled number again.
- **`sop_revisions` snapshots and `sop_signatures` keep their historical numbers.** Only
  the hash columns are rewritten, and only to preserve the signature chain across the
  `sop_doc_hash` change.
- **No legacy-number import.** A converted document cannot carry its original number in,
  because `sop_number` is unwritable on INSERT. Accepted for the tighter invariant.
