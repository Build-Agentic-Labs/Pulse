# SOP Management — Departments, Document Control & Review/Approve

**Date:** 2026-07-07
**Space:** Quality (`/sops`)
**Branch:** `worktree-sop-space`
**Status:** Design — pending user review
**Mockups:** Claude Design → *Pulse Design* → card group **"Quality — SOP System"** (`sop/01`–`sop/04`)

---

## 1. Goal

Turn the current flat SOP list into a real quality-document system with three capabilities:

1. **Departments** — each department authors and *owns* its SOPs, with per-department roles.
2. **Document control** — enforced lifecycle, versioning with frozen history, department-encoded numbering, effective dates and periodic review.
3. **Review & approve** — a routed, DB-enforced approval with e-signatures and separation of duties.

## 2. Locked decisions

| Decision | Choice |
|---|---|
| Compliance depth | **ISO 9001, Part-11-ready** — signer identity + meaning + content-hash binding + author≠approver enforced by trigger; full 21 CFR Part 11 (re-auth, watermarks, training records) deferred to Phase 4, no rebuild needed |
| Versioning | **Frozen version snapshots** — append-only `sop_revisions`; exactly one `effective` version per SOP |
| Approval routing | **Dept approver → Quality** two-step, stored in a flexible step model so parallel/multi-level can be enabled later |
| Departments | **First-class, admin-managed in-app**; a user may belong to many departments with a different role in each |
| Numbering | **DEPT-TYPE-NNN** (e.g. `QA-SOP-014`) via a transactional counter; number never changes on revision |
| Quality gate | **Quality is a department** whose approvers can approve any department's SOP (the mandatory independent gate) |

## 3. Hard constraints (from the codebase)

- **No server tier / no service-role key.** Postgres RLS + `SECURITY DEFINER` triggers are the *only* enforcement layer. Every rule below ("only an approver may approve", "author ≠ approver", "one effective version") is enforced in the database, with a mirrored TypeScript predicate for the UI only.
- **Build on the existing `sops` table**, don't rewrite. New control fields are promoted columns (stripped from the `document` jsonb exactly as `status` already is). `saveSop`'s optimistic-concurrency guard stays.
- **Reuse proven patterns:** the `enforce_work_order_transition` trigger, the immutable `audit_log` + `audit_access_change()`, the `project_access` table shape + `has_*_access()` helper idiom, the `space_access` grant, and the Planning-space feature triad.
- **Migration conventions:** `supabase/migrations/YYYYMMDDHHMMSS_snake.sql`, idempotent, all auth-touching functions `security definer set search_path=''`, schema-qualified. Timestamps after the current latest (`20260706130000`).

## 4. Data model

### 4.1 New tables

**`departments`** — owning entity for SOPs.
`id text pk`, `workspace_id → workspaces on delete cascade`, `code text` (short, e.g. `QA`; unique per workspace, used in numbering), `name text`, `owner_role text null` (own by role, not person — resolves to current holder), `parent_id text null` (optional hierarchy), `created_by`, `updated_by`, `created_at`, `updated_at`.
Partial-unique index on `(workspace_id, lower(btrim(code)))`.

**`department_members`** — many-to-many membership with a per-department role (clone of `project_access` shape + RLS).
Composite PK `(department_id, user_id)`, `dept_role department_sop_role`, `granted_by`, `updated_at` (trigger).
New enum `department_sop_role ('author','reviewer','approver')`.

**`sop_revisions`** — append-only frozen snapshots.
`id`, `sop_id → sops`, `workspace_id`, `version_label text`, `document jsonb` (frozen copy), `content_hash text`, `status text`, `approved_by uuid`, `approved_at timestamptz`, `created_at`.
`CREATE UNIQUE INDEX ... ON sop_revisions(sop_id) WHERE status='effective'` → **one effective version per SOP**.
RLS: insert only via the approval path; no update/delete (immutable).

**`sop_signatures`** — append-only e-signatures (Part 11 §11.50/§11.70 shape).
`id`, `sop_id`, `revision_id → sop_revisions`, `signer_id uuid`, `meaning text` (authorship / review / approval / QA), `signer_printed_name text`, `signed_content_hash text` (binds to the exact revision), `auth_method text`, `signed_at timestamptz`.
`REVOKE UPDATE, DELETE` (WORM). `re_authenticated boolean default false` reserved for Phase 4.

**`sop_approval_steps`** — routing (ship two-step, store flexibly).
`id`, `sop_id`, `step_order int`, `kind text ('reviewer','dept_approver','quality')`, `quorum int default 1`, `state text ('pending','signed','rejected')`, `round_no int default 1`, `assignee_role text null`.

**`doc_number_counter`** — transactional numbering (no MAX+1 races).
PK `(workspace_id, department_id, doc_type)`, `next_seq int`. A `SECURITY DEFINER` function `next_sop_number(workspace, department, doc_type)` bumps and returns `DEPT-TYPE-NNN`.

### 4.2 `sops` — additive promoted columns (`add column if not exists`)

`department_id text references departments(id)` (nullable for migration; backfilled), `doc_type text default 'SOP'`, `dept_code text`, `seq_int int`, `major_version smallint`, `minor_version smallint`, `change_significance text ('MAJOR'|'MINOR'|'ADMINISTRATIVE')`, `requires_retraining boolean default false`, `approved_by uuid`, `approved_at timestamptz`, `effective_date date`, `next_review_date date`, `review_interval_months smallint default 24`.
Existing `sop_number` and its partial-unique index remain (backstop).

### 4.3 Lifecycle

Extend the `status` CHECK from `draft|in_review|approved|obsolete` to:

