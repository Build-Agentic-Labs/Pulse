# Author-Nominated Reviewers Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let an SOP author nominate a reviewer for their own department from the roster editor, seat that person immediately (even before they accept the invite), and send the SOP for review with the task already waiting in the nominee's queue.

**Architecture:** The database stays the enforcement layer: two `security definer` RPCs (`nominate_department_reviewer`, `mint_pending_department_reviewer`) write a fixed-package grant and a *provisional* `department_members` row flagged by `pending_invite_at`. The untouched transition guard passes because `is_department_member` gains one clause that counts a provisional row only when the caller asks about someone else. A new route sends the invite email with the existing delivery helpers; the notification domain redirects "reviewer hasn't joined" nudges to the author. Spec: `docs/superpowers/specs/2026-09-10-author-reviewer-invites-design.md`.

**Tech Stack:** Next.js 16 App Router, Supabase (Postgres + RLS, pgTAP), React 19, Vitest (+ Testing Library, jsdom), Resend via existing sender.

## Global Constraints

- **Never rewrite `enforce_sop_transition` or `sign_sop`.** No migration in this plan reads or touches them. `is_department_member` is NOT live-patched (no `pg_get_functiondef` migration targets it); its full current text is `20260904120000_rbac_membership_boundaries.sql:63-75`.
- **Authorization lives in the RPCs**, not the route. The route holds the service-role key only to send the email and write manager inbox rows, exactly like `app/api/invites/route.ts`.
- **Nominated role is `reviewer`, never `approver`; never the Quality-gate department; only a department the caller belongs to** (owners/admins also pass).
- **Fixed grant package** (never taken from the client): workspace role `editor`, `quality_access = 'edit'`, `access_package = 'custom'`, `planning_access = false`, `project_access = '[]'`, one `department_access` entry `{department_id, role: "reviewer", position_title}`, `expires_at = now() + 30 days`.
- **No new npm dependencies.** Never commit a Windows-touched `package-lock.json`.
- **Migrations are additive.** After the owner applies them live, run `npm run gen:types` and commit `src/lib/database.types.ts`; until then the types file is hand-extended exactly as shown.
- **Design language:** squared 4px/6px geometry, no pills, feature CSS in component-scoped files, never `globals.css`.
- **Commit format:** `<type>: <description>` with the `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>` trailer. Branch: `feat/author-reviewer-invites` (already checked out; spec committed).
- **Tests:** `npm test` (vitest, projects `unit` + `components`), `npm run typecheck`, `npm run lint` (max-warnings 0). pgTAP runs in CI's `database` job (`supabase db reset` + `supabase test db --local`); locally only if Docker is up. A red database job is stop-the-line.

---

## File map

**Migrations (`supabase/migrations/`)**
- `20260910120000_department_members_pending_invite.sql` — `pending_invite_at` column + partial index; `is_department_member` widened (guarded).
- `20260910121000_reviewer_nomination.sql` — `nominate_department_reviewer`, `mint_pending_department_reviewer`, `sync_pending_department_reviewers` trigger on `workspace_access_grants`.
- `20260910122000_reviewer_not_joined_kind.sql` — `sop_notifications` kind CHECK admits `reviewer_not_joined`.
- `supabase/tests/reviewer_nomination_test.sql` — pgTAP for all of the above.

**Domain (`src/domain/`)** — pure, tested
- `workspace/reviewer-nomination.ts` — request/outcome parsing, fixed entitlements, pending-state derivation, outcome copy.
- `sop/roster-options.ts` — approver dropdown option builder (pending tags, absent signer).
- `sop/notifications.ts` — `SeatSnapshot.signerPending`, `reviewer_not_joined` kind, author redirect.
- `sop/notification-templates.ts` — `reviewer_not_joined` template.
- `notifications/channels.ts` — catalog entries `reviewer_not_joined`, `reviewer_nominated`.
- `departments.ts` — `DepartmentMember.pendingInviteAt`.

**Lib (`src/lib/`)**
- `workspace/invite-delivery.ts` — `generateSetupLink`, `deliverInvitationEmail`, `countWorkspaceMemberships` extracted from the invites route (+ `userId` on the setup link).
- `notifications/inbox-writer.ts` — `insertInboxRows` (service role).
- `departments/store.ts` — `pending_invite_at` in `MEMBER_COLUMNS` / `mapMember`.
- `sop/review.ts` — `listProfileNames` falls back to email.
- `sop/notifications-store.ts` — loads pending flags onto seat snapshots; template department for the author nudge.
- `database.types.ts` — hand-extended.

**Routes (`app/api/`)**
- `sops/reviewers/nominate/route.ts` (+ `route.test.ts`).
- `invites/route.ts` — imports the extracted helpers (no behavior change).

**Components (`src/components/`)**
- `sop/reviewer-invite-form.tsx` (+ test) — inline email/title form that calls the route.
- `sop/sop-roster-editor.tsx` (+ test) — pending tags, "Invite a reviewer" action, `myDeptRoles` prop.
- `sop/sop-editor.tsx` — passes `myDeptRoles`.
- `workspace-members-settings.tsx` — "invited by" line on pending invites.

**Docs**
- `docs/runbooks/notifications.md` — the two new kinds.

---

### Task 1: Provisional-membership column and the scoped membership predicate

**Files:**
- Create: `supabase/migrations/20260910120000_department_members_pending_invite.sql`
- Create: `supabase/tests/reviewer_nomination_test.sql`
- Modify: `src/lib/database.types.ts` (the `department_members` block)

**Interfaces:**
- Produces: column `public.department_members.pending_invite_at timestamptz null`; `is_department_member(dept_id text, p_user uuid default auth.uid())` returns true for a provisional row only when `auth.uid() is distinct from p_user`.

- [ ] **Step 1: Write the failing pgTAP test**

Create `supabase/tests/reviewer_nomination_test.sql`:

```sql
-- pgTAP: author-nominated reviewers.
-- Spec: docs/superpowers/specs/2026-09-10-author-reviewer-invites-design.md
--
-- Pins (Task 1):
--   * department_members.pending_invite_at exists
--   * a provisional row satisfies is_department_member when the CALLER asks about someone else
--     (Gate A, seat reassignment) and never when the provisional person is the actor
--   * a workspace member with no department row is still not a member

begin;
select plan(4);

-- ---------------------------------------------------------------------------
-- Fixtures (owner context: RLS bypassed)
-- ---------------------------------------------------------------------------
insert into public.workspaces (id, name) values ('ws_nom', 'Nomination Org');
-- workspace_access_grants carries a CHECK that emails are @anacorp.com; the domain rule lets
-- enforce_signup_domain accept the same addresses on auth.users.
insert into public.workspace_auto_join_domains (domain, workspace_id) values ('anacorp.com', 'ws_nom');

insert into auth.users (id, aud, role, email)
values
  ('d0000000-0000-0000-0000-000000000001', 'authenticated', 'authenticated', 'nom-admin@anacorp.com'),
  ('d0000000-0000-0000-0000-000000000002', 'authenticated', 'authenticated', 'nom-author@anacorp.com'),
  ('d0000000-0000-0000-0000-000000000003', 'authenticated', 'authenticated', 'nom-peer@anacorp.com'),
  ('d0000000-0000-0000-0000-000000000004', 'authenticated', 'authenticated', 'nom-approver@anacorp.com'),
  ('d0000000-0000-0000-0000-000000000005', 'authenticated', 'authenticated', 'nom-member@anacorp.com'),
  ('d0000000-0000-0000-0000-000000000006', 'authenticated', 'authenticated', 'nom-invitee@anacorp.com'),
  ('d0000000-0000-0000-0000-000000000007', 'authenticated', 'authenticated', 'nom-revoked@anacorp.com'),
  ('d0000000-0000-0000-0000-000000000008', 'authenticated', 'authenticated', 'nom-second@anacorp.com');

-- u6 (invitee), u7 (revoked) and u8 (second invitee) are NOT workspace members.
insert into public.workspace_members (workspace_id, user_id, role) values
  ('ws_nom', 'd0000000-0000-0000-0000-000000000001', 'admin'),
  ('ws_nom', 'd0000000-0000-0000-0000-000000000002', 'editor'),
  ('ws_nom', 'd0000000-0000-0000-0000-000000000003', 'editor'),
  ('ws_nom', 'd0000000-0000-0000-0000-000000000004', 'editor'),
  ('ws_nom', 'd0000000-0000-0000-0000-000000000005', 'editor');

insert into public.org_tool_access (workspace_id, user_id, level)
select 'ws_nom', u.id, 'edit'::public.access_level from (values
  ('d0000000-0000-0000-0000-000000000002'::uuid),
  ('d0000000-0000-0000-0000-000000000003'::uuid),
  ('d0000000-0000-0000-0000-000000000004'::uuid),
  ('d0000000-0000-0000-0000-000000000005'::uuid)) as u(id);

insert into public.departments (id, workspace_id, code, name, is_quality_gate) values
  ('dept_nom_prd', 'ws_nom', 'PRD', 'Production', false),
  ('dept_nom_eng', 'ws_nom', 'ENG', 'Engineering', false),
  ('dept_nom_qas', 'ws_nom', 'QAS', 'Quality', true);

insert into public.department_members (department_id, user_id, dept_role) values
  ('dept_nom_prd', 'd0000000-0000-0000-0000-000000000002', 'author'),
  ('dept_nom_prd', 'd0000000-0000-0000-0000-000000000003', 'author'),
  ('dept_nom_prd', 'd0000000-0000-0000-0000-000000000004', 'approver'),
  ('dept_nom_qas', 'd0000000-0000-0000-0000-000000000001', 'approver');

insert into public.workspace_revocations (workspace_id, email, revoked_by)
values ('ws_nom', 'nom-revoked@anacorp.com', 'd0000000-0000-0000-0000-000000000001');

insert into public.sops (id, workspace_id, sop_number, title, document, status, created_by, department_id)
values ('sop_nom_1', 'ws_nom', 'PRD-SOP-001', 'Nominated', '{"body":"n1"}'::jsonb, 'draft',
        'd0000000-0000-0000-0000-000000000002', 'dept_nom_prd');

-- Helpers: act as a given user with the authenticated role. The second variant also carries the
-- email claim, which redeem_workspace_access_grants() reads from auth.jwt().
create or replace function test_as(p_uid text) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
end $$;

create or replace function test_as_email(p_uid text, p_email text) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims',
    json_build_object('sub', p_uid, 'role', 'authenticated', 'email', p_email)::text, true);
  execute 'set local role authenticated';
end $$;

-- ---------------------------------------------------------------------------
-- 1. The marker column exists.
-- ---------------------------------------------------------------------------
select has_column('public', 'department_members', 'pending_invite_at', 'department_members.pending_invite_at exists');

-- ---------------------------------------------------------------------------
-- 2/3/4. The scoped clause: provisional rows count for lookups about someone else, never for the actor.
-- ---------------------------------------------------------------------------
insert into public.department_members (department_id, user_id, dept_role, pending_invite_at)
values ('dept_nom_prd', 'd0000000-0000-0000-0000-000000000006', 'reviewer', now());

select test_as('d0000000-0000-0000-0000-000000000002');
select is(
  public.is_department_member('dept_nom_prd', 'd0000000-0000-0000-0000-000000000006'),
  true,
  'the author asking about the provisional nominee: a member (Gate A will pass)'
);
select is(
  public.is_department_member('dept_nom_prd', 'd0000000-0000-0000-0000-000000000005'),
  false,
  'a workspace member with no department row is still not a member'
);
reset role;

select test_as('d0000000-0000-0000-0000-000000000006');
select is(
  public.is_department_member('dept_nom_prd'),
  false,
  'the provisional nominee asking about themselves: NOT a member (no usable access before joining)'
);
reset role;

-- Clean the hand-made provisional row so later tasks start from the RPC path.
delete from public.department_members where user_id = 'd0000000-0000-0000-0000-000000000006';

select * from finish();
rollback;
```

- [ ] **Step 2: Run the pgTAP suite to verify it fails**

Run (requires Docker; skip to CI otherwise):
```bash
supabase db reset && supabase test db --local
```
Expected: `reviewer_nomination_test` fails — `has_column` reports the column missing and the `is()` for the nominee lookup returns `false` instead of `true`.

- [ ] **Step 3: Write the migration**

Create `supabase/migrations/20260910120000_department_members_pending_invite.sql`:

```sql
-- Author-nominated reviewers, 1/3.
-- Spec: docs/superpowers/specs/2026-09-10-author-reviewer-invites-design.md
--
-- (a) department_members.pending_invite_at — the provisional-membership marker. Null for every
--     ordinary member; set when a membership is minted ahead of the invitee accepting.
--     redeem_workspace_access_grants() clears it without new code: it deletes and reinserts the
--     user's department rows from the grant, and the reinsert takes the column default.
-- (b) is_department_member gains one clause: a provisional row counts only when the database is
--     asked about someone OTHER than the caller (Gate A checking a seat's signer, an admin seating
--     a nominee) — never when the provisional person is the one acting. Every read/sign path still
--     joins workspace_members, so a nominee who can already sign in still has no usable access.
--
-- is_department_member is NOT live-patched: its full current text is 20260904120000. The guard
-- below still refuses to replace a body that has drifted from that definition.

alter table public.department_members
  add column if not exists pending_invite_at timestamptz;

create index if not exists department_members_pending_idx
  on public.department_members (department_id)
  where pending_invite_at is not null;

do $$
declare
  v_def text := pg_get_functiondef('public.is_department_member(text, uuid)'::regprocedure);
begin
  if position('join public.workspace_members wm' in v_def) = 0 then
    raise exception 'is_department_member has drifted from its 20260904120000 definition; review before widening';
  end if;
end $$;

create or replace function public.is_department_member(dept_id text, p_user uuid default auth.uid())
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select dept_id is not null and p_user is not null and (
    exists (
      select 1 from public.department_members m
      join public.departments d on d.id = m.department_id
      join public.workspace_members wm on wm.workspace_id = d.workspace_id and wm.user_id = m.user_id
      where m.department_id = dept_id and m.user_id = p_user)
    or (
      auth.uid() is distinct from p_user
      and exists (
        select 1 from public.department_members m
        where m.department_id = dept_id and m.user_id = p_user and m.pending_invite_at is not null)
    )
  );
$$;
```

- [ ] **Step 4: Hand-extend the generated types**

In `src/lib/database.types.ts`, inside `department_members`, add `pending_invite_at` to all three blocks (keep alphabetical order, after `granted_by`):

```ts
        Row: {
          department_id: string
          dept_role: Database["public"]["Enums"]["department_sop_role"]
          granted_by: string | null
          pending_invite_at: string | null
          position_title: string
          updated_at: string
          user_id: string
        }
        Insert: {
          // ...existing fields...
          pending_invite_at?: string | null
        }
        Update: {
          // ...existing fields...
          pending_invite_at?: string | null
        }
```

