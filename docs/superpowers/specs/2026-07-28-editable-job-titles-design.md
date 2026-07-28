# Editable job titles

**Date:** 2026-07-28
**Status:** Approved

## Decision

The position title assigned to a person on a department roster becomes editable: an admin can type
a title that is not in the standard list, and it joins a workspace-shared list offered to every
department thereafter.

Format is constrained; **vocabulary is not.** Anyone may add any title they like, as long as it is
shaped like a title.

## Why

`STANDARD_POSITION_TITLES` (`src/domain/departments.ts:27`) is a hardcoded map, so hiring a
Calibration Technician means a code change before anyone can record it. That is the same gap the
RASIC role vocabulary just closed, one field over.

The two lists stay separate — that separation was a deliberate decision on 2026-07-26, because
collective process actors like "Board of Management" must never be offered when naming a real
employee. This spec makes job titles editable **without** merging them into the role vocabulary.

## Format rules — and why capitalization is not one of them

The obvious rule is to Title Case every entry. It would corrupt real data on contact: the live
workspace holds **"PJ Mgr / Operations"**, and the shipped general roles include **"EVP
Operations"** and **"HoD (Heads of Department)"**. Title-casing yields "Pj Mgr", "Evp", "Hod" —
silently mangling initialisms that were typed correctly.

Consistency therefore comes from **preventing near-duplicates**, not from imposing a house style on
words the app cannot interpret. `normalizeJobTitle(raw): string | null`:

- trim, and collapse runs of internal whitespace to one space
- reject empty
- must start with a letter
- at most 60 characters
- letters, digits, spaces and `- / & ( ) . ,` only — no newlines, tabs or control characters
- case-insensitive uniqueness, enforced by the database

Identical in shape to `normalizeRasicRoleName`, so the two fields behave the same way for the
person using them.

## Changes

### Database (one migration)

`sop_job_titles`: `id`, `workspace_id` (FK, cascade), `name`, `created_by`, `created_at`, with a
unique index on `(workspace_id, lower(btrim(name)))`.

RLS in one sentence: **anyone who can edit SOPs in the workspace may read and add a job title; only
workspace owners/admins may rename or delete one** — the same rule, helpers and precedents as
`sop_rasic_roles` (`has_org_tool_access` for select/insert, `has_workspace_role(['owner','admin'])`
for update/delete).

Then `npm run gen:types`, and commit the regenerated `database.types.ts`.

### Domain

`normalizeJobTitle` and `jobTitleOptions(departmentCode, workspaceTitles)` in
`src/domain/departments.ts`, beside the role equivalents: standard titles for the department first,
then a "Added by your team" group, deduped case-insensitively with the standard list winning.

### Store

`src/lib/sop/job-titles/store.ts` mirroring the roles store, including the optional injected client
on the read and 23505-as-already-present on the insert — two admins adding the same title at once
is expected, not an error.

### UI

The position-title picker in `departments-admin.tsx:501` gains `allowCustomValue`, the prop that
already exists on `ThemedSelect`. No new component: typing, filtering, the add hint and the
duplicate guard all come from the shipped combobox.

Curation reuses the roles panel pattern — a second section listing team-added titles with inline
rename and delete, behind the same `manage` gate.

## Deliberately not doing

- **Not merging job titles with RASIC roles.** Decided 2026-07-26 and unchanged: collective actors
  belong in a responsibility matrix, never in the dropdown that names an employee.
- **No vocabulary restriction.** The owner explicitly chose format-only. Requiring a known noun
  ("… Manager", "… Engineer") would reject legitimate titles the company actually uses.
- **No auto-capitalization.** See above — it corrupts initialisms already in the data.
- **Not seeding `STANDARD_POSITION_TITLES` into the table.** They ship in code for the same reason
  the general roles do: no per-workspace bootstrap, and the baseline cannot be deleted.

## Verification

1. Domain unit tests for `normalizeJobTitle`: whitespace collapse, the character allowlist, the
   length cap, must-start-with-a-letter, and — explicitly — that `PJ Mgr / Operations` and
   `HoD (Heads of Department)` survive unchanged.
2. Domain tests for `jobTitleOptions`: group order, contiguity, case-insensitive dedupe.
3. pgTAP for the RLS: an editor can add, cannot rename or delete; an admin can; a viewer cannot
   add; a case variant is refused by the unique index; tenancy holds.
4. `npm run typecheck`, `lint`, `test`, `build`.
5. `supabase db reset` + `supabase test db`.
6. Drive it live: add a title from the department roster, confirm it appears for another
   department, then rename and delete it from the settings panel.
