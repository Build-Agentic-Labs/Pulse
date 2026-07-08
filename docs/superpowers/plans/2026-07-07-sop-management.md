# SOP Management Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add department-owned SOPs with an enforced document-control lifecycle and a DB-enforced review/approve workflow with e-signatures, built on the existing `sops` table.

**Architecture:** Three coordinated layers, all enforced in Postgres (no server tier): (1) `departments` + `department_members` + `has_department_role`; (2) promoted control columns + a plain `BEFORE UPDATE` transition/freeze trigger + `sop_revisions`/`sop_signatures` WORM tables named by `sops.effective_revision_id`; (3) React surfaces mirroring the Planning-space triad. A TypeScript `canTransitionSop` predicate mirrors the DB trigger for the UI only.

**Tech Stack:** Next.js (App Router), React, TypeScript, Supabase (Postgres + RLS + SECURITY DEFINER functions), Vitest, Playwright, Tailwind (Nothing design system).

## Global Constraints

- **Enforcement is DB-only.** Every rule lives in RLS + `SECURITY DEFINER` triggers/functions; TS predicates are UI convenience only. Never trust client-sent `status`, `approved_by`, `content_hash`, `signer_printed_name`.
- **Migrations:** `supabase/migrations/YYYYMMDDHHMMSS_snake.sql`, timestamps strictly after `20260706130000`, idempotent (`if not exists`, `do $$ … pg_type … $$` for enums, `drop policy if exists` then `create`), all auth-touching functions `security definer set search_path=''` with schema-qualified names.
- **Additive only on `sops`:** `add column if not exists`; new control fields are promoted columns stripped from `document` jsonb like `status` already is (`src/lib/sop/store.ts:146`).
- **Design system:** Nothing aesthetic — reuse existing `ui-*` classes; black `--color-accent` primary, red reserved for danger.
- **Do NOT** apply migrations to the live DB, push to main, or deploy — those are the user's steps.
- **Commit cadence:** one commit per task, conventional-commit messages, on branch `worktree-sop-space`.

---

## File Structure

**Migrations (create):**
- `20260707120000_departments.sql` — `departments`, `department_sop_role` enum, `department_members`, `has_department_role()`
- `20260707120500_sops_department_link.sql` — `sops.department_id` + backfill "Unassigned" dept
- `20260707121000_space_access_quality.sql` — extend `space_access` CHECK to add `'quality'`
- `20260707121500_doc_number_counter.sql` — `doc_number_counter` + `next_sop_number()`, seeded above legacy maxima
- `20260707122000_sops_control_columns.sql` — promoted control columns + extended status CHECK
- `20260707122500_sop_transition_guard_v1.sql` — `enforce_sop_transition()` v1 + status-audit trigger
- `20260707123000_sop_revisions_signatures.sql` — WORM `sop_revisions` + `sop_signatures` + `effective_revision_id`
- `20260707123500_sop_transition_guard_v2.sql` — superseding trigger: signature preconditions + effective snapshot

**Domain (create/modify):** `src/domain/sop/schema.ts` (mod), `src/domain/sop/lifecycle.ts` (new: `canTransitionSop`, statuses), `src/domain/sop/numbering.ts` (new: format/parse), `src/domain/sop/version.ts` (new: bump logic), `src/domain/departments.ts` (new: types + role helpers).

**Store (create/modify):** `src/lib/sop/store.ts` (mod), `src/lib/departments/store.ts` (new), `src/lib/sop/revisions.ts` (new: snapshot/signature reads).

**Components (create/modify):** `src/components/sop/departments-admin.tsx` (new), `src/components/sop/sop-access-gate.tsx` (new), `src/components/sop/sop-approval-panel.tsx` (new), `src/components/sop/effective-library.tsx` (new), `src/components/sop/review-queue.tsx` (new); modify `sop-list.tsx`, `sop-editor.tsx`, `sop-new-client.tsx`, `sop-detail-client.tsx`, `sop-shell.tsx`, `sop-workspace-provider.tsx`, `src/components/spaces.tsx`, `app/api/sops/extract/route.ts`.

