# SOP Management — Departments, Document Control & Review/Approve

**Date:** 2026-07-07
**Space:** Quality (`/sops`)
**Branch:** `worktree-sop-space`
**Status:** Design v2 — revised after Fable design review (all findings applied)
**Mockups:** Claude Design → *Pulse Design* → card group **"Quality — SOP System"** (`sop/01`–`sop/04`)

> **v2 changelog (post-review):** single state machine (no dual doc/revision status); published copy via a `sops.effective_revision_id` pointer (revisions stay truly WORM); content freeze + soft-delete guard via a plain `BEFORE UPDATE` trigger; segregation-of-duties bound to `submitted_by`/`auth.uid()` (spoof-proof, NULL-safe); Quality gate via an explicit `is_quality_gate` flag with distinct-signer enforcement; DB-computed content hashes; `space_access` CHECK migration required; `sop_approval_steps`, `departments.parent_id`/`owner_role`, and `sops.dept_code` **cut**; future-dated auto-effective **deferred**.

---

## 1. Goal

Turn the current flat SOP list into a real quality-document system with three capabilities:

1. **Departments** — each department authors and *owns* its SOPs, with per-department roles.
2. **Document control** — enforced lifecycle, versioning with frozen history, department-encoded numbering, effective dates and periodic review.
3. **Review & approve** — a routed, DB-enforced approval with e-signatures and separation of duties.

## 2. Locked decisions

| Decision | Choice |
|---|---|
| Compliance depth | **ISO 9001, Part-11-ready** — signer identity + meaning + **DB-computed** content-hash binding + author≠approver enforced by trigger; full 21 CFR Part 11 (re-auth, watermarks, training records) deferred to Phase 4, no rebuild needed |
| Versioning | **Frozen version snapshots** — append-only, truly immutable `sop_revisions`; the in-force copy is named by `sops.effective_revision_id` |
| Approval routing | **Dept approver → Quality**, two fixed steps recorded as WORM `sop_signatures` rows (no separate step table) |
| Departments | **First-class, admin-managed in-app**; a user may belong to many departments with a different role in each |
| Numbering | **DEPT-TYPE-NNN** (e.g. `QA-SOP-014`) via a transactional counter; number never changes on revision |
| Quality gate | A department flagged **`is_quality_gate`** whose approvers can approve any department's SOP, and must be a **different person** than the dept approver |

## 3. Hard constraints (from the codebase)

- **No server tier / no service-role key.** Postgres RLS + `SECURITY DEFINER` triggers/functions are the *only* enforcement layer. Every rule below is enforced in the database, with a mirrored TypeScript predicate for the UI only. **Corollary (Fable F2/F13):** anything the client can send in a raw PostgREST request must be assumed hostile — freeze rules, SoD, and content hashes are computed/enforced server-side in the DB, never trusted from the client.
- **Build on the existing `sops` table**, don't rewrite. New control fields are promoted columns (stripped from the `document` jsonb exactly as `status` already is, `store.ts:146`). `saveSop`'s optimistic-concurrency guard stays.
- **Reuse proven patterns:** the `enforce_work_order_transition` trigger *as inspiration* (see F2 — ours must be plain `BEFORE UPDATE`, not `OF status`), the immutable `audit_log`, the `project_access` table shape + `has_*_access()` helper idiom, and the Planning-space feature triad.
- **Migration conventions:** `supabase/migrations/YYYYMMDDHHMMSS_snake.sql`, idempotent, all auth-touching functions `security definer set search_path=''`, schema-qualified. Timestamps after the current latest (`20260706130000`).

## 4. Data model

### 4.1 New tables

**`departments`** — owning entity for SOPs.
`id text pk`, `workspace_id → workspaces on delete cascade`, `code text` (short, e.g. `QA`; unique per workspace; **immutable once any number is minted for it** — F5/F15), `name text`, `is_quality_gate boolean default false` (the cross-department approval gate — F5), `created_by`, `updated_by`, `created_at`, `updated_at`.
Partial-unique index on `(workspace_id, lower(btrim(code)))`. At most one `is_quality_gate = true` per workspace (partial unique index).
*Cut (F/cut-list): `parent_id`, `owner_role`.*

