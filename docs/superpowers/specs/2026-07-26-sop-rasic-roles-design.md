# SOP RASIC roles: a workspace vocabulary, not a hardcoded map

**Date:** 2026-07-26
**Status:** Approved

## Decision

RASIC role names in the SOP process workflow come from three sources instead of one
hardcoded map:

1. **Department position titles** — `standardPositionTitlesForDepartment`, exactly as today
   (`src/domain/departments.ts:54-56`).
2. **A "General" group of eight process actors, shipped in code** as `GENERAL_RASIC_ROLES`:
   EVP Operations, Supervisor, Team Leader, Quality Inspector, Operator,
   Associates/Employees, HoD (Heads of Department), Board of Management.
3. **Workspace-added roles**, a new `sop_rasic_roles` table. An author types a new role
   directly in the role dropdown; it is saved on the document AND inserted into the
   workspace list in the same gesture, immediately visible to every author. Owners/admins
   rename or delete entries later.

Dropdown group order: the SOP's owning department, then the other departments, then
General, then "Added by your team". The owner explicitly asked for General to sit below
the departments.

RASIC roles are **their own vocabulary, separate from the job titles assigned to people on
the department roster**. Collective actors — "Associates/Employees", "Board of
Management" — are legitimate process actors but must never be offered in the dropdown that
names a real employee. Member position titles are unchanged by this work.