**Tests:** `src/domain/sop/*.test.ts` (lifecycle, numbering, version), `src/lib/**/__tests__`, `tests/e2e/sop-approval.spec.ts`.

---

# PHASE 1 — Departments

### Task 1.1: `departments` + membership + `has_department_role` migration

**Files:** Create `supabase/migrations/20260707120000_departments.sql`

**Interfaces — Produces:** tables `public.departments`, `public.department_members`; enum `department_sop_role`; function `public.has_department_role(dept_id text, roles department_sop_role[]) returns boolean`.

- [ ] **Step 1: Write the migration**

```sql
-- departments: owning entity for SOPs, admin-managed, one Quality gate per workspace.
create table if not exists public.departments (
  id text primary key,
  workspace_id text not null references public.workspaces(id) on delete cascade,
  code text not null,
  name text not null,
  is_quality_gate boolean not null default false,
  created_by uuid,
  updated_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists departments_ws_code_uidx
  on public.departments (workspace_id, lower(btrim(code)));
create unique index if not exists departments_one_quality_gate_uidx
  on public.departments (workspace_id) where is_quality_gate;

do $$ begin
  if not exists (select 1 from pg_type where typname = 'department_sop_role') then
    create type public.department_sop_role as enum ('author','reviewer','approver');
  end if;
end $$;

create table if not exists public.department_members (
  department_id text not null references public.departments(id) on delete cascade,
  user_id uuid not null,
  dept_role public.department_sop_role not null default 'author',
  granted_by uuid,
  updated_at timestamptz not null default now(),
  primary key (department_id, user_id)
);

-- Cumulative-role check: does the caller hold >= any of `roles` in this dept,
-- OR (for approver) act as an org-wide Quality approver? Managers/superadmin fold in
-- for dept-scoped verbs via has_workspace_role; the Quality step gates on real membership.
create or replace function public.has_department_role(dept_id text, roles public.department_sop_role[])
returns boolean language sql stable security definer set search_path = '' as $$
  with d as (select workspace_id, is_quality_gate from public.departments where id = dept_id)
  select dept_id is not null and (
    exists (
      select 1 from public.department_members m
      where m.department_id = dept_id and m.user_id = auth.uid() and m.dept_role = any(roles)
    )
    -- org-wide Quality approver satisfies 'approver' for any dept
    or ('approver' = any(roles) and exists (
      select 1 from public.department_members m
      join public.departments q on q.id = m.department_id
      where m.user_id = auth.uid() and m.dept_role = 'approver' and q.is_quality_gate
        and q.workspace_id = (select workspace_id from d)
    ))
    -- workspace managers fold in for dept-scoped convenience
    or public.has_workspace_role((select workspace_id from d), array['owner','admin']::public.workspace_role[])
  );
$$;

alter table public.departments enable row level security;
alter table public.department_members enable row level security;

drop policy if exists departments_read on public.departments;
create policy departments_read on public.departments for select
  using (public.has_org_tool_access(workspace_id, 'view'));
drop policy if exists departments_write on public.departments;
create policy departments_write on public.departments for all
  using (public.has_workspace_role(workspace_id, array['owner','admin']::public.workspace_role[]))
  with check (public.has_workspace_role(workspace_id, array['owner','admin']::public.workspace_role[]));

drop policy if exists dept_members_read on public.department_members;
create policy dept_members_read on public.department_members for select
  using (user_id = auth.uid() or exists (
    select 1 from public.departments d where d.id = department_id
      and public.has_workspace_role(d.workspace_id, array['owner','admin']::public.workspace_role[])));
drop policy if exists dept_members_write on public.department_members;
create policy dept_members_write on public.department_members for all
  using (exists (select 1 from public.departments d where d.id = department_id
      and public.has_workspace_role(d.workspace_id, array['owner','admin']::public.workspace_role[])))
  with check (exists (select 1 from public.departments d where d.id = department_id
      and public.has_workspace_role(d.workspace_id, array['owner','admin']::public.workspace_role[])));
```