- [ ] **Step 5: Run the pgTAP suite and typecheck**

Run:
```bash
supabase db reset && supabase test db --local
```
Expected: `reviewer_nomination_test` — 4/4 pass; every other test file still passes (the seat tests exercise the unchanged actor path).

Run:
```bash
npm run typecheck
```
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add supabase/migrations/20260910120000_department_members_pending_invite.sql supabase/tests/reviewer_nomination_test.sql src/lib/database.types.ts
git commit -m "feat(db): provisional department membership marker + scoped is_department_member clause

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 2: Nomination RPCs and the grant sync trigger

**Files:**
- Create: `supabase/migrations/20260910121000_reviewer_nomination.sql`
- Modify: `supabase/tests/reviewer_nomination_test.sql` (extend; `plan(4)` → `plan(24)`)
- Modify: `src/lib/database.types.ts` (the `Functions` block)

**Interfaces:**
- Produces: `nominate_department_reviewer(p_department_id text, p_email text, p_position_title text) returns jsonb` → `{"mode": "added"|"lifted"|"already_eligible"|"invite", "user_id": uuid|null}`; `mint_pending_department_reviewer(p_department_id text, p_user_id uuid) returns void`; trigger `workspace_access_grants_sync_pending_reviewers`.
- Error messages (exact, the route surfaces them verbatim): `You can only invite reviewers into your own department.` / `Quality approvers are managed by an admin.` / `That email domain is not approved for this organization.` / `That address was removed by an admin. Ask an admin to re-invite them.` / `Enter the position title.` / `No matching invitation from you for that person.`

- [ ] **Step 1: Extend the pgTAP test (RED)**

In `supabase/tests/reviewer_nomination_test.sql`, change `select plan(4);` to `select plan(24);` and insert the following block (20 assertions) **before** `select * from finish();`:

```sql
-- ---------------------------------------------------------------------------
-- 5-8. Refusals: other department, Quality gate, revoked address, unapproved domain.
-- ---------------------------------------------------------------------------
select test_as('d0000000-0000-0000-0000-000000000002');
select throws_like(
  $$ select public.nominate_department_reviewer('dept_nom_eng', 'nom-member@anacorp.com', 'Engineer') $$,
  '%your own department%',
  'an author cannot nominate into a department they do not belong to'
);
select throws_like(
  $$ select public.nominate_department_reviewer('dept_nom_qas', 'nom-member@anacorp.com', 'Quality Engineer') $$,
  '%managed by an admin%',
  'the Quality-gate department is never nominatable'
);
select throws_like(
  $$ select public.nominate_department_reviewer('dept_nom_prd', 'nom-revoked@anacorp.com', 'Engineer') $$,
  '%removed by an admin%',
  'a revoked address is refused; authors never lift revocations'
);
select throws_like(
  $$ select public.nominate_department_reviewer('dept_nom_prd', 'someone@evil.com', 'Engineer') $$,
  '%not approved%',
  'an unapproved email domain is refused before any write'
);

-- ---------------------------------------------------------------------------
-- 9-13. Modes for people already in the workspace: added / lifted / already_eligible.
-- ---------------------------------------------------------------------------
select is(
  (public.nominate_department_reviewer('dept_nom_prd', 'nom-member@anacorp.com', 'Production Supervisor'))->>'mode',
  'added',
  'a workspace member outside the department is added as reviewer'
);
select is(
  (select dept_role::text from public.department_members
    where department_id = 'dept_nom_prd' and user_id = 'd0000000-0000-0000-0000-000000000005'),
  'reviewer',
  '…with the reviewer role and no pending marker'
);
select is(
  (public.nominate_department_reviewer('dept_nom_prd', 'nom-peer@anacorp.com', 'Process Engineer'))->>'mode',
  'lifted',
  'a department author is lifted to reviewer'
);
select is(
  (public.nominate_department_reviewer('dept_nom_prd', 'nom-approver@anacorp.com', 'VP'))->>'mode',
  'already_eligible',
  'an approver is left untouched'
);
select is(
  (select dept_role::text from public.department_members
    where department_id = 'dept_nom_prd' and user_id = 'd0000000-0000-0000-0000-000000000004'),
  'approver',
  '…and still holds approver'
);

-- ---------------------------------------------------------------------------
-- 14-16. Invite mode: fixed-package grant + provisional row for an existing auth user.
-- ---------------------------------------------------------------------------
select is(
  (public.nominate_department_reviewer('dept_nom_prd', 'nom-invitee@anacorp.com', 'Line Lead'))->>'user_id',
  'd0000000-0000-0000-0000-000000000006',
  'a non-member with an auth account: invite mode returns their user id'
);
reset role;  -- grants are manager-only under RLS; assert the rows as the owner
select is(
  (select row(g.role::text, g.quality_access::text, g.planning_access, g.granted_by::text,
              g.department_access->0->>'department_id', g.department_access->0->>'role')::text
     from public.workspace_access_grants g
    where g.workspace_id = 'ws_nom' and g.email = 'nom-invitee@anacorp.com'),
  '(editor,edit,f,d0000000-0000-0000-0000-000000000002,dept_nom_prd,reviewer)',
  'the grant carries the fixed reviewer package, authored by the nominator'
);
select isnt(
  (select pending_invite_at from public.department_members
    where department_id = 'dept_nom_prd' and user_id = 'd0000000-0000-0000-0000-000000000006'),
  null,
  'a provisional membership was minted with the pending marker set'
);

-- ---------------------------------------------------------------------------
-- 17/18. mint_pending_department_reviewer: refused without a matching grant BY THE CALLER; idempotent with one.
-- ---------------------------------------------------------------------------
select test_as('d0000000-0000-0000-0000-000000000003');
select throws_like(
  $$ select public.mint_pending_department_reviewer('dept_nom_prd', 'd0000000-0000-0000-0000-000000000006') $$,
  '%No matching invitation%',
  'a peer who did not send the invitation cannot mint the provisional row'
);
reset role;
select test_as('d0000000-0000-0000-0000-000000000002');
select lives_ok(
  $$ select public.mint_pending_department_reviewer('dept_nom_prd', 'd0000000-0000-0000-0000-000000000006') $$,
  'the nominator can re-mint (resend) idempotently'
);

-- ---------------------------------------------------------------------------
-- 19. RLS unchanged: an author still cannot write department_members directly.
-- ---------------------------------------------------------------------------
select throws_ok(
  $$ insert into public.department_members (department_id, user_id, dept_role)
     values ('dept_nom_prd', 'd0000000-0000-0000-0000-000000000007', 'reviewer') $$,
  '42501',
  null,
  'direct department_members writes remain owner/admin-only'
);
reset role;

-- ---------------------------------------------------------------------------
-- 20. Gate A passes with a provisional signer; the guard is untouched.
-- ---------------------------------------------------------------------------
insert into public.sop_review_seats (sop_id, department_id, rasic, signer_id)
values ('sop_nom_1', 'dept_nom_prd', 'responsible', 'd0000000-0000-0000-0000-000000000006');
select test_as('d0000000-0000-0000-0000-000000000002');
select public.sign_sop('sop_nom_1', 'authorship');
select lives_ok(
  $$ update public.sops set status = 'in_review' where id = 'sop_nom_1' $$,
  'draft -> in_review succeeds while the seated reviewer has not joined yet'
);
reset role;

-- ---------------------------------------------------------------------------
-- 21. Deleting a pending invitation cascades its provisional row (second invitee, u8).
-- ---------------------------------------------------------------------------
select test_as('d0000000-0000-0000-0000-000000000002');
select public.nominate_department_reviewer('dept_nom_prd', 'nom-second@anacorp.com', 'Technician');
reset role;
select test_as('d0000000-0000-0000-0000-000000000001');
delete from public.workspace_access_grants where workspace_id = 'ws_nom' and email = 'nom-second@anacorp.com';
reset role;
select is(
  (select count(*) from public.department_members
    where department_id = 'dept_nom_prd' and user_id = 'd0000000-0000-0000-0000-000000000008'),
  0::bigint,
  'removing the pending invitation deletes the provisional membership'
);

-- ---------------------------------------------------------------------------
-- 22-24. Acceptance: redeem clears the marker, keeps the seat, and mints the workspace membership.
-- ---------------------------------------------------------------------------
update auth.users set email_confirmed_at = now() where id = 'd0000000-0000-0000-0000-000000000006';
select test_as_email('d0000000-0000-0000-0000-000000000006', 'nom-invitee@anacorp.com');
select public.redeem_workspace_access_grants();
reset role;
select is(
  (select pending_invite_at from public.department_members
    where department_id = 'dept_nom_prd' and user_id = 'd0000000-0000-0000-0000-000000000006'),
  null,
  'redeeming the grant replaces the provisional row with an ordinary reviewer membership'
);
select is(
  (select signer_id::text from public.sop_review_seats where sop_id = 'sop_nom_1' and department_id = 'dept_nom_prd'),
  'd0000000-0000-0000-0000-000000000006',
  'the seat still names the nominee across the delete-and-reinsert'
);
select is(
  (select count(*) from public.workspace_members
    where workspace_id = 'ws_nom' and user_id = 'd0000000-0000-0000-0000-000000000006'),
  1::bigint,
  'the nominee is now a workspace member (the queue and seat access unlock)'
);
```

- [ ] **Step 2: Run pgTAP to verify it fails**

```bash
supabase db reset && supabase test db --local
```
Expected: the new assertions fail with `function public.nominate_department_reviewer(...) does not exist`.

- [ ] **Step 3: Write the migration**

Create `supabase/migrations/20260910121000_reviewer_nomination.sql`:

```sql
-- Author-nominated reviewers, 2/3: the RPCs and the grant sync trigger.
-- Spec: docs/superpowers/specs/2026-09-10-author-reviewer-invites-design.md
--
-- RLS statement: a department member may create a reviewer-level membership or invite for their
-- own department only; the Quality-gate department and every other role remain owner/admin-only.

create or replace function public.nominate_department_reviewer(
  p_department_id text,
  p_email text,
  p_position_title text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_caller uuid := auth.uid();
  v_email text := lower(btrim(coalesce(p_email, '')));
  v_title text := btrim(coalesce(p_position_title, ''));
  v_department public.departments%rowtype;
  v_user_id uuid;
  v_is_member boolean;
  v_current_role public.department_sop_role;
  v_entry jsonb;
  v_grant public.workspace_access_grants%rowtype;
begin
  if v_caller is null then
    raise exception 'Sign in first.';
  end if;

  select * into v_department from public.departments where id = p_department_id;
  if v_department.id is null then
    raise exception 'That department does not exist.';
  end if;

  if not public.is_department_member(v_department.id, v_caller)
     and not public.has_workspace_role(v_department.workspace_id, array['owner', 'admin']::public.workspace_role[]) then
    raise exception 'You can only invite reviewers into your own department.';
  end if;

  if v_department.is_quality_gate then
    raise exception 'Quality approvers are managed by an admin.';
  end if;

  if v_email = '' or position('@' in v_email) = 0 then
    raise exception 'Enter a work email address.';
  end if;

  if not exists (
    select 1 from public.workspace_auto_join_domains rule
    where rule.workspace_id = v_department.workspace_id
      and rule.domain = split_part(v_email, '@', 2)
  ) then
    raise exception 'That email domain is not approved for this organization.';
  end if;

  if v_title = '' then
    raise exception 'Enter the position title.';
  end if;

  if exists (
    select 1 from public.workspace_revocations r
    where r.workspace_id = v_department.workspace_id and r.email = v_email
  ) then
    raise exception 'That address was removed by an admin. Ask an admin to re-invite them.';
  end if;

  select u.id into v_user_id from auth.users u where lower(btrim(u.email)) = v_email limit 1;

  v_is_member := v_user_id is not null and exists (
    select 1 from public.workspace_members m
    where m.workspace_id = v_department.workspace_id and m.user_id = v_user_id
  );

  if v_is_member then
    select dept_role into v_current_role
      from public.department_members
     where department_id = v_department.id and user_id = v_user_id;

    if v_current_role is null then
      insert into public.department_members (department_id, user_id, dept_role, position_title, granted_by)
      values (v_department.id, v_user_id, 'reviewer', v_title, v_caller);
      return jsonb_build_object('mode', 'added', 'user_id', v_user_id);
    elsif v_current_role = 'author' then
      update public.department_members
         set dept_role = 'reviewer', granted_by = v_caller
       where department_id = v_department.id and user_id = v_user_id;
      return jsonb_build_object('mode', 'lifted', 'user_id', v_user_id);
    else
      return jsonb_build_object('mode', 'already_eligible', 'user_id', v_user_id);
    end if;
  end if;

  -- Not a member: write (or merge into) the grant. The package is fixed; nothing here comes from
  -- the caller except the department (already authorized) and the position title.
  v_entry := jsonb_build_object('department_id', v_department.id, 'role', 'reviewer', 'position_title', v_title);

  select * into v_grant
    from public.workspace_access_grants g
   where g.workspace_id = v_department.workspace_id and g.email = v_email
   for update;

  if v_grant.workspace_id is null then
    insert into public.workspace_access_grants
      (workspace_id, email, role, quality_access, access_package, planning_access, project_access,
       department_access, granted_by, expires_at, redeemed_by, redeemed_at)
    values
      (v_department.workspace_id, v_email, 'editor', 'edit', 'custom', false, '[]'::jsonb,
       jsonb_build_array(v_entry), v_caller, now() + interval '30 days', null, null);
  else
    -- Merge: replace only this department's entry; every other field stays as the admin set it.
    update public.workspace_access_grants
       set department_access = (
             select coalesce(jsonb_agg(entry), '[]'::jsonb)
               from jsonb_array_elements(coalesce(v_grant.department_access, '[]'::jsonb)) entry
              where entry->>'department_id' <> v_department.id
           ) || jsonb_build_array(v_entry),
           expires_at = now() + interval '30 days',
           redeemed_by = null,
           redeemed_at = null
     where workspace_id = v_department.workspace_id and email = v_email;
  end if;

  if v_user_id is not null then
    insert into public.department_members as dm
      (department_id, user_id, dept_role, position_title, granted_by, pending_invite_at)
    values (v_department.id, v_user_id, 'reviewer', v_title, v_caller, now())
    on conflict (department_id, user_id) do update
      set position_title = excluded.position_title,
          granted_by = excluded.granted_by,
          pending_invite_at = now()
      where dm.pending_invite_at is not null;
  end if;

  return jsonb_build_object('mode', 'invite', 'user_id', v_user_id);
end;
$$;

create or replace function public.mint_pending_department_reviewer(p_department_id text, p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_caller uuid := auth.uid();
  v_department public.departments%rowtype;
  v_email text;
  v_grant public.workspace_access_grants%rowtype;
  v_title text;
begin
  if v_caller is null then
    raise exception 'Sign in first.';
  end if;

  select * into v_department from public.departments where id = p_department_id;
  if v_department.id is null then
    raise exception 'That department does not exist.';
  end if;

  select lower(btrim(u.email)) into v_email from auth.users u where u.id = p_user_id;
  if v_email is null then
    raise exception 'That user does not exist.';
  end if;

  -- The row can only be minted against an unexpired, unredeemed grant the CALLER wrote — the
  -- enforcement stays in the database even though the route holds the service-role key.
  select * into v_grant
    from public.workspace_access_grants g
   where g.workspace_id = v_department.workspace_id
     and g.email = v_email
     and g.redeemed_at is null
     and g.expires_at > now()
     and g.granted_by = v_caller;
  if v_grant.workspace_id is null then
    raise exception 'No matching invitation from you for that person.';
  end if;

  select entry->>'position_title' into v_title
    from jsonb_array_elements(coalesce(v_grant.department_access, '[]'::jsonb)) entry
   where entry->>'department_id' = v_department.id and entry->>'role' = 'reviewer';
  if v_title is null then
    raise exception 'That invitation does not name this department.';
  end if;

  insert into public.department_members as dm
    (department_id, user_id, dept_role, position_title, granted_by, pending_invite_at)
  values (v_department.id, p_user_id, 'reviewer', v_title, v_caller, now())
  on conflict (department_id, user_id) do update
    set position_title = excluded.position_title,
        granted_by = excluded.granted_by,
        pending_invite_at = now()
    where dm.pending_invite_at is not null;
end;
$$;

revoke execute on function public.nominate_department_reviewer(text, text, text) from anon, public;
revoke execute on function public.mint_pending_department_reviewer(text, uuid) from anon, public;
grant execute on function public.nominate_department_reviewer(text, text, text) to authenticated;
grant execute on function public.mint_pending_department_reviewer(text, uuid) to authenticated;

-- Deleting a pending invitation deletes the provisional rows it minted (seats are never touched).
-- An admin resend refreshes expires_at; mirror it onto the marker so the roster's derived expiry
-- stays aligned without a cross-table read.
create or replace function public.sync_pending_department_reviewers()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid;
begin
  if tg_op = 'DELETE' then
    select u.id into v_user_id from auth.users u where lower(btrim(u.email)) = old.email limit 1;
    if v_user_id is not null then
      delete from public.department_members dm
       using public.departments d
       where dm.department_id = d.id
         and d.workspace_id = old.workspace_id
         and dm.user_id = v_user_id
         and dm.pending_invite_at is not null;
    end if;
    return old;
  end if;

  if new.expires_at is distinct from old.expires_at and new.redeemed_at is null then
    select u.id into v_user_id from auth.users u where lower(btrim(u.email)) = new.email limit 1;
    if v_user_id is not null then
      update public.department_members dm
         set pending_invite_at = now()
        from public.departments d
       where dm.department_id = d.id
         and d.workspace_id = new.workspace_id
         and dm.user_id = v_user_id
         and dm.pending_invite_at is not null;
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists workspace_access_grants_sync_pending_reviewers on public.workspace_access_grants;
create trigger workspace_access_grants_sync_pending_reviewers
after delete or update of expires_at on public.workspace_access_grants
for each row execute function public.sync_pending_department_reviewers();
```