The RLS, in one sentence (CLAUDE.md: a feature whose RLS you can't state in one sentence
isn't designed yet): **anyone who can edit SOPs in the workspace may read and add roles;
only workspace owners/admins may rename or delete one.**

All of the above is settled with the owner — presented here as decided, not as open
questions.

### Why

`roleOptions` is assembled exclusively from `standardPositionTitlesForDepartment`
(`process-flowchart.tsx:53-69`), which reads the hardcoded `STANDARD_POSITION_TITLES` map
keyed by department code, falling back to `DEFAULT_POSITION_TITLES`
(`departments.ts:27-56`). No UI, table, or RPC adds a role — an author whose process
involves an actor outside the map cannot express it. The same hardcoded list feeds the
member position-title dropdown in the departments admin (`departments-admin.tsx:501`),
which is why decision 1 splits the vocabularies instead of growing the shared one.

General ships in code, not seeded, because seeding buys only problems: it needs a
per-workspace step (new workspaces would start empty), and seeded baseline rows are
deletable where code-shipped ones are not. Admin curation then applies exactly where drift
actually happens — typed roles.

## Live-state findings (2026-07-26)

Read from the repo; no live queries needed — no data migration rides on this work.

- **ThemedSelect is rendered at 56 call sites across 24 files** (`grep -rc "<ThemedSelect"`).
  This is why the new behavior is an opt-in prop defaulting to off: with the prop absent,
  all 56 sites must render identically to today. That default is the property the
  component tests protect.
- **`departments` has no roles column** — the full column list is
  id / workspace_id / code / name / is_quality_gate / audit fields
  (`supabase/migrations/20260707120000_departments.sql:4-14`). The vocabulary needs its own
  table regardless: roles are workspace-scoped, not department-scoped.
- **`procedure.roles` is already free text** on the SOP document
  (`src/domain/sop/schema.ts:103`), and the dropdown already surfaces any unrecognized
  stored value under a "Current role" group (`process-flowchart.tsx:163-165`). Existing and
  converted SOPs therefore render unchanged whatever the offered list contains.
- ThemedSelect derives group headings from *consecutive* options sharing a `group`
  (`themed-select.tsx:219`) — the assembly function must emit each group contiguously or
  headings repeat.
- The editor already knows the owning department: `selectedDept` is the persisted owner,
  or the chosen authoring department for a new SOP (`sop-editor.tsx:331`). **Assumption
  made explicit:** "the author's department" in the group order means this owning
  department, threaded into `ProcessFlowchart` — not the set of departments the author
  happens to be a member of.
- The editor already lazy-loads picker data client-side — `linkableSops` for the
  References picker (`sop-editor.tsx:348-350`). The role-list fetch follows that
  precedent; dropdown contents are not first-paint content, so no server seeding
  (CLAUDE.md recipe #4: server fetch is an accelerant, never a dependency).
- The admin surface: `/sops/departments` redirects to `/sops?tab=settings`
  (`app/sops/departments/page.tsx:5`); the settings tab mounts `DepartmentsAdmin` only for
  managers (`sop-workspace.tsx:186-194`), whose gate is `manage = canManage(role)` =
  owner/admin (`departments-admin.tsx:68-69`, `sop-workspace-provider.tsx:43-45`).
- Policy precedents exist for every verb: `departments_read` uses
  `has_org_tool_access(workspace_id, 'view')` (`20260707120000_departments.sql:96-97`),
  the sops insert policy uses `has_org_tool_access(workspace_id, 'edit')`
  (`20260701121000_sops_org_tool_rls.sql:42-45`), and `departments_write` uses
  `has_workspace_role(workspace_id, array['owner','admin'])`
  (`20260707120000_departments.sql:100-103`).
- The near-duplicate-proof index has a precedent too: `departments_ws_code_uidx` on
  `(workspace_id, lower(btrim(code)))` (`20260707120000_departments.sql:18-19`).
- `workspaces.id` is `text` (`20260518231500_add_auth_workspaces_projects.sql:22`), so the
  FK column type follows.

## Changes

### Database (one migration) — CLAUDE.md recipe #1, schema + RLS first

`supabase/migrations/20260726120000_sop_rasic_roles.sql` — purely additive. Neither
`enforce_sop_transition` nor `sign_sop` is touched, so the patched-in-place rule does not
come into play.

```sql
create table public.sop_rasic_roles (
  id           text primary key default gen_random_uuid()::text,
  workspace_id text not null references public.workspaces(id) on delete cascade,
  name         text not null,
  created_by   uuid references auth.users(id),
  created_at   timestamptz not null default now()
);
create unique index sop_rasic_roles_ws_name_uidx
  on public.sop_rasic_roles (workspace_id, lower(btrim(name)));
```

- The unique index kills case and edge-whitespace near-duplicates at the source of truth;
  internal-whitespace collapse is the app-side normalizer's job (Domain, below). Between
  the two, "Team Leader", " team leader " and "Team  Leader" are one role.
- No `updated_at` / `set_updated_at` trigger, deliberately: nothing reads it. Add it when
  something does.
- RLS — enable, then one policy per verb, each mirroring the cited precedent:
  - select → `has_org_tool_access(workspace_id, 'view')` (as `departments_read`)
  - insert → `has_org_tool_access(workspace_id, 'edit')` (as the sops insert policy)
  - update, delete → `has_workspace_role(workspace_id, array['owner','admin']::workspace_role[])`
    (as `departments_write`)

Then `npm run gen:types` (needs SUPABASE_ACCESS_TOKEN) and commit the updated
`src/lib/database.types.ts`.

### Domain — pure and tested (recipe #2)

In `src/domain/departments.ts`, beside the vocabulary it extends; tests in the existing
`departments.test.ts`:

- `GENERAL_RASIC_ROLES` — the eight names, readonly, next to `STANDARD_POSITION_TITLES`.
- `normalizeRasicRoleName(raw: string): string | null` — trim, collapse internal
  whitespace runs to one space, `null` when empty. The "what counts as a role name"
  decision lives here, not inline in a component.
- `rasicRoleOptions(owningDepartmentId, departments, workspaceRoleNames)` — assembles the
  grouped options from the three sources, returning plain `{ value; label; group }`
  records. Structurally compatible with `ThemedSelectOption` (`themed-select.tsx:16-24`)
  without importing it: domain code imports nothing from `src/components`. Behavior:
  - Owning department's titles first, remaining departments alphabetically (today's
    sort), then General, then "Added by your team"; each group contiguous.
  - Case-insensitive dedupe on the committed **value** across sources; the first source in
    display order wins (departments → General → added).
  - The existing same-title-in-two-departments disambiguation — value becomes
    `${title} — ${department.name}` (`process-flowchart.tsx:60-68`) — is preserved. That
    is disambiguation across departments, not duplication across sources.

### Store (recipe #3)

`src/lib/sop/rasic-roles/store.ts`, the `src/lib/*/store.ts` pattern:

- `listRasicRoles(workspaceId: string, client?: SupabaseClient<Database>): Promise<RasicRole[]>`
  with `const supabase = client ?? createPlannerSupabaseClient();` — same shape as
  `listDepartments` (`src/lib/departments/store.ts:60-62`). `RasicRole` is
  `{ id: string; name: string }`.
- `addRasicRole(workspaceId, name)`, `renameRasicRole(id, name)`, `deleteRasicRole(id)` —
  writes are client-only, so no injected client: the optional parameter exists to let
  reads serve server components, and nothing on the server calls these.
- Both write paths pass the name through `normalizeRasicRoleName` first — validate at the
  boundary.
- `addRasicRole` treats a 23505 from `sop_rasic_roles_ws_name_uidx` as "already present"
  and returns the existing row instead of throwing: two authors typing the same role
  concurrently is the expected case, and the loser must not see an error. (Precedent for
  constraint-aware 23505 handling: `sopConstraintMessage`, `src/lib/sop/store.ts:98-106`.)

### ThemedSelect: opt-in `allowCustomValue`

`src/components/themed-select.tsx` gains a single prop, `allowCustomValue?: boolean`,
**defaulting to false**. When absent, all 56 existing call sites render and behave exactly
as today. When set:

- While open, the trigger renders as a text input; typing filters the options across all
  groups (case-insensitive label match), group headings included only for surviving
  options.
- When the normalized input matches no option value case-insensitively, a final
  `Use "<name>"` entry appears; committing it calls the existing `onChange` with the
  normalized name.
- When the input is a case/whitespace variant of an existing option, no "Use" entry
  appears and Enter commits the existing option — canonical casing wins, a duplicate is
  never created.
- ThemedSelect stays dumb. It does not know what a RASIC role is and never touches
  Supabase; it only reports a committed string through `onChange`. Persistence is the
  caller's problem.

### Editor wiring (`"use client"` for a reason: interactivity — recipe #5)

- `sop-editor.tsx` lazy-loads `listRasicRoles(workspaceId)` (the `linkableSops` precedent)
  and passes `ProcessFlowchart` the workspace role names, the owning department id
  (`selectedDepartmentId`), and an `onCreateRole(name)` callback that calls `addRasicRole`
  and appends to local state.
- `process-flowchart.tsx`: the `roleOptions` memo becomes a call to `rasicRoleOptions`;
  only the role ThemedSelect (`process-flowchart.tsx:154-172`) gains `allowCustomValue` —
  the RASIC matrix-cell selects and every other ThemedSelect in the app do not pass the
  prop. `setRole` detects a committed value absent from the assembled options and fires
  `onCreateRole`: the document write is the existing `onChange` path, the shared-list
  insert rides the same gesture. That is decision 3 in one place.
- The "Current role" fallback group stays, now as the last resort for values in none of
  the three sources — roles an admin later renamed or deleted, and converted documents.
- Incidentally, the `roleOptions.length === 0` half of the add-Role disable
  (`process-flowchart.tsx:189-191`) becomes unreachable: General always exists.

### Admin panel

A workspace-added-roles section inside `DepartmentsAdmin` — settings tab, existing
`manage` gate, no new route, no new gate: list from `listRasicRoles`, inline rename via
`renameRasicRole`, delete via `deleteRasicRole`. Optimistic update with rollback on error,
the pattern the member handlers in the same file already use (`handleRoleChange`,
`handleRemove`).

## Consequences

- **Rename and delete curate the offered list only; documents are untouched.**
  `procedure.roles` is free text on the document, so a role renamed or deleted after use
  keeps its old string on every document that used it and renders through the "Current
  role" fallback. This is deliberate: outside draft the document is frozen by the
  transition guard and signatures bind to `content_hash` — rewriting documents on rename
  would void signatures.
- A role typed by any author is instantly visible to every author in the workspace. The
  owner chose immediate visibility with later cleanup over any gatekeeping.

## Deliberately not doing

- **Not touching member position titles.** The roster dropdown in DepartmentsAdmin
  (`departments-admin.tsx:581-596`) keeps reading `standardPositionTitlesForDepartment`
  as today. Reason: decision 1 — collective actors like "Associates/Employees" and "Board
  of Management" are process actors, not job titles, and must never be offered when naming
  a real employee.
- **Not seeding the eight General roles into the database.** Reason: no per-workspace
  seeding step, new workspaces work immediately, and a code-shipped baseline cannot be
  accidentally deleted the way rows can. Admin curation applies exactly where drift
  happens — typed roles.
- **No approval queue for new roles.** Reason: the owner explicitly chose immediate
  visibility with later owner/admin cleanup.
- **Not duplicating ThemedSelect into a separate creatable combobox.** Reason: ThemedSelect
  is ~250 lines of listbox semantics, keyboard navigation and portal positioning
  (`themed-select.tsx`); a fork would silently drift from every fix applied to the
  original. One opt-in prop is far cheaper than two diverging listboxes.
- **Not rewriting documents on rename/delete.** See Consequences — voiding signatures for
  a display nicety is a bad trade.

## Verification

1. Domain unit tests (`departments.test.ts`): group order with the owning department
   first; contiguous groups; cross-source case-insensitive dedupe with
   departments → General → added precedence; the preserved two-department title
   disambiguation; `normalizeRasicRoleName` on trim, internal-whitespace collapse, and
   empty input.
2. Component tests — a new `src/components/themed-select.test.tsx`; the component has
   none today, so the opt-in default gains its first direct coverage here. Without the prop, the trigger stays a
   button and options render as today — the 56-call-site protection property; with it,
   typing filters, an unmatched value offers "Use", committing reports the normalized
   name, and a case variant selects the existing option with no "Use" entry.
3. pgTAP `supabase/tests/sop_rasic_roles_test.sql` (fixture pattern of
   `sop_rls_test.sql`): a workspace member with org-tool edit can insert; an org-tool
   viewer can select but not insert; a non-admin editor cannot update or delete; an
   owner/admin can rename and delete; a case-variant insert fails on
   `sop_rasic_roles_ws_name_uidx`.
4. `npm run typecheck`, `lint`, `test`, `build`.
5. `supabase db reset` + `supabase test db` — the migration must apply from scratch.
6. Drive it live (recipe #6 — a green suite does not prove a rendered screen): type a new
   role in the editor's role dropdown; confirm it lands on the document and appears under
   "Added by your team" after a reload; rename and delete it in the settings tab; confirm
   the document that used it still renders the old string under "Current role".
