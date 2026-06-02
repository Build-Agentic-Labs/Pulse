# Tool Catalog — Group by Type + Smart Title Case Names

**Date:** 2026-06-01
**Status:** Approved design v2 — hardened after adversarial spec review (pending final user review)
**Area:** Project Tool Catalog (`Setup → Tools`)

## Goal

Make the project Tool catalog display tool names professionally and cleanly, and
keep them clean going forward:

1. **Smart Title Case** every tool name — unit/size/code-safe (`10mm`, `M6`,
   `1/2in`, `3/8"` preserved; acronyms like `HSS`/`CRES`/`NPT` preserved).
2. **Group the catalog by tool type** under labeled subheaders in the existing
   single table.
3. **Rewrite existing names in the database** via an explicit, idempotent
   in-app **"Tidy names"** button — without ever deleting a tool that is
   assigned to a step.
4. **New / edited tool names auto-format** on entry.

### Non-goals

- No change to part catalog, BOM, or any non-tool surface.
- No new tool-type categories (`TOOL_TYPE_OPTIONS` stays as-is).
- No mass writes on page load. Display-time formatting is in-memory only;
  persistence happens on edit or on the Tidy button.

## Background — how tools work today

- **Source of truth for tool→step assignment:** freeform strings inside each
  task's `customFields.stepToolLists` (a `Record<stepId, string[]>`), see
  `src/domain/step-tools.ts`. Matching is case-insensitive (keyed on
  `toLocaleLowerCase()`) but **whitespace-sensitive** (`cleanToolName` only
  trims; it does not collapse internal whitespace).
- **Tool metadata** (category, image) lives in the Supabase `tool_library`
  table, scoped per project (`tool_name`, `category`, `image_url`,
  `storage_path`).
- **Catalog assembly:** `buildProjectToolCatalog(tasks, registry, libraryItems)`
  (`src/domain/project-catalog.ts:35`) dedupes tool names via
  `buildStepToolLibrary()`, sorts alphabetically, and enriches each with a
  stable id/color (`tool-registry.ts`), usage counts, and a resolved
  `category` via `resolveToolType(name, libraryItem?.category)`
  (`src/domain/tool-types.ts:50`).
- **UI:** `ProjectCatalogSetupPanel`
  (`src/components/project-catalog-setup-panel.tsx`) renders a single flat,
  alphabetical table: Tool ID · editable name input · Type dropdown · color ·
  usage · delete. Saving routes through `saveCatalogTool`
  (`src/components/line-workspace.tsx:7557`), which calls `renameToolInTasks`
  (rename-in-place, preserves assignments) + `upsertToolLibraryMetadata`.

### Defects this design fixes

1. **Saved category is ignored.** `ProjectCatalogSetupPanel` calls
   `buildProjectToolCatalog(tasks, projectToolRegistry)` **without**
   `toolLibraryItems` (`project-catalog-setup-panel.tsx:200`), even though the
   items are loaded in state at `line-workspace.tsx:5098`. The type a user picks
   is persisted but re-inferred from the name on reload. Grouping by type is
   meaningless unless the saved category is honored.

## Core invariant — the canonical tool key (READ FIRST)

Tool names are compared in **three** places that must agree: the catalog dedup,
the per-name usage counter, and the rename matcher. Today they all key on
`name.trim().toLocaleLowerCase()`, which is **whitespace-sensitive** — so
`"torque  wrench"` (two spaces) and `"torque wrench"` (one space) are *different
keys*. Because `formatToolName` collapses internal whitespace, a formatted
display name no longer matches its raw stored key. This single mismatch, if left
unfixed, silently zeroes usage counts, orphans step assignments on rename, and
makes the Tidy button a no-op.

**Resolution — one shared key function:**

```
canonicalToolKey(x: string): string
  = formatToolName(x).trim().replace(/\s+/g, " ").toLocaleLowerCase()
```

ALL tool-name keying/matching MUST route through `canonicalToolKey`:

- `buildStepToolLibrary` dedup map keys.
- `buildProjectToolCatalog` — `usageByKey`, the per-entry `key`, and
  `libraryByName` (so a DB row stored pre-Tidy with extra spaces still matches
  the formatted display name).
- `resolveProjectTool` / registry construction (stable id + color survive
  whitespace/casing changes).
- `renameToolInTasks` — match occurrences via `canonicalToolKey(tool) ===
  canonicalToolKey(from)` instead of raw-lowercase equality.