- [ ] **Step 4: Fix the plan count and run pgTAP**

Confirm the test file's assertion count: 4 (Task 1) + 20 (the block) = 24, matching `select plan(24);`.

```bash
supabase db reset && supabase test db --local
```
Expected: `reviewer_nomination_test` 24/24; all other files green.

- [ ] **Step 5: Hand-extend the `Functions` block in `src/lib/database.types.ts`**

Insert, in alphabetical position within `Functions`:

```ts
      mint_pending_department_reviewer: {
        Args: { p_department_id: string; p_user_id: string }
        Returns: undefined
      }
```
and
```ts
      nominate_department_reviewer: {
        Args: { p_department_id: string; p_email: string; p_position_title: string }
        Returns: Json
      }
```

Run:
```bash
npm run typecheck
```
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add supabase/migrations/20260910121000_reviewer_nomination.sql supabase/tests/reviewer_nomination_test.sql src/lib/database.types.ts
git commit -m "feat(db): nominate_department_reviewer + mint_pending_department_reviewer RPCs and grant sync trigger

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 3: Nomination domain module

**Files:**
- Create: `src/domain/workspace/reviewer-nomination.ts`
- Test: `src/domain/workspace/reviewer-nomination.test.ts`

**Interfaces:**
- Produces:
  - `type NominationMode = "added" | "lifted" | "already_eligible" | "invite"`
  - `interface NominationRequest { sopId: string; departmentId: string; email: string; positionTitle: string }`
  - `interface NominationResponse { mode: NominationMode; userId: string | null; emailSent: boolean; seated: boolean; error?: string }`
  - `parseNominationBody(raw: unknown): NominationRequest | null`
  - `parseNominationOutcome(raw: unknown): { mode: NominationMode; userId: string | null } | null`
  - `nominatedReviewerEntitlements(departmentId, positionTitle): WorkspaceInviteEntitlements`
  - `PENDING_INVITE_DAYS = 30`, `type PendingInviteState = "none" | "pending" | "expired"`, `pendingInviteState(pendingInviteAt, now)`, `pendingInviteLabel(state)`
  - `nominationOutcomeMessage(response, email): string`

- [ ] **Step 1: Write the failing tests**

Create `src/domain/workspace/reviewer-nomination.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
  nominatedReviewerEntitlements,
  nominationOutcomeMessage,
  parseNominationBody,
  parseNominationOutcome,
  pendingInviteLabel,
  pendingInviteState,
} from "./reviewer-nomination";

const NOW = new Date("2026-09-10T12:00:00Z");

describe("parseNominationBody", () => {
  it("normalizes email and title and keeps the ids", () => {
    expect(
      parseNominationBody({ sopId: " sop-1 ", departmentId: "dept-1", email: " Jane.Doe@AnaCorp.com ", positionTitle: "  Line   Lead " }),
    ).toEqual({ sopId: "sop-1", departmentId: "dept-1", email: "jane.doe@anacorp.com", positionTitle: "Line Lead" });
  });

  it.each([
    ["missing email", { sopId: "s", departmentId: "d", positionTitle: "Lead" }],
    ["malformed email", { sopId: "s", departmentId: "d", email: "not-an-email", positionTitle: "Lead" }],
    ["empty title", { sopId: "s", departmentId: "d", email: "a@b.co", positionTitle: "   " }],
    ["title with a line break", { sopId: "s", departmentId: "d", email: "a@b.co", positionTitle: "Lead\nManager" }],
    ["missing department", { sopId: "s", email: "a@b.co", positionTitle: "Lead" }],
    ["not an object", "nope"],
  ])("rejects %s", (_label, raw) => {
    expect(parseNominationBody(raw)).toBeNull();
  });
});

describe("parseNominationOutcome", () => {
  it("accepts the four modes with a user id or null", () => {
    expect(parseNominationOutcome({ mode: "invite", user_id: null })).toEqual({ mode: "invite", userId: null });
    expect(parseNominationOutcome({ mode: "added", user_id: "u-1" })).toEqual({ mode: "added", userId: "u-1" });
  });
  it("rejects unknown modes and shapes", () => {
    expect(parseNominationOutcome({ mode: "promoted", user_id: "u-1" })).toBeNull();
    expect(parseNominationOutcome(null)).toBeNull();
  });
});

describe("nominatedReviewerEntitlements", () => {
  it("is the fixed reviewer package", () => {
    expect(nominatedReviewerEntitlements("dept-1", "Line Lead")).toEqual({
      organizationRole: "member",
      accessPackage: "custom",
      qualityAccess: "edit",
      planningAccess: false,
      projectAccess: [],
      departmentAccess: [{ departmentId: "dept-1", role: "reviewer", positionTitle: "Line Lead" }],
    });
  });
});

describe("pendingInviteState", () => {
  it("is none without a marker", () => {
    expect(pendingInviteState(null, NOW)).toBe("none");
    expect(pendingInviteState(undefined, NOW)).toBe("none");
  });
  it("is pending inside the 30-day window and expired after it", () => {
    expect(pendingInviteState("2026-08-12T12:00:00Z", NOW)).toBe("pending");
    expect(pendingInviteState("2026-08-10T12:00:00Z", NOW)).toBe("expired");
  });
  it("labels the two live states", () => {
    expect(pendingInviteLabel("pending")).toBe("Invited · not yet joined");
    expect(pendingInviteLabel("expired")).toBe("Invite expired · resend");
    expect(pendingInviteLabel("none")).toBe("");
  });
});

describe("nominationOutcomeMessage", () => {
  const base = { userId: "u-1", emailSent: false, seated: true } as const;
  it("describes each mode", () => {
    expect(nominationOutcomeMessage({ ...base, mode: "added" }, "a@anacorp.com")).toBe("a@anacorp.com can now be selected as the approver.");
    expect(nominationOutcomeMessage({ ...base, mode: "lifted" }, "a@anacorp.com")).toBe("a@anacorp.com now has Review access and can be selected as the approver.");
    expect(nominationOutcomeMessage({ ...base, mode: "already_eligible" }, "a@anacorp.com")).toBe("a@anacorp.com can already be selected as the approver.");
    expect(nominationOutcomeMessage({ ...base, mode: "invite", emailSent: true }, "a@anacorp.com")).toBe(
      "Invitation sent to a@anacorp.com. You can seat them now; the review will be waiting when they join.",
    );
  });
  it("says when the email did not go out or the seat could not be prepared", () => {
    expect(nominationOutcomeMessage({ mode: "invite", userId: "u-1", emailSent: false, seated: true, error: "boom" }, "a@anacorp.com")).toBe(
      "Added, but the invitation email didn't send — use Resend. (boom)",
    );
    expect(nominationOutcomeMessage({ mode: "invite", userId: null, emailSent: true, seated: false }, "a@anacorp.com")).toBe(
      "Invitation sent to a@anacorp.com, but they can't be seated yet — try Resend in a moment.",
    );
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

```bash
npx vitest run src/domain/workspace/reviewer-nomination.test.ts
```
Expected: FAIL — module not found.

- [ ] **Step 3: Write the module**

Create `src/domain/workspace/reviewer-nomination.ts`:

```ts
/**
 * Author-nominated reviewers — the pure half. Request/outcome parsing for the route, the fixed
 * entitlement package (for the invitation email's access summary), pending-state derivation for
 * the roster, and outcome copy. No React, no Supabase, no clocks (callers pass `now`).
 * Spec: docs/superpowers/specs/2026-09-10-author-reviewer-invites-design.md
 */

import { normalizeJobTitle } from "@/domain/departments";
import type { WorkspaceInviteEntitlements } from "@/domain/workspace/invite-access";

export type NominationMode = "added" | "lifted" | "already_eligible" | "invite";

const NOMINATION_MODES: readonly NominationMode[] = ["added", "lifted", "already_eligible", "invite"];

export interface NominationRequest {
  sopId: string;
  departmentId: string;
  email: string;
  positionTitle: string;
}

export interface NominationResponse {
  mode: NominationMode;
  userId: string | null;
  emailSent: boolean;
  /** The nominee is selectable in the roster right now (membership or provisional row exists). */
  seated: boolean;
  error?: string;
}

const EMAIL_SHAPE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function parseNominationBody(raw: unknown): NominationRequest | null {
  if (!raw || typeof raw !== "object") return null;
  const record = raw as Record<string, unknown>;
  const sopId = typeof record.sopId === "string" ? record.sopId.trim() : "";
  const departmentId = typeof record.departmentId === "string" ? record.departmentId.trim() : "";
  const email = typeof record.email === "string" ? record.email.trim().toLowerCase() : "";
  const positionTitle = typeof record.positionTitle === "string" ? normalizeJobTitle(record.positionTitle) : null;
  if (!sopId || !departmentId || !EMAIL_SHAPE.test(email) || !positionTitle) return null;
  return { sopId, departmentId, email, positionTitle };
}

export function parseNominationOutcome(raw: unknown): { mode: NominationMode; userId: string | null } | null {
  if (!raw || typeof raw !== "object") return null;
  const record = raw as Record<string, unknown>;
  const mode = NOMINATION_MODES.find((candidate) => candidate === record.mode);
  if (!mode) return null;
  const userId = typeof record.user_id === "string" && record.user_id ? record.user_id : null;
  return { mode, userId };
}

/** The fixed package a nomination grants — mirrors the database function; used only for the email's access summary. */
export function nominatedReviewerEntitlements(departmentId: string, positionTitle: string): WorkspaceInviteEntitlements {
  return {
    organizationRole: "member",
    accessPackage: "custom",
    qualityAccess: "edit",
    planningAccess: false,
    projectAccess: [],
    departmentAccess: [{ departmentId, role: "reviewer", positionTitle }],
  };
}

export const PENDING_INVITE_DAYS = 30;
const DAY_MS = 24 * 60 * 60 * 1000;

export type PendingInviteState = "none" | "pending" | "expired";

export function pendingInviteState(pendingInviteAt: string | null | undefined, now: Date): PendingInviteState {
  if (!pendingInviteAt) return "none";
  const startedAt = new Date(pendingInviteAt).getTime();
  if (Number.isNaN(startedAt)) return "none";
  return now.getTime() - startedAt > PENDING_INVITE_DAYS * DAY_MS ? "expired" : "pending";
}

export function pendingInviteLabel(state: PendingInviteState): string {
  if (state === "pending") return "Invited · not yet joined";
  if (state === "expired") return "Invite expired · resend";
  return "";
}

export function nominationOutcomeMessage(response: NominationResponse, email: string): string {
  switch (response.mode) {
    case "added":
      return `${email} can now be selected as the approver.`;
    case "lifted":
      return `${email} now has Review access and can be selected as the approver.`;
    case "already_eligible":
      return `${email} can already be selected as the approver.`;
    case "invite":
      if (!response.emailSent) {
        return `Added, but the invitation email didn't send — use Resend.${response.error ? ` (${response.error})` : ""}`;
      }
      if (!response.seated) {
        return `Invitation sent to ${email}, but they can't be seated yet — try Resend in a moment.`;
      }
      return `Invitation sent to ${email}. You can seat them now; the review will be waiting when they join.`;
  }
}
```

- [ ] **Step 4: Run the tests to verify they pass**

```bash
npx vitest run src/domain/workspace/reviewer-nomination.test.ts
```
Expected: PASS (all cases).

- [ ] **Step 5: Commit**

```bash
git add src/domain/workspace/reviewer-nomination.ts src/domain/workspace/reviewer-nomination.test.ts
git commit -m "feat(domain): reviewer nomination parsing, fixed package, pending-invite state

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 4: Extract the invite delivery helpers (no behavior change)