- [ ] **Step 2: Verify against conventions** — confirm `workspaces.id` type (text), `workspace_role` enum name, and `has_workspace_role`/`has_org_tool_access` signatures by grepping the referenced migrations; adjust casts if `workspaces.id` is uuid.

Run: `grep -rn "create type public.workspace_role\|function public.has_workspace_role\|function public.has_org_tool_access\|create table public.workspaces\|create table if not exists public.workspaces" supabase/migrations`
Expected: signatures match the calls above.

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/20260707120000_departments.sql
git commit -m "feat(sop): departments, department_members, has_department_role"
```

### Task 1.2: Department domain types + role helpers (TDD)

**Files:** Create `src/domain/departments.ts`, `src/domain/departments.test.ts`

**Interfaces — Produces:** `type Department`, `type DeptRole = 'author'|'reviewer'|'approver'`, `type DepartmentMember`, `canAuthor(role)`, `canSignReview(role)`, `canDeptApprove(role)`, `roleAtLeast(role, min)`.

- [ ] **Step 1: Write failing tests**

```ts
import { describe, it, expect } from "vitest";
import { roleAtLeast, canAuthor, canSignReview, canDeptApprove } from "./departments";

describe("dept role capabilities (cumulative)", () => {
  it("author can author but not sign", () => {
    expect(canAuthor("author")).toBe(true);
    expect(canSignReview("author")).toBe(false);
    expect(canDeptApprove("author")).toBe(false);
  });
  it("reviewer can author + review, not approve", () => {
    expect(canSignReview("reviewer")).toBe(true);
    expect(canDeptApprove("reviewer")).toBe(false);
  });
  it("approver can do all", () => {
    expect(canDeptApprove("approver")).toBe(true);
    expect(canSignReview("approver")).toBe(true);
  });
  it("roleAtLeast orders author<reviewer<approver", () => {
    expect(roleAtLeast("approver", "reviewer")).toBe(true);
    expect(roleAtLeast("author", "reviewer")).toBe(false);
  });
});
```

- [ ] **Step 2: Run — expect fail** (`npx vitest run src/domain/departments.test.ts`). Expected: module not found.
- [ ] **Step 3: Implement**

```ts
export type DeptRole = "author" | "reviewer" | "approver";
export interface Department { id: string; workspaceId: string; code: string; name: string; isQualityGate: boolean; }
export interface DepartmentMember { departmentId: string; userId: string; deptRole: DeptRole; }
const ORDER: Record<DeptRole, number> = { author: 0, reviewer: 1, approver: 2 };
export function roleAtLeast(role: DeptRole, min: DeptRole): boolean { return ORDER[role] >= ORDER[min]; }
export function canAuthor(role: DeptRole): boolean { return roleAtLeast(role, "author"); }
export function canSignReview(role: DeptRole): boolean { return roleAtLeast(role, "reviewer"); }
export function canDeptApprove(role: DeptRole): boolean { return roleAtLeast(role, "approver"); }
```

- [ ] **Step 4: Run — expect pass.**
- [ ] **Step 5: Commit** (`feat(sop): department domain roles`).

### Task 1.3: `sops.department_id` + "Unassigned" backfill migration

**Files:** Create `supabase/migrations/20260707120500_sops_department_link.sql`

**Interfaces — Produces:** `sops.department_id text references departments(id)`; one seeded `is_quality_gate=false` "Unassigned" department per workspace that has SOPs; existing SOPs backfilled to it.

- [ ] **Step 1: Write migration** — `alter table public.sops add column if not exists department_id text references public.departments(id);` then, in a `do $$` block, for each distinct `workspace_id` in `sops`, `insert into departments (id, workspace_id, code, name) values (gen_random_uuid()::text, ws, 'GEN', 'Unassigned') on conflict do nothing`, and `update sops set department_id = <that dept> where workspace_id = ws and department_id is null`. Keep `department_id` nullable (NULL ⇒ manager-only-governed).
- [ ] **Step 2: Commit** (`feat(sop): link sops to departments + backfill unassigned`).

### Task 1.4: `space_access` CHECK migration + `SopAccessGate`

**Files:** Create `supabase/migrations/20260707121000_space_access_quality.sql`; create `src/components/sop/sop-access-gate.tsx`; modify `src/components/spaces.tsx` (already has `quality`).

- [ ] **Step 1: Migration** — `alter table public.space_access drop constraint if exists space_access_known_space;` then `add constraint space_access_known_space check (space in ('planning','production','quality'));`
- [ ] **Step 2: `SopAccessGate`** — mirror `PlanningAccessGate` (read `fetchMySpaceAccess(workspaceId,'quality')`; render children or a request-access notice). Reuse the planning gate's structure verbatim, swapping the space string.
- [ ] **Step 3: Commit** (`feat(sop): quality space access gate`).

### Task 1.5: `doc_number_counter` + `next_sop_number` migration

**Files:** Create `supabase/migrations/20260707121500_doc_number_counter.sql`

**Interfaces — Produces:** `public.next_sop_number(workspace_id text, department_id text, doc_type text) returns text`.

- [ ] **Step 1: Write migration**

```sql
create table if not exists public.doc_number_counter (
  workspace_id text not null,
  department_id text not null references public.departments(id) on delete cascade,
  doc_type text not null,
  next_seq int not null default 1,
  primary key (workspace_id, department_id, doc_type)
);
alter table public.doc_number_counter enable row level security;
-- no direct policies: access only via the definer function below.