Because matching now goes through `canonicalToolKey`, a rename whose `from` is the
clean display name still matches the messy raw occurrence in task data and
rewrites it to the clean form. Whitespace/case variants genuinely collapse to one
row, as intended.

## Design

### 1. New pure module — `src/domain/tool-name-format.ts`

Exports `formatToolName(raw: string): string` and `canonicalToolKey(raw: string):
string`. `formatToolName` is **idempotent** (`format(format(x)) === format(x)`)
and **never changes letters** — only casing and whitespace.

`formatToolName` algorithm (per whitespace-collapsed token):

1. Trim; collapse internal whitespace runs to a single space.
2. **Digit-bearing tokens are sizes/codes:**
   - Starts with a digit → keep verbatim: `10mm`, `1/2in`, `3/8"`, `243`.
   - Starts with letters but contains a digit → uppercase the leading letter
     run only: `m6` → `M6`, `t30` → `T30`.
3. **All-caps tokens (no lowercase letters):**
   - Length ≤ 4 → keep as acronym. This convenience rule already covers the
     common machining acronyms (`HSS`, `NPT`, `EDM`, `CMM`, `CRES`, `ANSI`,
     `TORX`, `OEM`, `OAL`, `NM`, `ID`, `OD`).
   - OR present in the explicit allowlist
     `TOOL_ACRONYMS = { HSS, CRES, NPT, EDM, CMM, OEM, NM, ID, OD, ANSI, OAL }`.
     The allowlist is the extension point for any acronym **longer than 4 chars**
     (none today; add members as they come up).
   - Otherwise (longer shouted word) → title-case: `WRENCH` → `Wrench`,
     `TORQUE` → `Torque`.
   - Trade-off: a genuinely shouted ≤4 word (e.g. `TAPS`) is preserved rather
     than title-cased. Rare and acceptable; edit the name by hand if needed.
     Brand-cased ≤4 terms like `Torx` follow the same rule: typed `TORX` stays
     `TORX`, typed `torx` becomes `Torx` (not in the allowlist by design).
4. **Small words** (`of and the to for in on with per a an or vs`) → lowercase,
   unless the token is the first token → Title Case.
5. **Otherwise** → lowercase then capitalize the first letter, applied to each
   sub-part across hyphens: `t-handle` → `T-Handle`, `allen-key` → `Allen-Key`.

`TOOL_ACRONYMS` is a single exported constant, easy to extend as new acronyms
appear. **Known limitation (documented, deliberate):** auto-format always wins;
a long all-caps token not in the set is title-cased (e.g. an unknown `FOOBAR` →
`Foobar`). There is intentionally no per-entry opt-out — catalog consistency is
preferred over preserving one-off casing. New acronyms are handled by adding them
to `TOOL_ACRONYMS`.

This module is dependency-free and **exhaustively unit-tested** (the only piece
with real edge cases).

### 2. Apply formatting at the display layer + unify the key

`buildStepToolLibrary()` (`step-tools.ts:48`):

- Dedup map keyed on `canonicalToolKey(tool)` (was raw lowercase) so whitespace
  and case variants collapse to one entry.
- Returns formatted display names (`formatToolName(firstSeenRaw)`), sorted.
  This cleans the catalog **and** the step-tool autocomplete suggestions, so
  picking a suggestion stores the clean form — "normalized going forward."

`ProjectToolCatalogEntry` gains a **`rawName: string`** field — the
representative raw stored string that won the dedup. `key` becomes
`canonicalToolKey(rawName)`; `name` becomes `formatToolName(rawName)` (display).
`rawName` is what the rename/Tidy path passes as `from`, so it targets the actual
task occurrences. `buildProjectToolCatalog` builds its per-tool record
(rawName + displayName + usage) in its existing task-iteration pass, keyed by
`canonicalToolKey`, so usage counts and the entry key always agree.

Net effect: existing names look clean **immediately** (non-destructive,
in-memory), even before the Tidy backfill runs.

> Partial-normalization note: editing/adding a single step normalizes only that
> occurrence; other steps keep their raw spelling until Tidy. Because all keying
> is whitespace/case-insensitive (`canonicalToolKey`), the variants still dedupe
> to one catalog row and rename together, so this divergence is invisible and
> safe — Tidy fully converges the stored strings.

### 3. Group by type — `groupToolCatalogByType()` in `project-catalog.ts`