**Files:**
- Create: `src/lib/workspace/invite-delivery.ts`
- Modify: `app/api/invites/route.ts:1-139` (remove the moved code, import it), call sites at ~366 and ~387 (`deliver` → `deliverInvitationEmail`)
- Test: existing `app/api/invites/route.test.ts` must stay green

**Interfaces:**
- Produces:
  - `type SetupLink = { kind: "link"; tokenHash: string; type: WorkspaceInviteVerificationType; userId: string | null } | { kind: "already_registered"; userId: string | null } | { kind: "unavailable"; message: string; code: string | null; status: number | null }`
  - `generateSetupLink(admin, email, redirectTo): Promise<SetupLink>`
  - `deliverInvitationEmail(send, to, content, record: { admin; kind: TransactionalEmailKind; workspaceId }): Promise<boolean>`
  - `countWorkspaceMemberships(admin, userId): Promise<number>`

- [ ] **Step 1: Create the module**

Create `src/lib/workspace/invite-delivery.ts`:

```ts
/**
 * Invitation delivery helpers shared by the admin invite route and the author-nomination route.
 * Service-role only: `admin` must be a service-role client. Moved verbatim from
 * app/api/invites/route.ts (2026-09-10) with one addition — the setup link carries the auth user
 * id so a caller can mint a provisional membership for a freshly created invitee.
 */

import { randomUUID } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { SopEmailContent } from "@/domain/sop/notifications";
import {
  inviteeHasCompletedSetup,
  isAlreadyRegisteredAuthError,
  type WorkspaceInviteVerificationType,
} from "@/domain/workspace/invite";
import type { Database } from "@/lib/database.types";
import { recordTransactionalEmail, type TransactionalEmailKind } from "@/lib/notifications/transactional-log";
import type { EmailSender } from "@/lib/sop/notifications-drain";

export type SetupLink =
  | { kind: "link"; tokenHash: string; type: WorkspaceInviteVerificationType; userId: string | null }
  | { kind: "already_registered"; userId: string | null }
  | { kind: "unavailable"; message: string; code: string | null; status: number | null };

export async function countWorkspaceMemberships(admin: SupabaseClient<Database>, userId: string | undefined): Promise<number> {
  if (!userId) return 0;
  const { count, error } = await admin
    .from("workspace_members")
    .select("user_id", { count: "exact", head: true })
    .eq("user_id", userId);
  if (error) {
    // Unknown is treated as "not set up": a setup link is the safe default, since
    // it only takes effect if the invitee clicks it and chooses a password.
    console.error("Invite resend: membership lookup failed", { message: error.message });
    return 0;
  }
  return count ?? 0;
}

/**
 * Mint the one-time token behind the "create your password" link.
 *
 * The first invite creates the auth user, so a second call to generateLink(type: "invite") —
 * which is what every RESEND is — comes back "already registered". For an existing user we mint
 * a recovery token instead, which the /invite page already knows how to verify — unless they
 * already belong to a workspace, in which case they own a password and get a reminder, not a
 * credential.
 */
export async function generateSetupLink(
  admin: SupabaseClient<Database>,
  email: string,
  redirectTo: string,
): Promise<SetupLink> {
  const invite = await admin.auth.admin.generateLink({ type: "invite", email, options: { redirectTo } });
  if (!invite.error && invite.data.properties?.hashed_token) {
    return { kind: "link", tokenHash: invite.data.properties.hashed_token, type: "invite", userId: invite.data.user?.id ?? null };
  }
  if (!invite.error || !isAlreadyRegisteredAuthError(invite.error)) {
    return {
      kind: "unavailable",
      message: invite.error?.message ?? "Supabase returned no invitation token.",
      code: invite.error?.code ?? null,
      status: invite.error?.status ?? null,
    };
  }

  const recovery = await admin.auth.admin.generateLink({ type: "recovery", email, options: { redirectTo } });
  if (recovery.error || !recovery.data.properties?.hashed_token) {
    return {
      kind: "unavailable",
      message: recovery.error?.message ?? "Supabase returned no recovery token.",
      code: recovery.error?.code ?? null,
      status: recovery.error?.status ?? null,
    };
  }
  const userId = recovery.data.user?.id ?? null;
  const workspaceMemberships = await countWorkspaceMemberships(admin, userId ?? undefined);
  if (inviteeHasCompletedSetup({ workspaceMemberships })) {
    return { kind: "already_registered", userId };
  }
  return { kind: "link", tokenHash: recovery.data.properties.hashed_token, type: "recovery", userId };
}

export interface DeliveryRecord {
  admin: SupabaseClient<Database>;
  kind: TransactionalEmailKind;
  workspaceId: string;
}

/** Send one email and record the outcome in the transactional ledger, logging (never throwing) on failure. */
export async function deliverInvitationEmail(
  send: EmailSender,
  to: string,
  content: SopEmailContent,
  record: DeliveryRecord,
): Promise<boolean> {
  try {
    // Every click is a deliberate (re)send, so the key is per request: it guards the provider
    // retry inside this call, never a later resend.
    const result = await send(to, content, { idempotencyKey: `invite:${randomUUID()}` });
    await recordTransactionalEmail(record.admin, {
      kind: record.kind,
      recipientEmail: to,
      workspaceId: record.workspaceId,
      result,
    });
    if (result.ok) return true;
    console.error("Invitation email delivery failed", { status: result.status, failure: result.failure });
  } catch (error) {
    console.error("Invitation email delivery threw", {
      message: error instanceof Error ? error.message : String(error),
    });
  }
  return false;
}
```

- [ ] **Step 2: Rewire `app/api/invites/route.ts`**

1. Delete lines 45–139 (the `SetupLink` type, `countWorkspaceMemberships`, `generateSetupLink`, `DeliveryRecord`, `deliver`).
2. Replace the two `deliver(` calls (the `already_registered` branch and the `link` branch) with `deliverInvitationEmail(`.
3. Fix the imports at the top of the file so they read:

```ts
import { createClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";
import { renderWorkspaceAccessGrantedEmail, renderWorkspaceInviteEmail } from "@/domain/workspace/invite-email";
import { createApiRateLimiter, requireApiUser } from "@/lib/api-auth";
import type { Database, Json } from "@/lib/database.types";
import { isAllowedSignupEmail, SIGNUP_DOMAIN_MESSAGE } from "@/lib/allowed-signup-domain";
import {
  inviteeHasCompletedSetup,
  isAlreadyRegisteredAuthError,
  qualityModuleInviteRedirect,
  workspaceInviteAcceptanceUrl,
} from "@/domain/workspace/invite";
import {
  describeInviteEntitlements,
  normalizedInviteEntitlements,
  workspaceRoleForOrganizationRole,
  type InviteAccessPackage,
  type InviteDepartmentAccess,
  type InviteProjectAccess,
  type OrganizationInviteRole,
  type WorkspaceInviteEntitlements,
} from "@/domain/workspace/invite-access";
import { describeUnavailable, logMissingConfig } from "@/lib/auth/password-recovery-request";
import { createEmailSenderFromEnv } from "@/lib/notifications/sender-from-env";
import { recordTransactionalEmail } from "@/lib/notifications/transactional-log";
import { createResendSender } from "@/lib/sop/notifications-drain";
import { normalizeJobTitle } from "@/domain/departments";
import { countWorkspaceMemberships, deliverInvitationEmail, generateSetupLink } from "@/lib/workspace/invite-delivery";
```

(`randomUUID`, `SupabaseClient`, `SopEmailContent`, `WorkspaceInviteVerificationType`, `TransactionalEmailKind`, and `EmailSender` are no longer used in the route.) `countWorkspaceMemberships` is still used in the Supabase-mail fallback near the end of `POST`.

- [ ] **Step 3: Run the existing route tests, typecheck, lint**

```bash
npx vitest run app/api/invites/route.test.ts && npm run typecheck && npm run lint
```
Expected: the invite route tests pass unchanged; no type errors; lint clean (no unused imports).

- [ ] **Step 4: Commit**

```bash
git add src/lib/workspace/invite-delivery.ts app/api/invites/route.ts
git commit -m "refactor(invites): extract setup-link and delivery helpers for reuse

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 5: The nomination route and the manager inbox writer

**Files:**
- Create: `src/lib/notifications/inbox-writer.ts`
- Test: `src/lib/notifications/inbox-writer.test.ts`
- Create: `app/api/sops/reviewers/nominate/route.ts`
- Test: `app/api/sops/reviewers/nominate/route.test.ts`
- Modify: `src/domain/notifications/channels.ts:20-37` (catalog entry `reviewer_nominated`)

**Interfaces:**
- Consumes: `nominate_department_reviewer` / `mint_pending_department_reviewer` (Task 2); `parseNominationBody`, `parseNominationOutcome`, `nominatedReviewerEntitlements`, `NominationResponse` (Task 3); `generateSetupLink`, `deliverInvitationEmail` (Task 4).
- Produces: `POST /api/sops/reviewers/nominate` with body `{ sopId, departmentId, email, positionTitle }` → `NominationResponse` JSON (200), or `{ error }` (400/429/500). `insertInboxRows(admin, rows: InboxRowInput[]): Promise<boolean>`.

- [ ] **Step 1: Write the inbox-writer test**

Create `src/lib/notifications/inbox-writer.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";
import { insertInboxRows } from "./inbox-writer";

function fakeAdmin(insert: ReturnType<typeof vi.fn>) {
  return { from: () => ({ insert }) } as unknown as SupabaseClient<Database>;
}