create or replace function public.next_sop_number(p_workspace text, p_department text, p_doc_type text)
returns text language plpgsql security definer set search_path = '' as $$
declare v_code text; v_seq int;
begin
  if not public.has_department_role(p_department, array['author','reviewer','approver']::public.department_sop_role[]) then
    raise exception 'not authorized to mint numbers for this department';
  end if;
  select code into v_code from public.departments where id = p_department and workspace_id = p_workspace;
  if v_code is null then raise exception 'department not in workspace'; end if;
  insert into public.doc_number_counter (workspace_id, department_id, doc_type, next_seq)
    values (p_workspace, p_department, p_doc_type, 2)
  on conflict (workspace_id, department_id, doc_type)
    do update set next_seq = public.doc_number_counter.next_seq + 1
  returning next_seq - 1 into v_seq;
  return upper(v_code) || '-' || upper(p_doc_type) || '-' || lpad(v_seq::text, 3, '0');
end $$;
```

- [ ] **Step 2: Seed above legacy maxima** — in a trailing `do $$` block, pre-populate `doc_number_counter.next_seq` from any parseable existing `sops.sop_number` maxima per (dept,type) so first mint can't collide with `sops_workspace_number_unique_idx`.
- [ ] **Step 3: Commit** (`feat(sop): transactional DEPT-TYPE-NNN numbering`).

### Task 1.6: Departments store + admin UI

**Files:** Create `src/lib/departments/store.ts`, `src/components/sop/departments-admin.tsx`; wire a route/nav entry in `sop-shell.tsx` sidebar + `app/sops/departments/page.tsx`.

**Interfaces — Consumes:** `Department`, `DepartmentMember` (Task 1.2). **Produces:** `listDepartments(ws)`, `saveDepartment(d)`, `listMembers(deptId)`, `setMember(deptId,userId,role)`, `removeMember(deptId,userId)`.

- [ ] **Step 1: Store** — Supabase CRUD via `createPlannerSupabaseClient()`, snake↔camel mapping like `src/lib/planning/store.ts`. Enforce nothing client-side beyond shaping (RLS is the gate).
- [ ] **Step 2: Admin UI** — build to Screen 01 (`sop/01-departments.html`): department table (code chip, name, member/SOP counts, Quality-gate badge), a "+ New department" form (code + name + is_quality_gate), and a members panel with role chips. Reuse `ui-panel`, `ui-chip`, `ui-btn-primary`, `ui-mono-label`. Managers only (gate on `canManage`).
- [ ] **Step 3: Manual smoke** — `npm run build`; render check.
- [ ] **Step 4: Commit** (`feat(sop): departments admin UI + store`).

### Task 1.7: Phase 1 verification gate

- [ ] Run `npm run typecheck && npx vitest run && npm run lint && npm run build`. Fix failures. Commit any fixes (`chore(sop): phase 1 green`).

---

# PHASE 2 — Enforced control + bug fixes

### Task 2.1: SOP lifecycle predicate (TDD)

**Files:** Create `src/domain/sop/lifecycle.ts`, `src/domain/sop/lifecycle.test.ts`

**Interfaces — Produces:** `type SopStatus = 'draft'|'in_review'|'approved'|'effective'|'obsolete'`; `canTransitionSop({from,to,role,isSubmitter,isQualityApprover,hasDept})`.

- [ ] **Step 1: Failing tests** — cover: `draft→in_review` needs `hasDept` + author; `in_review→approved` needs dept `approver` AND `!isSubmitter`; `approved→effective` needs `isQualityApprover` AND not the dept approver; `effective→draft` (revise) allowed for author; `in_review→draft` (reject) allowed; illegal edges (`draft→approved`, `effective→approved`) rejected; self-approval (`isSubmitter && to==='approved'`) rejected.

```ts
import { describe, it, expect } from "vitest";
import { canTransitionSop } from "./lifecycle";
const base = { role: "approver" as const, isSubmitter: false, isQualityApprover: false, hasDept: true };
describe("canTransitionSop", () => {
  it("rejects self-approval", () =>
    expect(canTransitionSop({ ...base, from: "in_review", to: "approved", isSubmitter: true }).ok).toBe(false));
  it("allows dept approver to approve", () =>
    expect(canTransitionSop({ ...base, from: "in_review", to: "approved" }).ok).toBe(true));
  it("blocks skipping to effective without quality", () =>
    expect(canTransitionSop({ ...base, from: "approved", to: "effective" }).ok).toBe(false));
  it("blocks in_review without a department", () =>
    expect(canTransitionSop({ ...base, from: "draft", to: "in_review", hasDept: false }).ok).toBe(false));
  it("rejects illegal edge draft→approved", () =>
    expect(canTransitionSop({ ...base, from: "draft", to: "approved" }).ok).toBe(false));
});
```

- [ ] **Step 2–4:** Run (fail) → implement a pure predicate returning `{ ok: boolean; reason?: string }` encoding §4.3/§6 → run (pass).
- [ ] **Step 5: Commit** (`feat(sop): canTransitionSop lifecycle predicate`).

### Task 2.2: Version + numbering formatting (TDD)

**Files:** `src/domain/sop/version.ts`(+test), `src/domain/sop/numbering.ts`(+test). Tests: `1.0` first-effective, minor/major bumps, `parseSopNumber('QA-SOP-014') → {dept:'QA',type:'SOP',seq:14}`, `formatSopNumber`. Implement, pass, commit (`feat(sop): version + numbering formatting`).

### Task 2.3: `sops` control columns + extended status migration

**Files:** Create `supabase/migrations/20260707122000_sops_control_columns.sql`

- [ ] **Step 1:** `add column if not exists` for `doc_type`, `seq_int`, `major_version`, `minor_version`, `submitted_by uuid`, `approved_by uuid`, `approved_at timestamptz`, `effective_date date`, `next_review_date date`, `review_interval_months smallint default 24`, `effective_revision_id text`, `rejected_reason text`, `rejected_by uuid`, `change_significance text`, `requires_retraining boolean default false`. Then swap the status CHECK: `drop constraint if exists` the old check, `add constraint sops_status_check check (status in ('draft','in_review','approved','effective','obsolete'))`.
- [ ] **Step 2: Commit** (`feat(sop): document-control columns + extended status`).

### Task 2.4: Transition guard v1 + status audit migration

**Files:** Create `supabase/migrations/20260707122500_sop_transition_guard_v1.sql`

**Interfaces — Produces:** trigger `enforce_sop_transition` (BEFORE UPDATE on `sops`), trigger `audit_sop_status` (AFTER UPDATE OF status).

- [ ] **Step 1: Write the guard** — plain `before update` function, `security definer set search_path=''`:
  - if `OLD.status <> 'draft'`: reject when `NEW.document IS DISTINCT FROM OLD.document OR NEW.title <> OLD.title OR NEW.sop_number <> OLD.sop_number OR NEW.department_id IS DISTINCT FROM OLD.department_id`;
  - reject `NEW.deleted_at` set (was null) unless `OLD.status in ('draft','obsolete')` or `has_workspace_role(owner/admin)`;
  - if `NEW.status = OLD.status`: return NEW;
  - validate edge per §4.3 (a `case`); on `→in_review`: require `NEW.department_id is not null`, `NEW.submitted_by := auth.uid()`; on reject `→draft` from `in_review`: require `NEW.rejected_reason` present, `NEW.submitted_by := null`;
  - on `→approved`: `NEW.approved_by := auth.uid(); NEW.approved_at := now();` require `has_department_role(NEW.department_id, array['approver'])`; reject if `auth.uid() = coalesce(OLD.submitted_by, OLD.created_by)` or `OLD.submitted_by is null`;
  - `→effective`, `→obsolete`, `→draft (revise)` role checks; (effective snapshot + signatures added in v2).
- [ ] **Step 2: Status audit** — small `after update of status` function inserting `(workspace_id, actor_id=auth.uid(), action='sop.status', target_type='sop', target_id=NEW.id, details=jsonb_build_object('from',OLD.status,'to',NEW.status))` into `audit_log`. No document jsonb.
- [ ] **Step 3: Commit** (`feat(sop): transition guard v1 + status audit trigger`).

### Task 2.5: Store — control columns + transitions

**Files:** Modify `src/lib/sop/store.ts`

- [ ] Extend `SOP_COLUMNS`/`SOP_LIST_COLUMNS`, the row↔domain mappers, and strip the new promoted columns from the jsonb (as `status` is). Add `transitionSop(id, to, extras)` (guarded update on `updated_at`, surfaces trigger errors as `SopConflictError`/readable message). Add `mintSopNumber(ws, dept, type)` calling the `next_sop_number` RPC. Commit (`feat(sop): store control columns + transitions`).

### Task 2.6: Fix the two live bugs + wire approval in the editor

**Files:** Modify `sop-new-client.tsx` (pass `isNew`), `sop-editor.tsx` (accept + honor `canApprove`, gate options via `canTransitionSop`, make the SOP-number field read-only once `department_id` set), `sop-workspace-provider.tsx` (expose dept roles).

- [ ] **Step 1: Regression test** — component test asserting a fresh authored SOP autosaves via INSERT (no `SopConflictError`) and that approve options enable for an approver.
- [ ] **Step 2: Fix** — pass `isNew={true}` at `sop-new-client.tsx:31`; thread `canApprove`/role from the provider; guard the status `<select>` with `canTransitionSop`.
- [ ] **Step 3: Run tests; Commit** (`fix(sop): new-SOP autosave conflict + unreachable approval`).

### Task 2.7: Converter department assignment

**Files:** Modify `app/api/sops/extract/route.ts` + convert flow in `sop-list.tsx` — assign `department_id` on convert (default the seeded "Unassigned"; picker in the convert overlay). Commit (`feat(sop): assign department on convert`).

### Task 2.8: Phase 2 verification gate — `typecheck && vitest && lint && build`; fix; commit.

---

# PHASE 3 — Review/approve & history

### Task 3.1: `sop_revisions` + `sop_signatures` + `effective_revision_id` migration

**Files:** Create `supabase/migrations/20260707123000_sop_revisions_signatures.sql`

- [ ] **Step 1:** WORM `sop_revisions` (`id, sop_id, workspace_id, version_label, document jsonb, content_hash, created_at, created_by`) and `sop_signatures` (`id, sop_id, revision_id, signer_id, meaning, signer_printed_name, signed_content_hash, rejected_reason, signed_at, auth_method, re_authenticated bool`). `alter table sops add column if not exists effective_revision_id text references sop_revisions(id)`. Enable RLS: select for dept members/managers (revisions), select org-wide for the effective one; **no update/delete policies**; `revoke update, delete on both from authenticated`.
- [ ] **Step 2:** definer function `snapshot_sop_revision(p_sop text) returns text` — inserts a revision with `content_hash = encode(sha256(convert_to(document::text,'UTF8')),'hex')`, `created_by = auth.uid()`, returns id. definer function `sign_sop(p_sop, p_revision, p_meaning)` — inserts a signature with `signer_id = auth.uid()`, `signer_printed_name` from `profiles` (verify column), `signed_content_hash` from the revision.
- [ ] **Step 3: Commit** (`feat(sop): WORM revisions + signatures + effective pointer`).

### Task 3.2: Transition guard v2 (superseding)

**Files:** Create `supabase/migrations/20260707123500_sop_transition_guard_v2.sql`

- [ ] `create or replace` `enforce_sop_transition` adding: `→approved` requires a `dept_approval` signature exists for the current content hash; `→effective` requires a `quality_approval` signature whose `signer_id <> approved_by` (distinct-signer, F4), calls `snapshot_sop_revision`, sets `NEW.effective_revision_id`, computes `NEW.next_review_date := coalesce(NEW.effective_date, current_date) + (NEW.review_interval_months||' months')::interval`. Commit (`feat(sop): transition guard v2 — signature preconditions + effective snapshot`).

### Task 3.3: Approval panel + revisions store

**Files:** Create `src/components/sop/sop-approval-panel.tsx`, `src/lib/sop/revisions.ts`; wire into `sop-detail-client.tsx`.

- [ ] Build to Screen 03: lifecycle stepper (from `status`), signature rows (from `sop_signatures`), "Approve & sign" (calls `sign_sop` then `transitionSop`), "Reject with reason", SoD/hash callouts. `revisions.ts`: `listSignatures(sopId)`, `signSop(...)`, `listRevisions(sopId)`. Commit (`feat(sop): approval panel + signatures`).

### Task 3.4: Effective library + review queue + where-used

**Files:** Create `src/components/sop/effective-library.tsx`, `review-queue.tsx`; add routes + sidebar nav; add where-used (query `tasks.sop_id`), flag obsolete/deleted links, block soft-delete when active task links exist (in `store.ts deleteSop`). Build to Screens 02/04. Commit (`feat(sop): effective library, review queue, where-used`).

### Task 3.5: E2E + Phase 3 verification gate

- [ ] Playwright `tests/e2e/sop-approval.spec.ts`: author→review→dept-approve→quality-make-effective, reject-rework, start-revision (guarded by env; skip if no test DB). Run full gate `typecheck && vitest && lint && build`; fix; commit (`test(sop): approval e2e + phase 3 green`).

---

## Self-Review

**Spec coverage:** §4 tables → Tasks 1.1,1.3,1.5,2.3,3.1; §5 RLS/access → 1.1,1.4,3.1; §6 trigger/SoD/hash → 2.4,3.2,3.1; §7 UI → 1.6,2.6,3.3,3.4; §8 bugs → 2.6; §11 phasing → phase headers; §12 cuts → honored (no `sop_approval_steps`, `parent_id`, `owner_role`, `dept_code`, `sop_revisions.status`). Covered.

**Placeholder scan:** UI tasks reference mockup screens + exact classes rather than inlining 300-line components — intentional (executor has full design-system context); DB/domain tasks carry complete code. `profiles.full_name` flagged "verify column" in 3.1.

**Type consistency:** `SopStatus`, `DeptRole`, `canTransitionSop` signature, `has_department_role(dept, roles[])`, `next_sop_number(ws,dept,type)`, `effective_revision_id` used consistently across tasks.
