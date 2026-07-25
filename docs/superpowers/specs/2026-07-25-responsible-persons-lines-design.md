# Responsible persons: one entry per line

**Date:** 2026-07-25
**Status:** Approved

## Decision

`responsiblePersons` is edited one entry per line and rendered one entry per line on the
controlled document (print preview and Word export), replacing the single-line input and the
`"; "`-joined output.

## Why this is two changes, not one

The request is a rendering change. It cannot be delivered without first fixing a data bug in
the same field.

The editor reads `sop.responsiblePersons.join("; ")` into an `<input>`, but writes
`update({ responsiblePersons: [value] })` — the entire typed string as a **single** array
element. Any keystroke collapses a multi-entry array into one.

That corruption is invisible today because every consumer joins with `"; "`, and
`["A; B; C"]` joins to exactly the same text as `["A","B","C"]`. It becomes visible the moment
anything renders per entry — which is precisely what this feature does. Rendering one per line
without fixing the write path would ship a feature that silently stops working after the first
edit.

## Live-state findings (2026-07-25)

Queried against the linked project.

| Source | SOPs | Collapsed to one `;`-joined entry | Properly split | Empty |
|---|---|---|---|---|
| converted | 6 | 0 | 5 | 1 |
| authored | 12 | **6** | 0 | 5 |

Extraction produces correct arrays, so converted SOPs are intact. Every authored SOP with
content in this field has already been collapsed by the write path.

Of the 6 collapsed rows: **5 are drafts with no signatures**, and **1 is `in_review` carrying
1 signature**.

## Changes

### Domain

`src/domain/sop/responsible-persons.ts`, pure and unit-tested:

- `parseResponsiblePersons(value: string): string[]` — split on newlines, trim each, drop
  blanks. The "what counts as an entry" decision lives here rather than inline in the component.
- `formatResponsiblePersons(entries: readonly string[]): string` — join with newlines for the
  textarea.

### Editor

`src/components/sop/sop-editor.tsx` — the `<input>` becomes the `AutoTextarea` already used by
the process flow description, reading through `formatResponsiblePersons` and writing through
`parseResponsiblePersons`. This is the fix for the collapse bug.

### Rendered document

- `sop-print-preview.tsx` — one entry per line instead of `join("; ")`.
- `export-docx.ts` — one `bodyText` paragraph per entry. Plain lines, not a bulleted list:
  References uses `bulletList`, but the request was one per line, and bullets would change the
  section's visual weight rather than just its line breaks.

Both fall back to the existing empty-state rendering when there are no entries.

### Migration

Split the collapsed value on `;`, trim, drop blanks — scoped to `status = 'draft'`.

The scope is the safety property, not a convenience: it cannot reach the signed `in_review` row
or any future released one, so the transition guard needs no suspension and no content hash
moves under a signature.

## Deliberately not doing

- **Not repairing the `in_review` row.** Its document is bound by a signature and frozen by the
  transition guard. Repairing it would void the signature and require suspending the guard —
  a bad trade for line breaks. It renders as it does today and heals itself when its author next
  edits the field under the fixed write path.
- **Not healing collapsed values on read.** Splitting `"A; B; C"` when loading the editor would
  fix rows the migration cannot reach, but it would silently tear apart any role that
  legitimately contains a semicolon, and the editor would show something other than what is
  stored. The migration handles the known rows; the fixed write path handles everything after.
- **No change to the `"; "` separator anywhere else.** Only the responsible-persons section
  changes.

## Consequences

Released documents render this section differently from copies people have already seen. Owner
accepted this when choosing "one per line everywhere" over "editing only".

## Verification

1. Unit tests for both domain functions: multi-line input, blank lines, surrounding whitespace,
   empty string, and a single entry.
2. `npm run typecheck`, `lint`, `test`, `build`.
3. `supabase db reset` + `supabase test db` — the migration must apply from scratch.
4. Migration post-condition: no draft row is left holding a single `;`-joined entry.
5. Drive it in the browser: enter several lines, confirm they persist as separate entries and
   render one per line in the print preview.