describe("insertInboxRows", () => {
  it("writes one notifications row per input with the body capped", async () => {
    const insert = vi.fn(async () => ({ error: null }));
    const ok = await insertInboxRows(fakeAdmin(insert), [
      { recipientId: "m-1", workspaceId: "ws", source: "workspace", kind: "reviewer_nominated", entityType: "sop", entityId: "sop-1", title: "T", body: "x".repeat(400), link: "/sops/sop-1" },
    ]);
    expect(ok).toBe(true);
    expect(insert).toHaveBeenCalledWith([
      expect.objectContaining({ recipient_id: "m-1", workspace_id: "ws", source: "workspace", kind: "reviewer_nominated", source_ledger_id: null, title: "T", link: "/sops/sop-1" }),
    ]);
    expect((insert.mock.calls[0][0] as { body: string }[])[0].body).toHaveLength(280);
  });

  it("is a no-op for an empty list and never throws on a database error", async () => {
    const insert = vi.fn(async () => ({ error: { message: "boom" } }));
    expect(await insertInboxRows(fakeAdmin(insert), [])).toBe(true);
    expect(insert).not.toHaveBeenCalled();
    expect(
      await insertInboxRows(fakeAdmin(insert), [
        { recipientId: "m-1", workspaceId: null, source: "workspace", kind: "k", entityType: null, entityId: null, title: "T", body: "b", link: null },
      ]),
    ).toBe(false);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

```bash
npx vitest run src/lib/notifications/inbox-writer.test.ts
```
Expected: FAIL — module not found.

- [ ] **Step 3: Write the inbox writer**

Create `src/lib/notifications/inbox-writer.ts`:

```ts
/**
 * Service-role inbox writes for decisions made OUTSIDE the drains (e.g. a reviewer nomination
 * telling the managers). The drains write their own inbox rows next to their ledger rows; this is
 * for one-off, informational in-app notices with no email channel. Never throws — an inbox miss
 * must not fail the action it reports.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { INBOX_BODY_MAX } from "@/domain/notifications/inbox";
import type { Database } from "@/lib/database.types";

export interface InboxRowInput {
  recipientId: string;
  workspaceId: string | null;
  source: "sop" | "workspace" | "digest";
  kind: string;
  entityType: string | null;
  entityId: string | null;
  title: string;
  body: string;
  link: string | null;
}

export async function insertInboxRows(admin: SupabaseClient<Database>, rows: readonly InboxRowInput[]): Promise<boolean> {
  if (rows.length === 0) return true;
  const { error } = await admin.from("notifications").insert(
    rows.map((row) => ({
      recipient_id: row.recipientId,
      workspace_id: row.workspaceId,
      source: row.source,
      source_ledger_id: null,
      kind: row.kind,
      entity_type: row.entityType,
      entity_id: row.entityId,
      title: row.title,
      body: row.body.slice(0, INBOX_BODY_MAX),
      link: row.link,
    })),
  );
  if (error) {
    console.error("notifications: inbox insert failed", { message: error.message, kind: rows[0]?.kind });
    return false;
  }
  return true;
}
```

Run `npx vitest run src/lib/notifications/inbox-writer.test.ts` — expected PASS.

- [ ] **Step 4: Add the catalog entry**

In `src/domain/notifications/channels.ts`, inside `NOTIFICATION_KINDS`, after `member_removed`:

```ts
  reviewer_nominated: { label: "A reviewer was nominated in your workspace", group: "workspace", defaultEmail: false },
```

- [ ] **Step 5: Write the failing route test**

Create `app/api/sops/reviewers/nominate/route.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  rpc: vi.fn(),
  callerFrom: vi.fn(),
  adminFrom: vi.fn(),
  inviteUserByEmail: vi.fn(),
  generateSetupLink: vi.fn(),
  deliverInvitationEmail: vi.fn(),
  insertInboxRows: vi.fn(),
  send: vi.fn(),
}));

vi.mock("@supabase/supabase-js", () => ({
  createClient: () => ({
    auth: { admin: { inviteUserByEmail: mocks.inviteUserByEmail } },
    from: mocks.adminFrom,
  }),
}));

vi.mock("@/lib/api-auth", () => ({
  createApiRateLimiter: () => () => true,
  requireApiUser: () => Promise.resolve({ userId: "author-1", supabase: { from: mocks.callerFrom, rpc: mocks.rpc }, failure: null }),
}));

vi.mock("@/lib/sop/notifications-drain", () => ({
  createResendSender: () => mocks.send,
}));

vi.mock("@/lib/workspace/invite-delivery", () => ({
  generateSetupLink: mocks.generateSetupLink,
  deliverInvitationEmail: mocks.deliverInvitationEmail,
}));

vi.mock("@/lib/notifications/inbox-writer", () => ({
  insertInboxRows: mocks.insertInboxRows,
}));

import { POST } from "./route";

function nominateRequest(overrides: Record<string, unknown> = {}) {
  return new Request("http://localhost:3000/api/sops/reviewers/nominate", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      sopId: "sop-1",
      departmentId: "dept-prd",
      email: " New.Reviewer@AnaCorp.com ",
      positionTitle: "Line Lead",
      ...overrides,
    }),
  });
}

/** A chainable query stub resolving to `result` for any terminal call. */
function query(result: unknown) {
  const chain: Record<string, unknown> = {};
  for (const method of ["select", "eq", "in", "maybeSingle"]) {
    chain[method] = () => chain;
  }
  chain.then = (resolve: (value: unknown) => unknown) => Promise.resolve(result).then(resolve);
  chain.maybeSingle = () => Promise.resolve(result);
  return chain;
}

beforeEach(() => {
  vi.clearAllMocks();
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://project.supabase.co";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "service-key";
  process.env.RESEND_API_KEY = "resend-key";
  process.env.RESEND_FROM = "Pulse <notifications@example.com>";
  process.env.NEXT_PUBLIC_SITE_URL = "https://pulse.anacorp.com";
  process.env.NOTIFICATION_EMAIL_REDIRECT_TO = "";

  mocks.callerFrom.mockImplementation((table: string) => {
    if (table === "departments") return query({ data: { id: "dept-prd", name: "Production", workspace_id: "ws-1" }, error: null });
    if (table === "workspaces") return query({ data: { name: "ANA Corp" }, error: null });
    throw new Error(`unexpected caller table ${table}`);
  });
  mocks.adminFrom.mockImplementation((table: string) => {
    if (table === "workspace_members") return query({ data: [{ user_id: "owner-1" }, { user_id: "author-1" }], error: null });
    if (table === "profiles") return query({ data: { full_name: "Ana Author" }, error: null });
    throw new Error(`unexpected admin table ${table}`);
  });
  mocks.rpc.mockImplementation((name: string) => {
    if (name === "nominate_department_reviewer") return Promise.resolve({ data: { mode: "invite", user_id: "u-6" }, error: null });
    if (name === "mint_pending_department_reviewer") return Promise.resolve({ data: null, error: null });
    return Promise.resolve({ data: null, error: { message: `unexpected rpc ${name}` } });
  });
  mocks.generateSetupLink.mockResolvedValue({ kind: "link", tokenHash: "hash-1", type: "invite", userId: "u-6" });
  mocks.deliverInvitationEmail.mockResolvedValue(true);
  mocks.insertInboxRows.mockResolvedValue(true);
});

describe("POST /api/sops/reviewers/nominate", () => {
  it("rejects a malformed body", async () => {
    const response = await POST(nominateRequest({ email: "not-an-email" }));
    expect(response.status).toBe(400);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it("surfaces the database's refusal verbatim", async () => {
    mocks.rpc.mockResolvedValueOnce({ data: null, error: { message: "You can only invite reviewers into your own department." } });
    const response = await POST(nominateRequest());
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ error: "You can only invite reviewers into your own department." });
  });

  it("adds an existing member with no email and tells the other managers", async () => {
    mocks.rpc.mockImplementationOnce(() => Promise.resolve({ data: { mode: "added", user_id: "u-5" }, error: null }));
    const response = await POST(nominateRequest());
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ mode: "added", userId: "u-5", emailSent: false, seated: true });
    expect(mocks.generateSetupLink).not.toHaveBeenCalled();
    expect(mocks.insertInboxRows).toHaveBeenCalledTimes(1);
    const rows = mocks.insertInboxRows.mock.calls[0][1] as { recipientId: string; kind: string; link: string }[];
    expect(rows.map((row) => row.recipientId)).toEqual(["owner-1"]);
    expect(rows[0]).toMatchObject({ kind: "reviewer_nominated", link: "/sops/sop-1" });
  });

  it("invites a known auth user: sends the setup link, mints the provisional seat, normalizes the email", async () => {
    const response = await POST(nominateRequest());
    await expect(response.json()).resolves.toEqual({ mode: "invite", userId: "u-6", emailSent: true, seated: true });
    expect(mocks.rpc).toHaveBeenCalledWith("nominate_department_reviewer", {
      p_department_id: "dept-prd",
      p_email: "new.reviewer@anacorp.com",
      p_position_title: "Line Lead",
    });
    expect(mocks.rpc).toHaveBeenCalledWith("mint_pending_department_reviewer", { p_department_id: "dept-prd", p_user_id: "u-6" });
    expect(mocks.deliverInvitationEmail).toHaveBeenCalledTimes(1);
    expect(mocks.deliverInvitationEmail.mock.calls[0][3]).toMatchObject({ kind: "invite", workspaceId: "ws-1" });
  });

  it("invites a brand-new address: the user id comes from the setup link", async () => {
    mocks.rpc.mockImplementationOnce(() => Promise.resolve({ data: { mode: "invite", user_id: null }, error: null }));
    mocks.generateSetupLink.mockResolvedValueOnce({ kind: "link", tokenHash: "hash-2", type: "invite", userId: "new-1" });
    const response = await POST(nominateRequest());
    await expect(response.json()).resolves.toEqual({ mode: "invite", userId: "new-1", emailSent: true, seated: true });
    expect(mocks.rpc).toHaveBeenCalledWith("mint_pending_department_reviewer", { p_department_id: "dept-prd", p_user_id: "new-1" });
  });

  it("reports an unseated invite when the mint fails, without hiding that the email went out", async () => {
    mocks.rpc.mockImplementation((name: string) => {
      if (name === "nominate_department_reviewer") return Promise.resolve({ data: { mode: "invite", user_id: "u-6" }, error: null });
      return Promise.resolve({ data: null, error: { message: "No matching invitation from you for that person." } });
    });
    const response = await POST(nominateRequest());
    await expect(response.json()).resolves.toEqual({
      mode: "invite",
      userId: "u-6",
      emailSent: true,
      seated: false,
      error: "No matching invitation from you for that person.",
    });
  });

  it("falls back to Supabase mail when Resend is not configured", async () => {
    process.env.RESEND_API_KEY = "";
    mocks.inviteUserByEmail.mockResolvedValue({ data: { user: { id: "u-6" } }, error: null });
    const response = await POST(nominateRequest());
    await expect(response.json()).resolves.toEqual({ mode: "invite", userId: "u-6", emailSent: true, seated: true });
    expect(mocks.generateSetupLink).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 6: Run the route test to verify it fails**

```bash
npx vitest run app/api/sops/reviewers/nominate/route.test.ts
```
Expected: FAIL — `./route` not found.

- [ ] **Step 7: Write the route**

Create `app/api/sops/reviewers/nominate/route.ts`:

```ts
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";
import { describeInviteEntitlements } from "@/domain/workspace/invite-access";
import { renderWorkspaceAccessGrantedEmail, renderWorkspaceInviteEmail } from "@/domain/workspace/invite-email";
import { qualityModuleInviteRedirect, workspaceInviteAcceptanceUrl } from "@/domain/workspace/invite";
import {
  nominatedReviewerEntitlements,
  parseNominationBody,
  parseNominationOutcome,
  type NominationMode,
  type NominationResponse,
} from "@/domain/workspace/reviewer-nomination";
import { createApiRateLimiter, requireApiUser } from "@/lib/api-auth";
import { describeUnavailable, logMissingConfig } from "@/lib/auth/password-recovery-request";
import type { Database } from "@/lib/database.types";
import { insertInboxRows } from "@/lib/notifications/inbox-writer";
import { createEmailSenderFromEnv } from "@/lib/notifications/sender-from-env";
import { createResendSender } from "@/lib/sop/notifications-drain";
import { deliverInvitationEmail, generateSetupLink } from "@/lib/workspace/invite-delivery";

export const dynamic = "force-dynamic";

const checkRateLimit = createApiRateLimiter({ windowMs: 60_000, maxRequests: 10 });

interface NominationScope {
  workspaceId: string;
  workspaceName: string;
  departmentId: string;
  departmentName: string;
}

async function loadScope(supabase: SupabaseClient<Database>, departmentId: string): Promise<NominationScope | null> {
  const { data: department, error: departmentError } = await supabase
    .from("departments")
    .select("id, name, workspace_id")
    .eq("id", departmentId)
    .maybeSingle();
  if (departmentError || !department) return null;
  const { data: workspace } = await supabase.from("workspaces").select("name").eq("id", department.workspace_id).maybeSingle();
  return {
    workspaceId: department.workspace_id,
    workspaceName: workspace?.name ?? "your organization",
    departmentId: department.id,
    departmentName: department.name,
  };
}

/** In-app only: owners/admins learn who nominated whom. The nominator never notifies themselves. */
async function notifyManagers(
  admin: SupabaseClient<Database>,
  scope: NominationScope,
  sopId: string,
  actorId: string,
  email: string,
  mode: NominationMode,
): Promise<void> {
  const [managers, actor] = await Promise.all([
    admin.from("workspace_members").select("user_id").eq("workspace_id", scope.workspaceId).in("role", ["owner", "admin"]),
    admin.from("profiles").select("full_name").eq("id", actorId).maybeSingle(),
  ]);
  const actorName = actor.data?.full_name || "An author";
  const title = `${actorName} nominated ${email} as a reviewer for ${scope.departmentName}`;
  const body =
    mode === "invite"
      ? "An invitation was sent. They can be seated now; the review will be waiting when they join."
      : "They can now be selected as a departmental approver.";
  await insertInboxRows(
    admin,
    (managers.data ?? [])
      .filter((member) => member.user_id !== actorId)
      .map((member) => ({
        recipientId: member.user_id,
        workspaceId: scope.workspaceId,
        source: "workspace" as const,
        kind: "reviewer_nominated",
        entityType: "sop",
        entityId: sopId,
        title,
        body,
        link: `/sops/${sopId}`,
      })),
  );
}

/**
 * Nominate a reviewer for the caller's own department. Authorization lives in the
 * nominate_department_reviewer RPC (department membership, Quality gate, approved domain,
 * revocations, role ceiling). The service-role key is used only to send the invitation email and
 * to write the managers' in-app notice — exactly the split app/api/invites/route.ts uses.
 */
export async function POST(request: Request) {
  const auth = await requireApiUser(request);
  if (auth.failure) return auth.failure;
  if (!checkRateLimit(auth.userId)) {
    return NextResponse.json({ error: "Too many invites right now — try again in a few minutes." }, { status: 429 });
  }

  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }
  const body = parseNominationBody(raw);
  if (!body) {
    return NextResponse.json({ error: "sopId, departmentId, email, and positionTitle are required." }, { status: 400 });
  }

  const supabase = auth.supabase;
  const { data: outcomeRaw, error: rpcError } = await supabase.rpc("nominate_department_reviewer", {
    p_department_id: body.departmentId,
    p_email: body.email,
    p_position_title: body.positionTitle,
  });
  if (rpcError) {
    return NextResponse.json({ error: rpcError.message }, { status: 400 });
  }
  const outcome = parseNominationOutcome(outcomeRaw);
  if (!outcome) {
    return NextResponse.json({ error: "The nomination returned an unexpected result." }, { status: 500 });
  }

  const scope = await loadScope(supabase, body.departmentId);
  if (!scope) {
    return NextResponse.json({ error: "That department could not be loaded." }, { status: 500 });
  }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
  const admin = serviceRoleKey
    ? createClient<Database>(supabaseUrl, serviceRoleKey, { auth: { autoRefreshToken: false, persistSession: false } })
    : null;

  if (outcome.mode !== "invite") {
    if (admin) await notifyManagers(admin, scope, body.sopId, auth.userId, body.email, outcome.mode);
    const response: NominationResponse = { mode: outcome.mode, userId: outcome.userId, emailSent: false, seated: true };
    return NextResponse.json(response);
  }

  if (!admin) {
    logMissingConfig("Reviewer invitations", ["SUPABASE_SERVICE_ROLE_KEY"], process.env.VERCEL_ENV);
    const response: NominationResponse = {
      mode: "invite",
      userId: outcome.userId,
      emailSent: false,
      seated: false,
      error: `${describeUnavailable("Invitations", process.env.VERCEL_ENV)} Missing configuration: SUPABASE_SERVICE_ROLE_KEY.`,
    };
    return NextResponse.json(response);
  }

  const configuredSiteUrl =
    process.env.NEXT_PUBLIC_SITE_URL ??
    (process.env.VERCEL_PROJECT_PRODUCTION_URL ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}` : undefined);
  const redirectTo = qualityModuleInviteRedirect(request.url, configuredSiteUrl);
  const resendApiKey = process.env.RESEND_API_KEY ?? "";
  const resendFrom = process.env.RESEND_FROM ?? "";

  let userId = outcome.userId;
  let emailSent = false;
  let emailError: string | undefined;

  if (resendApiKey && resendFrom) {
    const setupLink = await generateSetupLink(admin, body.email, redirectTo);
    const send = createEmailSenderFromEnv().send ?? createResendSender(resendApiKey, resendFrom);
    const origin = new URL(redirectTo).origin;
    const accessSummary = describeInviteEntitlements(
      nominatedReviewerEntitlements(scope.departmentId, body.positionTitle),
      new Map(),
      new Map([[scope.departmentId, scope.departmentName]]),
    );
    if (setupLink.kind === "link") {
      userId = userId ?? setupLink.userId;
      emailSent = await deliverInvitationEmail(
        send,
        body.email,
        renderWorkspaceInviteEmail({
          actionLink: workspaceInviteAcceptanceUrl(redirectTo, body.email, setupLink.tokenHash, setupLink.type),
          accessSummary,
          email: body.email,
          organizationName: scope.workspaceName,
          origin,
        }),
        { admin, kind: "invite", workspaceId: scope.workspaceId },
      );
    } else if (setupLink.kind === "already_registered") {
      userId = userId ?? setupLink.userId;
      emailSent = await deliverInvitationEmail(
        send,
        body.email,
        renderWorkspaceAccessGrantedEmail({
          accessSummary,
          email: body.email,
          organizationName: scope.workspaceName,
          origin,
          signInLink: new URL("/", origin).toString(),
        }),
        { admin, kind: "access_granted", workspaceId: scope.workspaceId },
      );
    } else {
      emailError = setupLink.message;
      console.error("Reviewer nomination: invitation link generation failed", {
        message: setupLink.message,
        code: setupLink.code,
        status: setupLink.status,
      });
    }
  } else {
    const { data, error } = await admin.auth.admin.inviteUserByEmail(body.email, { redirectTo });
    if (error) {
      emailError = error.message;
    } else {
      emailSent = true;
      userId = userId ?? data.user?.id ?? null;
    }
  }

  let seated = false;
  let seatError: string | undefined;
  if (userId) {
    const { error: mintError } = await supabase.rpc("mint_pending_department_reviewer", {
      p_department_id: body.departmentId,
      p_user_id: userId,
    });
    if (mintError) seatError = mintError.message;
    else seated = true;
  }

  await notifyManagers(admin, scope, body.sopId, auth.userId, body.email, "invite");

  const response: NominationResponse = {
    mode: "invite",
    userId,
    emailSent,
    seated,
    ...(seatError
      ? { error: seatError }
      : emailSent
        ? {}
        : { error: emailError ?? "The invitation email could not be sent. Use Resend." }),
  };
  return NextResponse.json(response);
}
```

- [ ] **Step 8: Run the route test, typecheck, lint**

```bash
npx vitest run app/api/sops/reviewers/nominate/route.test.ts src/lib/notifications && npm run typecheck && npm run lint
```
Expected: all PASS; no type errors; lint clean.

- [ ] **Step 9: Commit**

```bash
git add src/lib/notifications/inbox-writer.ts src/lib/notifications/inbox-writer.test.ts app/api/sops/reviewers/nominate src/domain/notifications/channels.ts
git commit -m "feat(api): POST /api/sops/reviewers/nominate with manager inbox notice

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 6: Roster editor — pending tags, "Invite a reviewer", and the editor wiring

**Files:**
- Modify: `src/domain/departments.ts:37-43` (`DepartmentMember.pendingInviteAt?`)
- Modify: `src/lib/departments/store.ts:15,52-59` (`MEMBER_COLUMNS`, `mapMember`)
- Modify: `src/lib/sop/review.ts:357-368` (`listProfileNames` falls back to email)
- Create: `src/domain/sop/roster-options.ts` (+ `roster-options.test.ts`)
- Create: `src/components/sop/reviewer-invite-form.tsx` (+ `reviewer-invite-form.test.tsx`)
- Modify: `src/components/sop/sop-roster-editor.tsx` (+ extend `sop-roster-editor.test.tsx`)
- Modify: `src/components/sop/sop-editor.tsx:20,366-380,436-475,2014-2021`

**Interfaces:**
- Consumes: `pendingInviteState`, `pendingInviteLabel`, `nominationOutcomeMessage`, `NominationResponse` (Task 3); `POST /api/sops/reviewers/nominate` (Task 5).
- Produces: `buildApproverOptions({ members, signerId, placeholder, now }): RosterOption[]`; `<ReviewerInviteForm sopId departmentId departmentCode onNominated onCancel />`; `SopRosterEditor` prop `myDeptRoles?: ReadonlyMap<string, DeptRole>`.

- [ ] **Step 1: Store and type plumbing**

In `src/domain/departments.ts`, extend the interface:

```ts
export interface DepartmentMember {
  departmentId: string;
  userId: string;
  deptRole: DeptRole;
  /** Organizational job title, separate from the member's SOP access level. */
  positionTitle: string;
  /** Set while the membership is provisional (invited, not yet joined); null/absent for ordinary members. */
  pendingInviteAt?: string | null;
}
```

In `src/lib/departments/store.ts`:

```ts
const MEMBER_COLUMNS = "department_id, user_id, dept_role, position_title, pending_invite_at";
```
```ts
function mapMember(row: Record<string, unknown>): DepartmentMember {
  return {
    departmentId: String(row.department_id),
    userId: String(row.user_id),
    deptRole: (row.dept_role as DeptRole | null) ?? "author",
    positionTitle: String(row.position_title ?? ""),
    pendingInviteAt: typeof row.pending_invite_at === "string" ? row.pending_invite_at : null,
  };
}
```

In `src/lib/sop/review.ts`, replace `listProfileNames` so an invitee with no display name still shows as their address:

```ts
export async function listProfileNames(
  userIds: readonly string[],
  client?: SupabaseClient<Database>,
): Promise<Map<string, string>> {
  const unique = Array.from(new Set(userIds));
  if (unique.length === 0) return new Map();
  const supabase = client ?? createPlannerSupabaseClient();
  const rows = await throwIfError(supabase.from("profiles").select("id, full_name, email").in("id", unique));
  return new Map(
    (rows ?? []).map((row: Record<string, unknown>) => [
      String(row.id),
      String(row.full_name || row.email || ""),
    ]),
  );
}
```

Run `npm run typecheck` — expected clean (the field is optional, so existing fixtures compile).

- [ ] **Step 2: Write the failing option-builder test**

Create `src/domain/sop/roster-options.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { NO_ELIGIBLE_APPROVERS_VALUE, buildApproverOptions, type RosterOptionMember } from "./roster-options";

const NOW = new Date("2026-09-10T12:00:00Z");
const member = (over: Partial<RosterOptionMember>): RosterOptionMember => ({
  userId: "u",
  name: "Name",
  positionTitle: "Title",
  deptRole: "reviewer",
  pendingInviteAt: null,
  ...over,
});

describe("buildApproverOptions", () => {
  it("lists only reviewers and approvers, with position as the description", () => {
    const options = buildApproverOptions({
      members: [member({ userId: "a", name: "Author", deptRole: "author" }), member({ userId: "r", name: "Rev" }), member({ userId: "p", name: "App", deptRole: "approver" })],
      signerId: null,
      placeholder: "Choose an approver…",
      now: NOW,
    });
    expect(options.map((option) => option.value)).toEqual(["", "r", "p"]);
    expect(options[1]).toEqual({ value: "r", label: "Rev", description: "Title" });
  });

  it("tags a pending member and keeps them selectable; tags an expired one the same way", () => {
    const options = buildApproverOptions({
      members: [member({ userId: "p1", pendingInviteAt: "2026-09-01T00:00:00Z" }), member({ userId: "p2", pendingInviteAt: "2026-07-01T00:00:00Z" })],
      signerId: null,
      placeholder: "Choose an approver…",
      now: NOW,
    });
    expect(options[1]).toEqual({ value: "p1", label: "Name", description: "Invited · not yet joined" });
    expect(options[2]).toEqual({ value: "p2", label: "Name", description: "Invite expired · resend" });
    expect(options.every((option) => !option.disabled)).toBe(true);
  });

  it("shows a signer who is no longer in the department as a disabled placeholder", () => {
    const options = buildApproverOptions({ members: [member({ userId: "r" })], signerId: "gone", placeholder: "Choose an approver…", now: NOW });
    expect(options[1]).toEqual({
      value: "gone",
      label: "No longer in department",
      description: "Choose another approver, or resend their invitation",
      disabled: true,
    });
  });

  it("keeps the existing ineligible-signer and empty-department rows", () => {
    const ineligible = buildApproverOptions({ members: [member({ userId: "a", deptRole: "author" })], signerId: "a", placeholder: "x", now: NOW });
    expect(ineligible[1]).toMatchObject({ value: "a", disabled: true, description: "Create access only — choose someone with Review or Approve access" });
    const empty = buildApproverOptions({ members: [], signerId: null, placeholder: "x", now: NOW });
    expect(empty[1]).toEqual({ value: NO_ELIGIBLE_APPROVERS_VALUE, label: "No reviewers or approvers assigned", disabled: true });
  });
});
```

Run `npx vitest run src/domain/sop/roster-options.test.ts` — expected FAIL (module not found).

- [ ] **Step 3: Write the option builder**

Create `src/domain/sop/roster-options.ts`:

```ts
/**
 * The approver dropdown's rows, derived from a department's members. Pure so the roster editor's
 * seven option cases (placeholder, ineligible current signer, absent signer, pending/expired
 * invitees, eligible members, empty department) are testable without the DOM.
 */

import { canSignReview, type DeptRole } from "@/domain/departments";
import { pendingInviteLabel, pendingInviteState } from "@/domain/workspace/reviewer-nomination";

export interface RosterOptionMember {
  userId: string;
  name: string;
  positionTitle: string;
  deptRole: DeptRole;
  pendingInviteAt?: string | null;
}

export interface RosterOption {
  value: string;
  label: string;
  description?: string;
  disabled?: boolean;
}

export const NO_ELIGIBLE_APPROVERS_VALUE = "__no-eligible-approvers__";

export function buildApproverOptions(input: {
  members: readonly RosterOptionMember[];
  signerId: string | null;
  placeholder: string;
  now: Date;
}): RosterOption[] {
  const eligible = input.members.filter((member) => canSignReview(member.deptRole));
  const ineligibleCurrentSigner = input.members.find(
    (member) => member.userId === input.signerId && !canSignReview(member.deptRole),
  );
  const absentSignerId =
    input.signerId && !input.members.some((member) => member.userId === input.signerId) ? input.signerId : null;

  return [
    { value: "", label: input.placeholder },
    ...(ineligibleCurrentSigner
      ? [{
          value: ineligibleCurrentSigner.userId,
          label: ineligibleCurrentSigner.name,
          description: "Create access only — choose someone with Review or Approve access",
          disabled: true,
        }]
      : []),
    ...(absentSignerId
      ? [{
          value: absentSignerId,
          label: "No longer in department",
          description: "Choose another approver, or resend their invitation",
          disabled: true,
        }]
      : []),
    ...eligible.map((member) => {
      const state = pendingInviteState(member.pendingInviteAt, input.now);
      return {
        value: member.userId,
        label: member.name,
        description: state === "none" ? member.positionTitle || "Position not assigned" : pendingInviteLabel(state),
      };
    }),
    ...(eligible.length === 0 && !ineligibleCurrentSigner
      ? [{ value: NO_ELIGIBLE_APPROVERS_VALUE, label: "No reviewers or approvers assigned", disabled: true }]
      : []),
  ];
}
```

Run `npx vitest run src/domain/sop/roster-options.test.ts` — expected PASS.

- [ ] **Step 4: Write the failing invite-form test**

Create `src/components/sop/reviewer-invite-form.test.tsx`:

```tsx
// @vitest-environment jsdom

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ReviewerInviteForm } from "./reviewer-invite-form";

afterEach(() => {
  vi.unstubAllGlobals();
});

function jsonResponse(status: number, body: unknown) {
  return Promise.resolve(new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } }));
}