Pure function:

```
groupToolCatalogByType(entries: ProjectToolCatalogEntry[]):
  Array<{ type: ToolTypeValue; label: string; count: number; entries: ProjectToolCatalogEntry[] }>
```

- Order groups by canonical `TOOL_TYPE_OPTIONS` order (so `General` lands last).
- Omit empty groups.
- Sort entries alphabetically by name within each group.

`ProjectCatalogSetupPanel` renders, per group, a **subheader `<tr>` containing
`<th scope="colgroup" colSpan={6}>{LABEL} ({count})</th>`** (a header cell, not a
plain `<td>`, so assistive tech announces it as a group header), followed by that
group's existing rows. Columns are unchanged. Styled via a new small class in
`app/globals.css`.

### 4. Honor the saved category (round-trip fix)

- Add `toolLibraryItems: ToolLibraryItem[]` prop to `ProjectCatalogSetupPanel`.
- `line-workspace.tsx` passes `toolLibraryItems={toolLibraryItems}` (already in
  state) at the render site (`line-workspace.tsx:9030`).
- Panel builds with
  `buildProjectToolCatalog(tasks, projectToolRegistry, toolLibraryItems)`;
  `libraryByName` keyed via `canonicalToolKey` so saved categories match the
  formatted name and grouping reflects the user's choice.

### 5. Format on edit (convergence) — honest change detection

- **Change detection:** `toolDraftChanged` compares
  `formatToolName(draft.name)` against `entry.name` (both canonical). Typing a
  value that formats to the already-saved name reports **no change** and writes
  nothing — no redundant upsert/toast on blur.
- **Apply:** `saveCatalogTool` formats the incoming name, passes `entry.rawName`
  as the rename `from` (so raw task occurrences are matched), and persists via
  `renameToolInTasks` + `upsertToolLibraryMetadata`.
- **Visible input convergence:** after a successful save, the panel sets the
  draft to the formatted value (the draft-rehydration `useEffect` preserves
  drafts by key, so it will *not* overwrite a stale raw value on its own — the
  save handler must do it). This keeps the field showing the clean form.
- **Blank guard:** add an explicit guard in `commitToolDraft`/`saveCatalogTool`:
  if the formatted name is empty, short-circuit with a friendly message and
  perform no rename and no library write. (Today a blank silently no-ops the
  rename and throws an *unhandled* rejection in `upsertToolLibraryMetadata` with
  no toast — see Edge cases.)
- **Decision (explicit):** auto-format always wins on manual edits; deliberate
  casing is not preserved verbatim. This is intentional (see §1 limitation).

### 6. "Tidy names" button — one-time idempotent backfill

A button in the Tools section header. Scope: the **currently-open project's**
tools (the catalog is project-scoped).

- **Plan:** `planToolNameTidy(entries): Array<{ from: string; to: string }>`
  returns, for each entry where `formatToolName(entry.rawName) !== entry.rawName`,
  `{ from: entry.rawName, to: entry.name }`. **Critical:** the comparison and the
  `from` use **`rawName`**, not the already-formatted `entry.name` (else the plan
  is always empty and the button does nothing).
- **Merge precedence:** before applying, dedupe the plan by target
  `canonicalToolKey(to)`. For collisions (two raw spellings → one clean name),
  pick a deterministic winner — the source whose `tool_library` row has a
  non-null `image_url`, tiebreak by highest usage — and migrate only the
  winner's metadata; skip losers' metadata writes so no `image_url`/`category`
  is clobbered. (Category self-heals via `resolveToolType`; `image_url` loss
  would be permanent, hence the precedence rule.)
- **Apply (resilient):**
  1. Fold every rename into tasks in one pass:
     `renames.reduce((next, r) => renameToolInTasks(next, r.from, r.to), tasks)`,
     then a single `applyProjectTasksUpdate(next)`.
  2. For each deduped rename, `upsertToolLibraryMetadata({ toolName: to,
     category, projectId, previousToolName: from })`. **Wrap in try/catch,
     collect per-rename failures** rather than aborting; prefer the
     metadata-preserving order (upsert-new-then-delete-old) — see Risks.
  3. In a `finally`, reload `toolLibraryItems` so the UI reflects partial
     progress.