**`department_members`** — many-to-many membership with a per-department role (clone of `project_access` shape + RLS).
Composite PK `(department_id, user_id)`, `dept_role department_sop_role`, `granted_by`, `updated_at` (trigger).
New enum `department_sop_role ('author','reviewer','approver')`. **Roles are cumulative** (F16): `approver` ⊇ `reviewer` ⊇ `author` capabilities. Any of the three (in the owning dept) may create/edit drafts and submit to review; **signing** a review step needs ≥`reviewer`, the dept-approval step needs `approver`, the Quality step needs `approver` in an `is_quality_gate` department.

**`sop_revisions`** — append-only, **truly immutable** frozen snapshots (F7).
`id`, `sop_id → sops`, `workspace_id`, `version_label text`, `document jsonb` (frozen copy), `content_hash text` (**DB-computed**, F13), `created_at`, `created_by`.
**No `status` column and no per-status index** — "which revision is in force" is named by `sops.effective_revision_id`; "superseded" is derived (any revision that isn't the pointer). RLS: `INSERT` only via the definer snapshot function; **no `UPDATE`/`DELETE` policy** (WORM). `REVOKE UPDATE, DELETE`.

**`sop_signatures`** — append-only e-signatures + the record of each approval step (F7 cut of the step table).
`id`, `sop_id`, `revision_id → sop_revisions`, `signer_id uuid` (**= `auth.uid()`, DB-stamped**), `meaning text ('authorship'|'review'|'dept_approval'|'quality_approval'|'rejection')`, `signer_printed_name text` (**DB-stamped from `profiles`**, F13), `signed_content_hash text` (binds to the revision), `rejected_reason text null`, `signed_at timestamptz`, `auth_method text`, `re_authenticated boolean default false` (Phase-4 landing pads — cheap to keep). `REVOKE UPDATE, DELETE` (WORM).

**`doc_number_counter`** — transactional numbering (F10).
PK `(workspace_id, department_id, doc_type)`, `next_seq int`. `SECURITY DEFINER` function `next_sop_number(workspace, department, doc_type)`:
- internally verifies `has_department_role(department, ['author','reviewer','approver'])` **and** workspace membership before minting (F10b);
- `INSERT ... ON CONFLICT (workspace_id, department_id, doc_type) DO UPDATE SET next_seq = doc_number_counter.next_seq + 1 RETURNING next_seq` — race-safe including first mint (F10a);
- counters are **seeded above the parsed maxima of existing `sop_number` values** at migration time (F10c);
- returns `DEPT-TYPE-NNN`.

### 4.2 `sops` — additive promoted columns (`add column if not exists`)

`department_id text references departments(id)`, `doc_type text default 'SOP'`, `seq_int int`, `major_version smallint`, `minor_version smallint`, `submitted_by uuid` (stamped on `→ in_review`, the SoD anchor — F3), `approved_by uuid`, `approved_at timestamptz`, `effective_date date`, `next_review_date date`, `review_interval_months smallint default 24`, `effective_revision_id text references sop_revisions(id)` (**the in-force copy** — F7), `rejected_reason text null`, `rejected_by uuid null`, `change_significance text` and `requires_retraining boolean default false` (**informational only** — not read by any trigger; retraining enforcement is Phase 4 — cut-list).
Existing `sop_number` and its partial-unique index remain. `major_version`/`minor_version` are canonical; the display string is derived; `meta.version` in jsonb becomes display-only (F15).
*Cut: `sops.dept_code` (derive via join at mint time — F/cut-list).*

### 4.3 Lifecycle — ONE state machine, on `sops.status` (F1)

```
Author:      draft → in_review          (stamps submitted_by = auth.uid())
Reject:      in_review → draft          (records rejection signature + rejected_reason; clears submitted_by)
Approve:     in_review → approved       (dept approver signs; SoD enforced)
Make live:   approved → effective       (Quality signs; snapshots revision; sets effective_revision_id)
Revise:      effective → draft          ("start revision": snapshots current effective first, bumps version)
Retire:      effective|approved → obsolete
```

- **No `superseded` status** — a prior effective revision is simply no longer pointed to by `effective_revision_id`.
- Only `draft` rows are content-editable. Every other state freezes `document`/header (enforced in §6).
- Future-dated `effective_date` is **not** auto-flipped in v1 (F9): "Make effective" is an explicit user action and `effective_date` defaults to today; `pg_cron` auto-go-live is a deferred follow-up.

## 5. Access & RLS

- **`space_access` needs a migration (F/refuted):** its CHECK is `space in ('planning','production')`. Phase 1 migration extends it to include `'quality'`; then `SopAccessGate` mirrors `PlanningAccessGate`.
- **`has_department_role(department_id, roles[])`** — `SECURITY DEFINER` helper on `department_members`. For the **dept** steps it folds in workspace managers/superadmin (convenience). For the **Quality** step it does **not** fold in managers (F4) — it requires actual `approver` membership in an `is_quality_gate` department. A Quality approver satisfies `approver` for *any* target department via: `role in target dept OR (role='approver' AND member of a is_quality_gate dept)` (F5). `has_department_role(NULL, …)` returns **false** (F11).
- **`org_tool_access`** stays the coarse "can touch the SOP module" gate for authoring; `department_role` decides *which* SOPs and *which* verb.
- **RLS on `sops`, status-by-status (F12 — enumerate all):**
  - `draft`, `in_review`, `approved`: readable by owning-department members + managers only (dept-scoped; NULL-dept ⇒ managers only — F11).
  - `effective`: readable by **every workspace member** (the read-only library), independent of `org_tool_access`.
  - `obsolete`: readable by owning-department members + managers.
  - Writes gated by `has_department_role`; the transition trigger (§6) is the real lifecycle gate.
- **Audit (F8):** do **not** attach `audit_access_change()` to `sops`. Instead a small purpose-built `AFTER UPDATE OF status` function logs `(sop_id, actor=auth.uid(), old.status, new.status)` into `audit_log` with `target_type='sop'`, `target_id=sop_id`, and a **minimal** `details` (no full `document` jsonb) — avoids autosave bloat and content leakage to managers.

## 6. Enforcement — the transition guard (core, revised)

Twin-predicate convention:

- **`canTransitionSop(from, to, role, isSubmitter)`** in `src/domain/sop/` — pure, unit-tested; drives UI enable/disable (fixes the "nobody can approve" bug at the UI edge).
- **`enforce_sop_transition()`** — a **plain `BEFORE UPDATE`** trigger (not `OF status` — F2), `SECURITY DEFINER`, `search_path=''`:
  - **Content freeze (F2):** if `OLD.status <> 'draft'`, reject any change to `document`/title/number/`department_id`/version columns.
  - **Soft-delete guard (F2):** reject setting `deleted_at` unless `OLD.status in ('draft','obsolete')` or caller is a manager.
  - **Status transitions:** no-op when `status` unchanged; validate the edge against §4.3; on `→ in_review` stamp `submitted_by := auth.uid()` and require non-null `department_id` (F11); on reject clear `submitted_by`, require a `rejected_reason`.
  - **SoD (F3):** on `→ approved`, force `NEW.approved_by := auth.uid()` (ignore client value), and reject if `auth.uid() = COALESCE(submitted_by, created_by)` or if `submitted_by IS NULL`. On `→ effective`, the Quality signer must differ from the dept approver (F4).
  - **Effective swap (F7):** `→ effective` calls the snapshot function (creates the WORM `sop_revisions` row + DB content hash) and sets `NEW.effective_revision_id` to it — a single-row atomic update; no sibling-row mutation, no re-entrant trigger.
- **Phased trigger (F6):** Phase 2 ships **v1** (edge validation + content/delete freeze + SoD, role checks). Phase 3 ships a **superseding migration** adding the "required signatures exist" precondition (dept-approval signature before `→ approved`; quality-approval signature before `→ effective`).
- **Content hash (F13):** computed in the DB snapshot function as `encode(sha256(convert_to(document::text,'UTF8')),'hex')`.

## 7. App layer

Follow the Planning triad (`route → workspace-provider → shell (+AccessGate)`, CRUD in `src/lib/sop/store.ts`).

**New surfaces (mockups in parentheses):**
- Departments admin — list, members, per-dept roles, the Quality-gate flag (Screen 01)
- SOP library with department filter, status badges, review-date flags (Screen 02)
- SOP detail: control header + lifecycle stepper + approval routing (from `sop_signatures`) + e-sign + reject-with-reason (Screen 03)
- Effective library — read-only, org-wide, served from `effective_revision_id`, with "where-used" back-links (Screen 04)
- Review queue

**Modified:**
- `sops` store — promoted columns, `next_sop_number`, snapshot-on-make-effective via the definer fn, `effective_revision_id` reads for the published copy
- `sop-workspace-provider` — expose department roles
- `sop-list` — dept filter + new badges + review dates
- `sop-editor` — **fix the two live bugs** (§8); the SOP-number field becomes **read-only once a department is assigned** (F10d); approval/sign panel
- **AI converter** (`app/api/sops/extract`) + list — assign a `department_id` on convert (picker, defaulting to an **"Unassigned"** department seeded per workspace — F11)
- `spaces` — `SopAccessGate` (after the `space_access` CHECK migration)
- Where-used (Screen 04) surfaces tasks linked to `obsolete`/soft-deleted SOPs, and soft-deleting an SOP with active task links is **blocked/warned** (F14)

## 8. Bug fixes (in scope, Phase 2)

1. `isNew` never passed at the **new-SOP callsite** (`sop-new-client.tsx:31`) → `SopEditor` defaults `isNew=false` → `persistedUpdatedAt` truthy → **autosave (~2s after first edit) issues a guarded UPDATE against a nonexistent row → `SopConflictError` before the user ever clicks Save** (F16 correction — the `sop-detail-client.tsx` path is fine; default `false` is correct there).
2. `canApprove` never passed (`sop-editor.tsx` + callsites) → approval transitions unreachable for everyone, including owners.

## 9. Error handling

Optimistic concurrency keeps throwing `SopConflictError` (friendly "reopen and retry"). Trigger rejections surface as readable messages ("Only a Quality approver can approve this", "You can't approve an SOP you submitted", "This SOP is effective — start a revision to edit"). Numbering races are impossible (transactional `ON CONFLICT` counter). RLS denials degrade to empty/blocked states, never leaking other departments' drafts.

## 10. Testing

- **Unit (TS):** `canTransitionSop` (every edge, SoD via submitter, role matrix, cumulative roles), version-bump logic, `DEPT-TYPE-NNN` formatting.
- **DB/integration (the load-bearing part):** content-freeze on non-draft (document-only PATCH rejected), soft-delete guard, SoD with NULL author, distinct-signer Quality gate, one-effective-via-pointer, numbering under concurrency + seeding above legacy maxima, DB content-hash determinism, RLS visibility per status/department/role.
- **Component:** departments admin, approval panel states, editor bug regressions (incl. autosave-on-new).
- **E2E (Playwright):** author → review → dept approve → Quality make-effective, plus reject-with-reason rework and start-revision.
- Target 80%+ on new domain logic.

## 11. Phasing

- **Phase 1 — Departments:** `departments` (+`is_quality_gate`, +"Unassigned" seed) + `department_members` + `department_sop_role` + `has_department_role`; `sops.department_id`; `doc_number_counter` + `next_sop_number` (seeded above maxima); **`space_access` CHECK migration** + `SopAccessGate`; Departments admin UI. (department_id nullable + backfill.)
- **Phase 2 — Enforced control:** lifecycle extension; `enforce_sop_transition` **v1** (freeze + delete-guard + SoD + roles) + `canTransitionSop`; purpose-built status-audit trigger; `submitted_by`/`approved_by`/`effective_date`/`next_review_date` columns; **fix the two bugs** + editor approval wiring + read-only number field; converter department assignment.
- **Phase 3 — Review/approve & history:** `sop_revisions` (WORM) + `sop_signatures` (WORM, DB-hashed) + `effective_revision_id`; **superseding trigger migration** adding the required-signature preconditions and the effective-swap snapshot; review queue; effective library + where-used (incl. obsolete/deleted task links).
- **Phase 4 — Regulated only (deferred):** re-authentication at signing (§11.200), controlled-copy watermarking, training/read-acknowledge records (activates `requires_retraining`).

## 12. Non-goals / cut list (YAGNI)

- **Cut:** `sop_approval_steps` table (two-step routing is fully captured by WORM `sop_signatures` + `rejected_reason`), `departments.parent_id`, `departments.owner_role`, `sops.dept_code`, `sop_revisions.status` (replaced by the `effective_revision_id` pointer).
- **Deferred:** full `documents`+`document_versions` refactor (snapshots deliver the value); future-dated auto-effective (`pg_cron`); Part 11 re-auth / watermarks / training; `change_significance`/`requires_retraining` stay informational until Phase 4.
- Insights/reporting on SOPs out of scope.