describe("ReviewerInviteForm", () => {
  it("posts the nomination and reports the outcome", async () => {
    const fetchMock = vi.fn(() => jsonResponse(200, { mode: "invite", userId: "u-6", emailSent: true, seated: true }));
    vi.stubGlobal("fetch", fetchMock);
    const onNominated = vi.fn();

    render(<ReviewerInviteForm sopId="sop-1" departmentId="dept-prd" departmentCode="PRO" onNominated={onNominated} onCancel={() => {}} />);

    fireEvent.change(screen.getByRole("textbox", { name: "Reviewer email" }), { target: { value: "new@anacorp.com" } });
    fireEvent.click(screen.getByRole("button", { name: "Send invite" }));

    await waitFor(() => expect(onNominated).toHaveBeenCalledTimes(1));
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/sops/reviewers/nominate",
      expect.objectContaining({ method: "POST" }),
    );
    const sent = JSON.parse((fetchMock.mock.calls[0][1] as RequestInit).body as string) as Record<string, string>;
    expect(sent).toMatchObject({ sopId: "sop-1", departmentId: "dept-prd", email: "new@anacorp.com" });
    expect(sent.positionTitle).not.toBe("");
    expect(onNominated).toHaveBeenCalledWith({ mode: "invite", userId: "u-6", emailSent: true, seated: true }, "new@anacorp.com");
    expect(screen.getByText(/Invitation sent to new@anacorp.com/)).toBeTruthy();
  });

  it("shows the server's refusal inline and keeps the typed address", async () => {
    vi.stubGlobal("fetch", vi.fn(() => jsonResponse(400, { error: "Quality approvers are managed by an admin." })));
    render(<ReviewerInviteForm sopId="sop-1" departmentId="dept-qas" departmentCode="QAS" onNominated={() => {}} onCancel={() => {}} />);

    fireEvent.change(screen.getByRole("textbox", { name: "Reviewer email" }), { target: { value: "x@anacorp.com" } });
    fireEvent.click(screen.getByRole("button", { name: "Send invite" }));

    expect(await screen.findByText("Quality approvers are managed by an admin.")).toBeTruthy();
    expect(screen.getByRole("textbox", { name: "Reviewer email" })).toHaveValue("x@anacorp.com");
  });

  it("cancels", () => {
    const onCancel = vi.fn();
    render(<ReviewerInviteForm sopId="sop-1" departmentId="dept-prd" departmentCode="PRO" onNominated={() => {}} onCancel={onCancel} />);
    fireEvent.click(screen.getByRole("button", { name: "Cancel invite" }));
    expect(onCancel).toHaveBeenCalled();
  });
});
```

Run `npx vitest run src/components/sop/reviewer-invite-form.test.tsx` — expected FAIL (module not found).

- [ ] **Step 5: Write the invite form**

Create `src/components/sop/reviewer-invite-form.tsx`:

```tsx
"use client";

import { Loader2, MailPlus, X } from "lucide-react";
import { useState, type FormEvent } from "react";
import { ThemedSelect } from "@/components/themed-select";
import { standardPositionTitlesForDepartment } from "@/domain/departments";
import { nominationOutcomeMessage, type NominationResponse } from "@/domain/workspace/reviewer-nomination";

interface ReviewerInviteFormProps {
  sopId: string;
  departmentId: string;
  departmentCode: string;
  /** Called after a successful nomination, before the message is shown. */
  onNominated: (result: NominationResponse, email: string) => Promise<void> | void;
  onCancel: () => void;
}