- **Result toast:**
  - `renamedCount = dedupedPlan.length` (plan actions, pre-merge),
    `cleanCount = entries.length - renamedCount`.
  - `renamedCount === 0` → `"All tool names already clean."`
  - else → `"${renamedCount} renamed, ${cleanCount} already clean."`
    (append `", ${failed} could not be saved"` if any metadata upsert failed.)
- **In-flight state:** disable the Tidy button while the batch runs (mirror the
  BOM upload button's `disabled={uploading}` pattern already in this panel) —
  `savePlannerShellToSupabase` has **no concurrency guard** and rewrites the
  whole project, so a double-click must not issue two overlapping writes.
- **Idempotent:** after a clean run, `formatToolName(rawName) === rawName` for
  every tool, so a second click plans nothing.
- **Safety:** rename-in-place only — never deletes; step assignments preserved
  (now correctly, because `from = rawName`).

## Data flow

```
load: tasks + registry + toolLibraryItems
  -> buildProjectToolCatalog (rawName, formatted name, resolved category, canonical key)
  -> groupToolCatalogByType
  -> grouped table with <th scope=colgroup> subheaders

edit name (blur): if formatToolName(draft) === entry.name -> no-op (no write)
  else -> saveCatalogTool: format, from = entry.rawName
       -> renameToolInTasks + upsertToolLibraryMetadata -> reload library -> draft := formatted

change type (dropdown): saveCatalogTool persists category -> reload -> row moves group

Tidy (click): planToolNameTidy over rawName -> dedupe by target (winner keeps image)
  -> batch renameToolInTasks (1 task write)
  -> per-rename upsert in try/catch -> reload in finally -> result toast
```

## Edge cases

- Empty catalog → existing empty state unchanged; Tidy click is a harmless no-op
  ("All tool names already clean.").
- Saved category differs from inferred → saved category wins (after round-trip
  fix).
- **Blank/whitespace-only name edit** → rejected by the **new explicit pre-save
  guard** (§5): no rename, no library write, friendly message. (`cleanToolName`
  only trims and does not reject — it is *not* the guard.)
- Names with quotes / slashes / parens (`3/8"`, `(qty 2)`) → preserved by the
  digit + punctuation rules.
- Tool used in steps with no `tool_library` row → category inferred (unchanged),
  name still formatted.
- **Multi-space / case variants of the same tool** → collapse to one row and
  rename together via `canonicalToolKey`; usage counts are correct.
- **Two names formatting to one clean name (merge)** → Tidy dedupes by target,
  deterministic winner keeps `image_url`/`category`.
- **Deliberate casing the formatter overrides** (e.g. unknown long acronym) →
  title-cased; documented known limitation; extend `TOOL_ACRONYMS` to fix.
- **Mid-batch failure** → tasks committed first, metadata upserts collected;
  failures surfaced in the toast; UI reloaded in `finally`. Re-running Tidy does
  not auto-recover orphaned `tool_library` rows (tasks already renamed), so the
  library-upsert loop is driven off the `{from,to}` plan and failures are
  reported for manual retry. (A single transactional RPC would remove this gap —
  see Risks.)

## Testing (TDD, Vitest — matches repo's domain-test pattern; no component tests)

- **`src/domain/tool-name-format.test.ts`** (write first): table-driven —
  basic Title Case; small words (first vs mid); units (`mm`, `in`, `NM`);
  codes (`M6`, `T30`); leading-digit sizes (`10mm`, `1/2in`, `3/8"`); hyphens
  (`t-handle`); **acronyms in set (`HSS`/`CRES`/`NPT` preserved) vs long shouted
  word (`WRENCH` → `Wrench`)**; idempotency (`format(format(x)) === format(x)`);
  empty/whitespace collapse; punctuation; `canonicalToolKey` equates
  whitespace/case variants.
- **`src/domain/project-catalog.test.ts`**: catalog `name` formatted and
  `rawName` preserved; **usage counts correct for a multi-space name**; saved
  category respected when `libraryItems` passed; `groupToolCatalogByType` order
  = canonical type order with `General` last, alpha within group, counts;
  `planToolNameTidy` keys off `rawName` (a double-space name is planned; an
  already-clean name is not); merge plan dedupes by target with deterministic
  winner; toast count formula given a whitespace-merge fixture.
- **`src/domain/step-tools.test.ts`** (extend): a tool stored as `"torque
  wrench"` (double space) is **fully renamed in task data** by a rename whose
  `from` is the clean form, and a second pass is a no-op (idempotent,
  assignments preserved).
- **Verification gate:** `npm run typecheck` && `npm run test` && `npm run lint`
  && `npm run build`. UI (grouping subheaders, button disabled state) verified
  manually (no component-test infra in repo).

## Risks / follow-ups

- **Non-atomic backfill:** the task write and per-row metadata upserts are
  separate writes; `upsertToolLibraryMetadata` deletes the old row before
  upserting the new one, so a crash mid-rename can lose `image_url`. Mitigations
  in scope: metadata-preserving order (upsert-new-then-delete-old) + per-rename
  error collection + reload in `finally`. **Out of scope but recommended
  follow-up:** a single server-side RPC that renames tasks and migrates
  `tool_library` rows transactionally.

## Files touched

| File | Change |
|------|--------|
| `src/domain/tool-name-format.ts` | **NEW** — `formatToolName`, `canonicalToolKey`, `TOOL_ACRONYMS` |
| `src/domain/tool-name-format.test.ts` | **NEW** — TDD suite |
| `src/domain/step-tools.ts` | key `buildStepToolLibrary` on `canonicalToolKey`; format display name; match `renameToolInTasks` on `canonicalToolKey` |
| `src/domain/step-tools.test.ts` | **extend** — double-space rename + idempotency |
| `src/domain/project-catalog.ts` | `rawName` on entry; canonical keying; `groupToolCatalogByType`; `planToolNameTidy` (with merge dedupe) |
| `src/domain/project-catalog.test.ts` | **NEW/extend** — grouping, tidy, merge, usage, category |
| `src/components/project-catalog-setup-panel.tsx` | `toolLibraryItems` prop; grouped `<th scope=colgroup>` subheaders; Tidy button (disabled-in-flight); honest change detection; blank guard; draft reformat-on-save |
| `src/components/line-workspace.tsx` | pass prop; `saveCatalogTool` uses `rawName` + format; `onTidyToolNames` handler (dedupe, try/catch, finally reload, toast) |
| `app/globals.css` (repo root, near `.ui-procedure-tool-table-wrap` ~L2993) | subheader row class |

## Rollout

Single PR on a feature branch (`feat/tool-catalog-grouping-and-formatting`). No
DB migration needed (the `category` column already exists; backfill runs through
the app). Behavior is additive; names can be re-edited freely.

## Refinement v3 — auto-format, auto-clean, safer dedup

User feedback after testing: the manual Tidy button should be automatic, and the
catalog still showed identical-looking duplicate rows. Decisions:

1. **Auto-format on entry.** `addStepTool` runs `formatToolName` on commit
   (Enter/add — not per keystroke), so new tools are stored clean. Applies to
   the desktop and mobile add paths via the shared domain function.

2. **Auto-clean existing on load.** A `useEffect` in `line-workspace.tsx`,
   guarded by a `useRef` keyed on `projectId` (runs once per project, never
   loops), computes `planToolNameTidy(buildProjectToolCatalog(...))` and, if
   non-empty, runs the existing resilient `tidyCatalogToolNames` batch (one task
   write + per-row metadata migration in try/catch + reload in `finally`). A
   brief neutral toast reports `Cleaned up N tool name(s)`. **The manual "Tidy
   names" button and its panel props are removed.**

3. **Stronger but safe deterministic normalization** in `tool-name-format.ts`,
   all number-preserving (never merges different sizes):
   - **Unicode NFC + strip zero-width / soft-hyphen** (`​-‍`, `﻿`,
     `­`) as the first step of `formatToolName` — kills invisible-difference
     duplicates.
   - **Number↔unit spacing**: `10 mm` → `10mm`, `1/2 in` → `1/2in`
     (units: mm cm in ft m nm mil ga awg pt).
   - **Inch normalization**: a `"` or `inch`/`inches` after a number → `in`
     (`1/2"` and `1/2 inch` → `1/2in`).
   - **Hyphen↔space fold in `canonicalToolKey` only** (key-level, display
     unchanged): `t-handle` and `t handle` merge.
   - **Not** doing plural-stripping or synonym merging (unsafe; user declined).

4. **Regression guard:** a test asserting `buildProjectToolCatalog` never emits
   two entries sharing a canonical key (the catalog's core invariant). If
   identical rows persist after this, the cause is outside normalization and
   warrants dumping the raw bytes of the offending names.

TDD on every new normalization rule, then typecheck/test/lint/build.
