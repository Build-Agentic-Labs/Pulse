# SOP Builder — Department-Scoped Authoring

**Date:** 2026-07-09
**Status:** Approved (design), pending implementation plan
**Related:** [2026-07-07-sop-management-design.md](./2026-07-07-sop-management-design.md) (§4 departments, §5 access/RLS)

## 1. Goal

Let a user assign a SOP to an **owning department** from the SOP **builder** (create flow),
scoped to the departments they belong to, so that:

- Every new SOP is born with a department the author is a member of.
- The `DEPT-TYPE-NNN` number is minted from that department automatically and is read-only.
- A user who belongs to **no** department cannot create SOPs.

This work originally moved department assignment into the builder. The legacy separate control
route has since been removed; review and approval now run through the editor and review queue.

## 2. Ground truth (already in the codebase)

The backend already enforces department scoping — this work is almost entirely UI/app-layer.

- **RLS already scopes writes.** `sops` insert/update require `has_org_tool_access(edit)` **and**
  `has_department_role(department_id, …)`, with a grandfather escape for a `null` department or a
  department with no members. See [`20260708120000_sops_dept_scoped_rls.sql`](../../../supabase/migrations/20260708120000_sops_dept_scoped_rls.sql).
- **Number minting already authorizes the caller.** `next_sop_number()` raises
  *"Not authorized to mint numbers for this department"* unless the caller holds a role in it. See
  [`20260707121500_doc_number_counter.sql`](../../../supabase/migrations/20260707121500_doc_number_counter.sql).
- **The client helper exists.** `fetchMyDeptRoles(workspaceId)` in
  [`departments/store.ts`](../../../src/lib/departments/store.ts) returns the user's departments and role in each.
- **All pre-existing SOPs are back-filled** into a per-workspace `UNA / Unassigned` department (no
  members ⇒ managers-only). There are no orphaned `null`-department SOPs. Because `UNA` has no
  members, it never appears in anyone's `fetchMyDeptRoles()`, so new SOPs can never land there.

## 3. Locked decisions

1. **Department is required** to create a SOP. A user in **zero** departments is **blocked** from
   creating SOPs (this also applies to workspace admins who aren't department members — they must be
   added to a department first).
2. **Number is auto-minted from the department and read-only** (no free-text override).
3. **Derive the department from membership; don't add a selection step.** One department ⇒ show a
   static label. Multiple ⇒ a small inline dropdown, defaulted to the first. No wizard/gate step.
4. **Remove** the `SopDepartmentAssign` widget from the control page.

## 4. Behavior

### 4.1 Create flow (`/sops/new`)

Membership is read once via a new `listMyDepartments(workspaceId)` helper (see §5).

| Membership | Builder renders |
|---|---|
| 0 departments | Blocking screen (same shape as the existing "create an organization first" guard in [`sop-new-client.tsx`](../../../src/components/sop/sop-new-client.tsx)): *"You must belong to a department to create SOPs — ask an admin to add you."* The editor does not render. |
| exactly 1 | Header shows a static **Owning department** label (`CODE · Name`). No control to change it. |
| 2 or more | Header shows an inline **Owning department** `<select>` of the user's departments, defaulted to the first. |

- The **SOP number** field is read-only. Before the first save it shows a preview
  `{CODE}-{DOC_TYPE}-###`. Doc type defaults to `SOP` (the existing `DOC_TYPES` list stays available
  if we choose to expose it; default `SOP` is sufficient for v1).
- Department is mutable **only until the first save**. On the first save the number is minted and the
  department is frozen; the header then shows the read-only label + minted number.

### 4.2 Mint on first save

- On the first `persist()` for a new SOP, the editor calls `mintSopNumber(workspaceId, departmentId, docType)`
  ([`review.ts`](../../../src/lib/sop/review.ts)), sets `sop.meta.sopNumber` to the minted value, and
  inserts with `department_id` + `doc_type` (see §5 `saveSop`).
- Minting happens exactly once, coincident with row creation — no re-mint logic and no sequence gaps
  from abandoned drafts.
- If the insert fails after minting, the (rare) gap is acceptable; the counter tolerates gaps.

### 4.3 Existing SOPs

- The editor's department UI is **new-SOP only**. Editing an existing SOP is unchanged in the header
  (department is not shown/edited in the editor; the control page still displays the owning dept).
- To change an existing SOP's department, delete the draft and recreate it. With the control-page
  widget removed there is no in-place reassignment path (accepted trade-off of decision #4).

## 5. App-layer changes

- **`departments/store.ts`** — add `listMyDepartments(workspaceId): Promise<Department[]>` that returns
  the `Department` objects the current user is an explicit member of (author/reviewer/approver). Built
  from `listDepartments` ∩ the user's `department_members` rows (reuses the logic already in
  `fetchMyDeptRoles`, but returns full `Department` objects for display).
- **`sop/store.ts`**
  - `SaveSopOptions` gains `departmentId?: string` and `docType?: string`. On the **INSERT** branch of
    `saveSop`, write `department_id` and `doc_type` into the row. (Not written on the guarded UPDATE
    branch — department is frozen after creation.)
  - `mapSop()` overlays the promoted `sop_number` column onto `meta.sopNumber` (same pattern it already
    uses for `status`/`id`/timestamps), making the **column authoritative** for the number everywhere.
    `sop_number` is already in `SOP_COLUMNS`. **Fixes a latent divergence** between the column (used by
    the list) and `document.meta.sopNumber` (used by the editor).
- **`sop-new-client.tsx`** — fetch `listMyDepartments`; render the blocking screen when empty; pass the
  department list to `SopEditor`.
- **`sop-editor.tsx`** — accept the (new-SOP) department list; render the label/dropdown per §4.1;
  make the number read-only with a preview; mint on first save and thread `departmentId`/`docType`
  into `saveSop`.
- **`sop-approval-panel.tsx`** — remove the `SopDepartmentAssign` block (lines ~345-349). Keep the
  read-only "Owning dept" display.
- **`sop-department-assign.tsx`** — delete once its only consumer is gone.

No database migration is required — the schema, RLS, and RPCs already exist.

## 6. Error handling

- Blocking screen for no-department users is a normal render state, not an error.
- Minting errors (`Not authorized…`) surface through the existing editor save-error path
  (`setSaveError`). They should not occur given the picker is scoped to the user's departments, but are
  handled defensively.
- Optimistic-concurrency and conflict handling in `saveSop`/`persist()` are unchanged.

## 7. Testing

- **`listMyDepartments`** — returns only departments the user is a member of; excludes `UNA`/non-member
  departments; empty when the user has none.
- **`saveSop`** — INSERT writes `department_id` + `doc_type`; UPDATE does not touch them.
- **`mapSop`** — `meta.sopNumber` reflects the `sop_number` column when they differ.
- **Editor rendering** — 0 (blocked) / 1 (label) / many (dropdown) department cases; number read-only;
  preview vs minted value.
- **Regression** — existing SOP list, lifecycle, numbering, and export tests stay green.

## 8. Non-goals (YAGNI)

- No in-place department reassignment for existing SOPs (delete + recreate instead).
- No exposure of doc types beyond default `SOP` in v1 (the `WI`/`FRM`/`POL` list can be surfaced later).
- No changes to the RLS grandfather clause or a migration to forbid `null`-department inserts at the DB
  level — the UI requirement (department always set at creation) closes the path in practice; a DB-level
  `NOT NULL` tightening is a separate, later hardening step.
- No back-fill of `meta.sopNumber` for the handful of SOPs assigned via the old control-page flow; the
  `mapSop` column-overlay makes them correct on read without a data migration.