export async function submitNomination(input: {
  sopId: string;
  departmentId: string;
  email: string;
  positionTitle: string;
}): Promise<NominationResponse> {
  const response = await fetch("/api/sops/reviewers/nominate", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  const payload = (await response.json().catch(() => ({}))) as Partial<NominationResponse> & { error?: string };
  if (!response.ok) throw new Error(payload.error || "The invitation could not be sent.");
  return payload as NominationResponse;
}

/**
 * Inline "Invite a reviewer" row for the SOP roster: email + position title, posted to the
 * nomination route. The database decides whether the caller may nominate; this form only
 * relays its answer. Authors reach it only for departments they belong to (the roster editor
 * hides the action elsewhere).
 */
export function ReviewerInviteForm({ sopId, departmentId, departmentCode, onNominated, onCancel }: ReviewerInviteFormProps) {
  const titles = standardPositionTitlesForDepartment(departmentCode);
  const [email, setEmail] = useState("");
  const [positionTitle, setPositionTitle] = useState(titles[0] ?? "Team Member");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setError("");
    setMessage("");
    const normalizedEmail = email.trim().toLowerCase();
    try {
      const result = await submitNomination({ sopId, departmentId, email: normalizedEmail, positionTitle });
      await onNominated(result, normalizedEmail);
      setMessage(nominationOutcomeMessage(result, normalizedEmail));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "The invitation could not be sent.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} aria-label="Invite a reviewer" className="flex flex-wrap items-center gap-2">
      <input
        type="email"
        required
        aria-label="Reviewer email"
        placeholder="name@anacorp.com"
        value={email}
        onChange={(event) => setEmail(event.target.value)}
        disabled={busy}
        className="ui-input h-8 min-w-[220px] flex-1"
      />
      <ThemedSelect
        variant="sop"
        className="min-w-[200px]"
        triggerClassName="ui-sop-select-inline"
        ariaLabel="Position title"
        value={positionTitle}
        disabled={busy}
        allowCustomValue
        options={titles.map((title) => ({ value: title, label: title }))}
        onChange={setPositionTitle}
      />
      <button type="submit" className="ui-btn-primary h-8 gap-1.5 px-3 disabled:opacity-40" disabled={busy || !email.trim()}>
        {busy ? <Loader2 size={14} className="animate-spin" /> : <MailPlus size={14} />}
        Send invite
      </button>
      <button type="button" className="ui-btn-ghost h-8 gap-1 px-2" aria-label="Cancel invite" onClick={onCancel} disabled={busy}>
        <X size={14} />
        Cancel
      </button>
      {error ? <p className="w-full text-[11px] leading-4 text-danger">{error}</p> : null}
      {message ? <p className="w-full text-[11px] leading-4 text-ink-secondary">{message}</p> : null}
    </form>
  );
}
```

Run `npx vitest run src/components/sop/reviewer-invite-form.test.tsx` — expected PASS. (If the `ui-input` class does not render as a bordered field in the browser, keep the class list but add `border border-line bg-surface px-2 text-[13px]`; it exists in `app/globals.css` at three cascade points, so verify in the live drive.)

- [ ] **Step 6: Extend the roster editor test (RED)**

In `src/components/sop/sop-roster-editor.test.tsx`, widen the departments import to `import type { Department, DeptRole } from "@/domain/departments";`, then append inside the `describe("SopRosterEditor")` block:

```tsx
  it("tags an invited-but-not-joined member and keeps them selectable", async () => {
    vi.mocked(listMembersForDepartments).mockResolvedValue([
      { departmentId: "dept-mfg", userId: "pending-member", deptRole: "reviewer", positionTitle: "Line Lead", pendingInviteAt: new Date().toISOString() },
    ]);
    vi.mocked(listProfileNames).mockResolvedValue(new Map([["pending-member", "pending@anacorp.com"]]));

    render(<SopRosterEditor sopId="sop-1" departments={departments} seats={[{ ...manufacturingSeat, signerId: null }]} onChanged={() => {}} />);

    await waitFor(() => expect(listMembersForDepartments).toHaveBeenCalledWith(["dept-mfg"]));
    fireEvent.click(screen.getByRole("button", { name: "Required approver for MFG" }));
    const option = screen.getByRole("option", { name: /pending@anacorp.com/ });
    expect(option).toHaveTextContent("Invited · not yet joined");
    expect(option).not.toBeDisabled();
  });

  it("offers 'Invite a reviewer' only for a seat in a department the caller belongs to, never for Quality", async () => {
    render(
      <SopRosterEditor
        sopId="sop-1"
        departments={departments}
        seats={[manufacturingSeat, qualitySeat]}
        myDeptRoles={new Map<string, DeptRole>([["dept-mfg", "author"], ["dept-quality", "approver"]])}
        onChanged={() => {}}
      />,
    );

    await waitFor(() => expect(listMembersForDepartments).toHaveBeenCalled());
    expect(screen.getByRole("button", { name: "Invite a reviewer for MFG" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Invite a reviewer for QAS" })).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Invite a reviewer for MFG" }));
    expect(screen.getByRole("form", { name: "Invite a reviewer" })).toBeTruthy();
  });

  it("hides 'Invite a reviewer' for a department the caller is not in", async () => {
    render(<SopRosterEditor sopId="sop-1" departments={departments} seats={[manufacturingSeat]} myDeptRoles={new Map()} onChanged={() => {}} />);
    await waitFor(() => expect(listMembersForDepartments).toHaveBeenCalled());
    expect(screen.queryByRole("button", { name: "Invite a reviewer for MFG" })).toBeNull();
  });

  it("shows a signer who left the department as a disabled placeholder", async () => {
    vi.mocked(listMembersForDepartments).mockResolvedValue([]);
    render(<SopRosterEditor sopId="sop-1" departments={departments} seats={[manufacturingSeat]} onChanged={() => {}} />);
    await waitFor(() => expect(listMembersForDepartments).toHaveBeenCalled());
    fireEvent.click(screen.getByRole("button", { name: "Required approver for MFG" }));
    expect(screen.getByRole("option", { name: /No longer in department/ })).toBeDisabled();
  });
```

Run `npx vitest run src/components/sop/sop-roster-editor.test.tsx` — expected: the four new cases FAIL (no tag text, no invite button, no placeholder).

- [ ] **Step 7: Modify the roster editor**

In `src/components/sop/sop-roster-editor.tsx`:

1. Imports — replace the `canSignReview` import and add the new modules:

```tsx
import { canSignReview, type Department, type DeptRole } from "@/domain/departments";
import { buildApproverOptions } from "@/domain/sop/roster-options";
import type { NominationResponse } from "@/domain/workspace/reviewer-nomination";
import { ReviewerInviteForm } from "./reviewer-invite-form";
```

2. `RosterMember` gains the marker, and the props gain `myDeptRoles`:

```tsx
interface RosterMember {
  userId: string;
  name: string;
  positionTitle: string;
  deptRole: DeptRole;
  pendingInviteAt: string | null;
}

interface RosterEditorProps {
  sopId: string;
  departments: Department[];
  seats: SopReviewSeat[];
  /**
   * The caller's department roles. A seat whose department appears here (and is not the Quality
   * gate) offers "Invite a reviewer" — the database re-checks membership on submit.
   */
  myDeptRoles?: ReadonlyMap<string, DeptRole>;
  convertedApprovals?: readonly SopApproval[];
  onMapApproval?: (approvalIndex: number, departmentCode: string) => Promise<void>;
  onChanged: () => Promise<void> | void;
}
```

Add `myDeptRoles` to the destructured props.

3. In `loadMembersForDepartmentIds`, carry the marker through the map:

```tsx
              .map((row) => ({
                userId: row.userId,
                name: names.get(row.userId) || "Unnamed member",
                positionTitle: row.positionTitle,
                deptRole: row.deptRole,
                pendingInviteAt: row.pendingInviteAt ?? null,
              })),
```

4. Add state for the open invite form (next to `adding`):

```tsx
  const [invitingFor, setInvitingFor] = useState<string | null>(null);
```

and a helper below `guarded`:

```tsx
  function canNominateInto(departmentId: string): boolean {
    const department = departments.find((item) => item.id === departmentId);
    return Boolean(department && !department.isQualityGate && myDeptRoles?.has(departmentId));
  }

  /** After a nomination: reload the roster and, when the nominee is selectable, seat them. */
  async function handleNominated(seat: SopReviewSeat | null, departmentId: string, result: NominationResponse) {
    await loadMembersForDepartmentIds([departmentId]);
    if (!result.seated || !result.userId) return;
    if (seat) {
      await guarded(`approver-${departmentId}`, () => upsertSeat({ ...seat, rasic: "responsible", signerId: result.userId }));
    } else {
      setDraft((prev) => ({ ...prev, departmentId, signerId: result.userId ?? "" }));
    }
  }
```

5. Replace the hand-built `approverOptions` block inside `workflowSeats.map` (the `const options … const approverOptions = [ … ]` section) with:

```tsx
              const approverOptions = buildApproverOptions({
                members: members.get(seat.departmentId) ?? [],
                signerId: seat.signerId,
                placeholder: "Choose an approver…",
                now: new Date(),
              });
              const nominatable = canNominateInto(seat.departmentId);
```

6. In that row's approver `<td>`, after the `ThemedSelect` and before the Quality note, add the action; and after the row's closing `</tr>` render the form row. The `return (` inside the map becomes a fragment:

```tsx
              return (
                <Fragment key={seat.departmentId}>
                <tr className="group border-b border-line/70 transition-colors hover:bg-surface-hover">
                  {/* …existing department cell unchanged… */}
                  <td className="px-5 py-2.5 align-middle">
                    <ThemedSelect /* …unchanged props… */ />
                    {nominatable ? (
                      <button
                        type="button"
                        className="ui-btn-ghost mt-1.5 h-7 gap-1 px-1.5 text-[11px]"
                        aria-label={`Invite a reviewer for ${department?.code ?? "department"}`}
                        aria-expanded={invitingFor === seat.departmentId}
                        disabled={busy !== null}
                        onClick={() => setInvitingFor((current) => (current === seat.departmentId ? null : seat.departmentId))}
                      >
                        <MailPlus size={12} />
                        Invite a reviewer
                      </button>
                    ) : null}
                    {isQualityReviewSeat ? ( /* …unchanged… */ ) : null}
                  </td>
                  {/* …existing actions cell unchanged… */}
                </tr>
                {invitingFor === seat.departmentId ? (
                  <tr className="border-b border-line/70 bg-canvas/55">
                    <td colSpan={3} className="px-5 py-2.5">
                      <ReviewerInviteForm
                        sopId={sopId}
                        departmentId={seat.departmentId}
                        departmentCode={department?.code ?? ""}
                        onNominated={(result) => handleNominated(seat, seat.departmentId, result)}
                        onCancel={() => setInvitingFor(null)}
                      />
                    </td>
                  </tr>
                ) : null}
                </Fragment>
              );
```

Add `Fragment` to the React import and `MailPlus` to the lucide import.

7. In the "add approver" row, replace its hand-built options with the builder and add the same action beneath the select:

```tsx
                  <ThemedSelect
                    variant="sop"
                    ariaLabel="Required departmental approver"
                    value={draft.signerId}
                    disabled={busy !== null || !draft.departmentId}
                    options={buildApproverOptions({
                      members: members.get(draft.departmentId) ?? [],
                      signerId: null,
                      placeholder: "Select approver…",
                      now: new Date(),
                    })}
                    onChange={(signerId) => setDraft((prev) => ({ ...prev, signerId }))}
                  />
                  {draft.departmentId && canNominateInto(draft.departmentId) ? (
                    <button
                      type="button"
                      className="ui-btn-ghost mt-1.5 h-7 gap-1 px-1.5 text-[11px]"
                      aria-label={`Invite a reviewer for ${departments.find((item) => item.id === draft.departmentId)?.code ?? "department"}`}
                      aria-expanded={invitingFor === `add:${draft.departmentId}`}
                      disabled={busy !== null}
                      onClick={() => setInvitingFor((current) => (current === `add:${draft.departmentId}` ? null : `add:${draft.departmentId}`))}
                    >
                      <MailPlus size={12} />
                      Invite a reviewer
                    </button>
                  ) : null}
```

and after the add row's `</tr>`:

```tsx
            {adding && draft.departmentId && invitingFor === `add:${draft.departmentId}` ? (
              <tr className="border-b border-line/70 bg-canvas/55">
                <td colSpan={3} className="px-5 py-2.5">
                  <ReviewerInviteForm
                    sopId={sopId}
                    departmentId={draft.departmentId}
                    departmentCode={departments.find((item) => item.id === draft.departmentId)?.code ?? ""}
                    onNominated={(result) => handleNominated(null, draft.departmentId, result)}
                    onCancel={() => setInvitingFor(null)}
                  />
                </td>
              </tr>
            ) : null}
```

Note the builder already yields the "No reviewers or approvers assigned" row when the department is empty, so the add row's old inline `__no-eligible-approvers__` branch is deleted along with the old option code. `canSignReview` is no longer used in this file except inside `changeSeatDepartment`; keep that import.

- [ ] **Step 8: Wire the editor**

In `src/components/sop/sop-editor.tsx`:

1. Line 20 — widen the import:
```tsx
import type { Department, DeptRole } from "@/domain/departments";
```
2. After the `isCurrentUserQualityApprover` state (ends ~line 380), add:
```tsx
  const [approvalMyDeptRoles, setApprovalMyDeptRoles] = useState<Map<string, DeptRole>>(
    () => new Map(initialApprovalRouting?.departmentRoles ?? []),
  );
```
3. In `refreshApprovalRouting`, right after `setApprovalReviewerNames(reviewerNames);`, add:
```tsx
      setApprovalMyDeptRoles(departmentRoles);
```
4. In the `<SopRosterEditor …>` element (~line 2014), add the prop:
```tsx
                    myDeptRoles={approvalMyDeptRoles}
```

- [ ] **Step 9: Run tests, typecheck, lint**

```bash
npx vitest run src/components/sop src/domain/sop/roster-options.test.ts && npm run typecheck && npm run lint
```
Expected: PASS; no type errors; lint clean. One existing expectation can shift: a seat whose signer is not in the (empty) member list now also renders the disabled "No longer in department" row ahead of "No reviewers or approvers assigned" — if an existing case asserts that exact option list, update its expectation.

- [ ] **Step 10: Commit**

```bash
git add src/domain/departments.ts src/lib/departments/store.ts src/lib/sop/review.ts src/domain/sop/roster-options.ts src/domain/sop/roster-options.test.ts src/components/sop/reviewer-invite-form.tsx src/components/sop/reviewer-invite-form.test.tsx src/components/sop/sop-roster-editor.tsx src/components/sop/sop-roster-editor.test.tsx src/components/sop/sop-editor.tsx
git commit -m "feat(sop): invite a reviewer from the roster; pending invitees are selectable

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 7: Notifications — exclude pending signers, nudge the author instead

**Files:**
- Modify: `src/domain/sop/notifications.ts:32-43,75-80,199-210,273-283,400-415`
- Modify: `src/domain/sop/notification-templates.ts` (new `case`)
- Modify: `src/domain/notifications/channels.ts` (catalog entry)
- Modify: `src/lib/sop/notifications-store.ts:196-232,480-515`
- Create: `supabase/migrations/20260910122000_reviewer_not_joined_kind.sql`
- Modify: `supabase/tests/reviewer_nomination_test.sql` (`plan(24)` → `plan(25)`, one `lives_ok`)
- Modify: `docs/runbooks/notifications.md` (kind list)
- Test: `src/domain/sop/notifications.test.ts`, `src/domain/sop/notification-templates.test.ts`

**Interfaces:**
- Produces: `SeatSnapshot.signerPending?: boolean`; kind `"reviewer_not_joined"` (recipient: the author; template needs `departmentName` of the pending seat).

- [ ] **Step 1: Write the failing domain tests**

Append to `src/domain/sop/notifications.test.ts` at top level, after the existing describes. It reuses the file's top-level `sop`, `ctx`, `event`, and `ids` helpers and carries its own `state` builder:

```ts
describe("pending (invited, not yet joined) signers", () => {
  const pendingSeat = { departmentId: "d-r", departmentName: "Engineering", rasic: "responsible" as const, signerId: "resp", signerPending: true };
  const state = (over: Partial<SopReminderState> = {}): SopReminderState => ({
    sop: sop(),
    seats: [pendingSeat],
    qualityApprovers: [],
    reviewReturns: [],
    openAnnotationCount: 0,
    recalledAt: null,
    currentDeptApprovals: [],
    approvedAt: null,
    reviewSentAt: "2026-07-21T12:00:00Z",
    reminders: [],
    workspaceManagers: [],
    ...over,
  });

  it("review_sent skips a pending signer's first touch", () => {
    const c = ctx({ seats: [pendingSeat, { departmentId: "d-a", departmentName: "Ops", rasic: "accountable", signerId: "acct" }] });
    expect(ids(resolveEventRecipients(event(), c))).toEqual(["acct"]);
  });

  it("seat_reassigned to a pending signer sends nothing yet", () => {
    const c = ctx({ seats: [pendingSeat] });
    const reassigned = event({ eventType: "seat_reassigned", actorId: "admin", details: { department_id: "d-r", to_signer_id: "resp" } });
    expect(resolveEventRecipients(reassigned, c)).toEqual([]);
  });

  it("nudges the AUTHOR with reviewer_not_joined instead of the pending signer, once per author", () => {
    const later = new Date("2026-07-25T12:00:00Z");
    const s = state({
      seats: [pendingSeat, { ...pendingSeat, departmentId: "d-b", departmentName: "Maintenance", signerId: "resp2" }],
      reviewSentAt: "2026-07-21T12:00:00Z",
    });
    const out = resolveReminders(later, [s]);
    expect(out).toEqual([
      { recipientId: "author", kind: "reviewer_not_joined", sopId: "sop-1", eventId: null, reminderIndex: 1, reviewCycle: 1 },
    ]);
  });

  it("resumes the normal review_requested nudge once the signer has joined", () => {
    const later = new Date("2026-07-25T12:00:00Z");
    const s = state({ seats: [{ ...pendingSeat, signerPending: false }], reviewSentAt: "2026-07-21T12:00:00Z" });
    expect(resolveReminders(later, [s]).map((n) => [n.recipientId, n.kind])).toEqual([["resp", "review_requested"]]);
  });

  it("sends no author nudge when the SOP has no author on record", () => {
    const later = new Date("2026-07-25T12:00:00Z");
    const s = state({ sop: sop({ authorId: null }), seats: [pendingSeat], reviewSentAt: "2026-07-21T12:00:00Z" });
    expect(resolveReminders(later, [s])).toEqual([]);
  });
});
```

And append to `src/domain/sop/notification-templates.test.ts` (match the file's existing input builder; if it has none, build the input inline as below):

```ts
it("reviewer_not_joined tells the author which seat is waiting and how to unblock it", () => {
  const email = renderSopNotificationEmail({
    kind: "reviewer_not_joined",
    sopNumber: "PRO-SOP-004",
    title: "Line Clearance",
    version: "B",
    actorName: "System",
    departmentName: "Engineering",
    origin: "https://pulse.example.com",
    sopId: "sop-1",
    reminderIndex: 1,
    waitingDays: 4,
  });
  expect(email.subject).toMatch(/^Reminder: Your reviewer hasn't joined yet: /);
  expect(email.subject).toContain("PRO-SOP-004");
  expect(email.text).toContain("the Engineering seat");
  expect(email.text).toContain("has not accepted their Pulse invitation yet");
  expect(email.text).toContain("Resend the invitation");
});
```

- [ ] **Step 2: Run the domain tests to verify they fail**

```bash
npx vitest run src/domain/sop/notifications.test.ts src/domain/sop/notification-templates.test.ts
```
Expected: the new cases FAIL (type error on `signerPending` / unknown kind / missing case).

- [ ] **Step 3: Domain changes**

In `src/domain/sop/notifications.ts`:

1. Kind union — add `| "reviewer_not_joined"` after `"remark_added"`.
2. `SeatSnapshot`:
```ts
export interface SeatSnapshot {
  departmentId: string;
  departmentName: string;
  rasic: SopSeatRasic;
  signerId: string | null;
  /** The signer holds a provisional (invited, not yet joined) membership — they cannot act yet. */
  signerPending?: boolean;
}
```
3. `seatRecipients` — exclude pending:
```ts
      .filter((seat) => includeSeat(seat.rasic) && seat.signerId && !seat.signerPending && seat.signerId !== event.actorId)
```
4. `case "seat_reassigned"` — after `const stillTheirs = …`, replace the `if (!stillTheirs) return [];` with:
```ts
      const target = ctx.seats.find((seat) => seat.departmentId === departmentId && seat.signerId === toSignerId);
      if (!target || target.signerPending) return [];
```
(and delete the now-unused `stillTheirs` line).
5. `signerCandidates` — the draft-review loop becomes:
```ts
    for (const seat of state.seats) {
      if (!isBlocking(seat.rasic) || !seat.signerId || returned.has(seat.signerId)) continue;
      if (seat.signerPending) {
        // The invitee cannot act; the author owns the unblock (resend, or ask an admin to reassign).
        if (sop.authorId) {
          candidates.push({ recipientId: sop.authorId, kind: "reviewer_not_joined", anchorAt: state.reviewSentAt, departmentId: seat.departmentId });
        }
        continue;
      }
      candidates.push({
        recipientId: seat.signerId,
        kind: "review_requested",
        anchorAt: state.reviewSentAt,
        departmentId: seat.departmentId,
      });
    }
```
(Two pending seats collapse to one author nudge through the existing `${recipientId}:${kind}` dedupe in `remindersForSop`.)

In `src/domain/sop/notification-templates.ts`, add a case to `copyFor` (next to `stall_escalated`):

```ts
    case "reviewer_not_joined":
      return {
        subject: `Your reviewer hasn't joined yet: ${label}`,
        eyebrow: "Reviewer not joined",
        accent: "#b45309",
        reason: AUTHOR_REASON,
        happened: `${label} is waiting on ${input.departmentName ? `the ${input.departmentName} seat` : "a review seat"}, but the reviewer you invited has not accepted their Pulse invitation yet.`,
        needed: `Resend the invitation from the SOP's approval roster, or ask an admin to reassign the seat.`,
      };
```

In `src/domain/notifications/channels.ts`, after `stall_escalated`:
```ts
  reviewer_not_joined: { label: "Your invited reviewer hasn't joined", group: "sop", defaultEmail: true },
```

Run the two test files again — expected PASS.

- [ ] **Step 4: Store changes**

In `src/lib/sop/notifications-store.ts`, inside `loadContext`, after the `for (const seat of seatsResult.data ?? [])` loop is replaced as follows. First, before the loop, load the pending flags:

```ts
    const seatDepartmentIds = Array.from(new Set((seatsResult.data ?? []).map((seat) => seat.department_id)));
    const { data: pendingRows, error: pendingError } = seatDepartmentIds.length
      ? await admin
          .from("department_members")
          .select("department_id, user_id")
          .in("department_id", seatDepartmentIds)
          .not("pending_invite_at", "is", null)
      : { data: [], error: null };
    if (pendingError) throw new Error(pendingError.message);
    const pendingSigners = new Set((pendingRows ?? []).map((row) => `${row.department_id}:${row.user_id}`));
```

then the loop body's snapshot gains:

```ts
          signerId: seat.signer_id,
          signerPending: seat.signer_id ? pendingSigners.has(`${seat.department_id}:${seat.signer_id}`) : false,
```

In `toItem`, the template's department for the author nudge is the pending seat, not the recipient's seat, and escalations name the situation:

```ts
    const recipientSeat = seats.find((seat) => seat.signerId === pending.recipientId);
    const pendingSeat = pending.kind === "reviewer_not_joined" ? seats.find((seat) => seat.signerPending) : undefined;
    // …
    const stalledForTemplate: SopEmailInput["stalled"] = stalled?.map((entry) => ({
      name: `${bundle.nameByUser.get(entry.userId) ?? "A participant"}${entry.kind === "reviewer_not_joined" ? " (their invited reviewer has not joined)" : ""}`,
      departmentName: entry.departmentId ? (bundle.departmentNameById.get(entry.departmentId) ?? null) : null,
      waitingDays: entry.waitingDays,
    }));
    // …
        departmentName: (pendingSeat ?? recipientSeat)?.departmentName ?? null,
```

- [ ] **Step 5: Ledger CHECK migration + pgTAP**

Create `supabase/migrations/20260910122000_reviewer_not_joined_kind.sql`:

```sql
-- Author-nominated reviewers, 3/3: the ledger admits the author-side stall kind.
alter table public.sop_notifications drop constraint if exists sop_notifications_kind_check;
alter table public.sop_notifications add constraint sop_notifications_kind_check check (kind in (
  'review_requested',
  'final_approval_requested',
  'quality_release_requested',
  'sent_back',
  'review_complete',
  'released',
  'seat_assigned',
  'objection_raised',
  'objection_resolved',
  'remark_added',
  'stall_escalated',
  'reviewer_not_joined'
));
```

In `supabase/tests/reviewer_nomination_test.sql`, set `select plan(25);` and add before `finish()`:

```sql
-- ---------------------------------------------------------------------------
-- 25. The ledger admits the author-side stall kind.
-- ---------------------------------------------------------------------------
select lives_ok(
  $$ insert into public.sop_notifications (sop_id, recipient_id, kind, reminder_index, review_cycle)
     values ('sop_nom_1', 'd0000000-0000-0000-0000-000000000002', 'reviewer_not_joined', 1, 0) $$,
  'reviewer_not_joined is an accepted sop_notifications kind'
);
```

- [ ] **Step 6: Runbook**

In `docs/runbooks/notifications.md`, find the list/table that names `stall_escalated` and add two entries beside it:

- `reviewer_not_joined` — SOP, to the author, on the standard 3-day ladder, when a seated reviewer's invitation has not been accepted. Unblock: resend from the roster, or reassign the seat.
- `reviewer_nominated` — workspace, in-app only (no email), to owners/admins, when an author nominates a reviewer. Written by the nomination route, not a drain.

- [ ] **Step 7: Run everything**

```bash
npm test && npm run typecheck && npm run lint
```
Expected: all green. If Docker is up: `supabase db reset && supabase test db --local` → `reviewer_nomination_test` 25/25.

- [ ] **Step 8: Commit**

```bash
git add src/domain/sop/notifications.ts src/domain/sop/notifications.test.ts src/domain/sop/notification-templates.ts src/domain/sop/notification-templates.test.ts src/domain/notifications/channels.ts src/lib/sop/notifications-store.ts supabase/migrations/20260910122000_reviewer_not_joined_kind.sql supabase/tests/reviewer_nomination_test.sql docs/runbooks/notifications.md
git commit -m "feat(notifications): reviewer_not_joined nudges the author while an invited signer is pending

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 8: Members settings — who nominated a pending invite

**Files:**
- Modify: `src/components/workspace-members-settings.tsx:455-470` (the pending-invite row description)

**Interfaces:**
- Consumes: `WorkspaceAccessGrant.grantedBy`, the component's `members: MemberAccess[]` state and `memberLabel(member)`.

- [ ] **Step 1: Add the provenance line**

Above `return (` in the component (after `const canEditSelectedRole = …`), add:

```tsx
  const inviterLabel = (grantedBy?: string): string | null => {
    const inviter = grantedBy ? members.find((member) => member.userId === grantedBy) : undefined;
    return inviter ? memberLabel(inviter) : null;
  };
```

In the pending-grant row, change the description `<div>` to:

```tsx
                    <div className="ui-settings-group-row-desc">
                      <span>{compactInviteEntitlementSummary(entitlementsFromWorkspaceAccessGrant(grant))}</span>
                      {expires ? ` · ${expired ? "expired" : "expires"} ${expires}` : ""}
                      {inviterLabel(grant.grantedBy) ? ` · invited by ${inviterLabel(grant.grantedBy)}` : ""}
                    </div>
```

- [ ] **Step 2: Verify**

```bash
npm run typecheck && npm run lint && npx vitest run src/components/workspace-members-settings
```
Expected: clean (the existing settings tests, if any, do not assert the description text; if one does, update its expectation to include the new suffix).

- [ ] **Step 3: Commit**

```bash
git add src/components/workspace-members-settings.tsx
git commit -m "feat(members): show who invited a pending member

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 9: Verification gate and live drive

**Files:** none new. This task is the CLAUDE.md step 6: "Verify live before merging."

- [ ] **Step 1: Full local gate**

```bash
npm run typecheck && npm run lint && npm test && npm run build
```
Expected: all green. Push the branch and confirm the CI `database` job is green (pgTAP) before anything else:

```bash
git push -u origin feat/author-reviewer-invites && gh run watch --exit-status
```

- [ ] **Step 2: Apply the three migrations live (OWNER-GATED — ask before running)**

The owner applies them, in order, with the data-safe applier (it refuses destructive SQL and rolls back on any post-check failure):

```bash
node --env-file=.env.local scripts/apply-migration-safely.mjs 20260910120000_department_members_pending_invite.sql 20260910121000_reviewer_nomination.sql 20260910122000_reviewer_not_joined_kind.sql
```

Then regenerate and commit the types:

```bash
npm run gen:types && git add src/lib/database.types.ts && git commit -m "chore(types): regenerate after reviewer nomination migrations

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

Confirm the live predicate carries the clause:

```bash
npx supabase db query --linked "select position('is distinct from p_user' in pg_get_functiondef('public.is_department_member(text,uuid)'::regprocedure)) > 0 as widened"
```
Expected: `widened = true`.

- [ ] **Step 3: Live drive (in the browser, on the dev server against the live DB)**

1. As an author (a department member who is not an admin), open a draft SOP → Approvals → a seat for your own department → "Invite a reviewer". Nominate a real approved-domain address (never a plus-alias — Exchange bounces them). Expect the outcome message, the nominee appearing in the dropdown tagged "Invited · not yet joined", and the invitation in Resend's dashboard.
2. Seat the nominee. Sign authorship and **Send for review**. Expect the transition to succeed.
3. Open Settings → Organization as an admin: the pending invite shows "invited by <author>". The admins' bell shows the nomination notice.
4. Accept the invitation in a private window and sign in. Expect the SOP in **Awaiting me** immediately; in the roster the tag is gone.
5. Trigger a drain (`/api/sops/notifications/drain` per the runbook) with a second, unaccepted nomination seated on another draft that was sent for review: no email to the invitee; after 3 days the author would get `reviewer_not_joined` (verify the decision path with a temporary `REMINDER_AFTER_DAYS` override in a local test only — never in code).
6. Remove the unaccepted pending invite from Members. Expect the nominee to vanish from the dropdown, the seat row to read "No longer in department", and the seat's signer to be unchanged in the database.
7. Try to nominate into a department you are not a member of via the API (curl with your cookie) and into the Quality department: both refused with the exact messages from Task 2.

- [ ] **Step 4: Finish the branch**

Per CLAUDE.md (no PRs; CI is the reviewer): once every step above passes and CI is green, merge to `main`, push, delete the branch:

```bash
git checkout main && git merge --ff-only feat/author-reviewer-invites && git push && git branch -d feat/author-reviewer-invites && git push origin --delete feat/author-reviewer-invites
```