```
Happy path:   draft → in_review → approved → effective → superseded
Reject:       in_review → draft   (new round; prior steps closed, round_no++)
Retire:       effective → obsolete
```

`approved` = signed but not yet in force; `effective` = in force (one at a time); future-dated `effective_date` flips `approved → effective` (and prior `effective → superseded`) atomically.

## 5. Access & RLS

- **`has_department_role(department_id, roles[])`** — `SECURITY DEFINER` helper modeled on `has_org_tool_access`, folding in workspace managers/superadmin via `has_workspace_role`. Quality-department approvers resolve as able to approve any department's SOP.
- **`org_tool_access`** stays the coarse "can touch the SOP module" gate; `department_role` decides *which* SOPs and *which* verb.
- **`SopAccessGate`** — mirror `PlanningAccessGate` using the existing free-form `space_access` `"quality"` string (no migration).
- **RLS on `sops`:** draft/in-review readable by owning department + assigned reviewers + managers; `effective`/`superseded` readable org-wide (the read-only library); writes gated by `has_department_role`.
- Attach the existing `audit_access_change()` trigger to `sops` → tamper-proof status-change trail (Part 11 §11.10(e)) in one statement.

## 6. Enforcement — the transition guard (core)

Twin-predicate convention, cloned from work-orders:

- **`canTransitionSop(from, to, role, isAuthor)`** in `src/domain/sop/` — pure, unit-tested; drives UI enable/disable (fixes the "nobody can approve" bug at the UI edge).
- **`enforce_sop_transition()`** — `BEFORE UPDATE OF status`, `SECURITY DEFINER`, `search_path=''` trigger:
  - no-op on unchanged status;
  - `→ in_review`: author/editor of owning dept;
  - `→ approved`: `has_department_role(department_id, ARRAY['approver'])` **and** the final Quality step signed; **rejects if `NEW.approved_by = author`** (segregation of duties); stamps `approved_by`/`approved_at`;
  - `→ effective`: atomic — set this revision effective, supersede the prior effective, compute `next_review_date = effective_date + review_interval_months`;
  - non-`draft` rows are otherwise frozen (content immutable once submitted).

## 7. App layer

Follow the Planning triad (`route → workspace-provider → shell (+AccessGate)`, CRUD in `src/lib/sop/store.ts`).

**New surfaces (mockups in parentheses):**
- Departments admin — list, members, per-dept roles (Screen 01)
- SOP library with department filter, status badges, review-date flags (Screen 02)
- SOP detail: control header + lifecycle stepper + approval routing + e-sign + reject-with-reason (Screen 03)
- Effective library — read-only, org-wide, with "where-used" back-links to tasks (Screen 04)
- Review queue; Numbering settings

**Modified:**
- `sops` store — promoted columns, `next_sop_number`, snapshot-on-approve, one-effective swap
- `sop-workspace-provider` — expose department roles
- `sop-list` — dept filter + new badges + review dates
- `sop-editor` — **fix the two live bugs**: pass `isNew` (new authored SOP first-save no longer throws `SopConflictError`) and `canApprove` (approval reachable), plus the approval/sign panel
- `spaces` — `SopAccessGate`

## 8. Bug fixes (in scope, Phase 2)

1. `isNew` never passed (`sop-new-client.tsx:31`, `sop-detail-client.tsx:60`) → first save of a hand-authored SOP is a guarded UPDATE against a missing row → `SopConflictError`.
2. `canApprove` never passed (`sop-editor.tsx` + callsites) → approval transitions unreachable for everyone.

## 9. Error handling

Optimistic concurrency keeps throwing `SopConflictError` (friendly "reopen and retry"). Trigger rejections surface as readable messages ("Only a Quality approver can approve this SOP", "You can't approve an SOP you authored"). Numbering races are impossible (transactional counter). RLS denials degrade to empty/blocked states, never leaking other departments' drafts.

## 10. Testing

- **Unit (TS):** `canTransitionSop` (every edge, author≠approver, role matrix), version-bump logic, `DEPT-TYPE-NNN` formatting.
- **DB/integration:** trigger enforcement (illegal transitions rejected, SoD, one-effective invariant, atomic supersession), numbering under concurrency, RLS visibility per department/role.
- **Component:** departments admin, approval panel states, editor bug regressions.
- **E2E (Playwright):** author → review → dept approve → Quality sign → effective, plus reject-with-reason rework.
- Target 80%+ on new domain logic.

## 11. Phasing

- **Phase 1 — Departments:** `departments` + `department_members` + `department_sop_role` + `has_department_role`; `sops.department_id`; `doc_number_counter` + `next_sop_number`; Departments admin UI; `SopAccessGate`. (department_id nullable + backfill.)
- **Phase 2 — Enforced control:** lifecycle extension; `enforce_sop_transition` + `canTransitionSop`; attach `audit_access_change` to `sops`; `effective_date` / `next_review_date` columns + periodic-review flags; **fix the two bugs** + editor approval wiring.
- **Phase 3 — Review/approve & history:** `sop_revisions` snapshots; `sop_signatures` (content-hash bound, WORM); `sop_approval_steps` (two-step dept→Quality); review queue; effective library + where-used.
- **Phase 4 — Regulated only (deferred):** re-authentication at signing (§11.200), controlled-copy watermarking, training/read-acknowledge records.

## 12. Non-goals (YAGNI)

- No full `documents` + `document_versions` refactor (snapshots deliver the value with far less churn).
- No Part 11 re-auth / watermarks / training now (tables are shaped to add them later).
- Insights/reporting on SOPs out of scope.
