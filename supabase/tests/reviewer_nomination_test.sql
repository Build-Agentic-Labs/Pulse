-- pgTAP: author-nominated reviewers.
-- Spec: docs/superpowers/specs/2026-09-10-author-reviewer-invites-design.md
--
-- Pins (Task 1):
--   * department_members.pending_invite_at exists
--   * a provisional row satisfies is_department_member when the CALLER asks about someone else
--     (Gate A, seat reassignment) and never when the provisional person is the actor
--   * a workspace member with no department row is still not a member
--   * the Quality-gate nomination refusal is tested with a member of that department (assertion 6)
--
-- Pins (final review): self-nomination is refused; a stale pending marker on a real member is
-- cleared; an admin's approver invitation survives a nomination undowngraded; minting is refused
-- for an unnamed department and for an expired grant; protect_manager_invitation still blocks an
-- author from touching an administrator's invitation; a provisional actor can neither sign nor
-- read; the resend trigger refreshes only provisional rows.

begin;
select plan(38);

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
  ('d0000000-0000-0000-0000-000000000008', 'authenticated', 'authenticated', 'nom-second@anacorp.com'),
  ('d0000000-0000-0000-0000-000000000009', 'authenticated', 'authenticated', 'nom-preapproved@anacorp.com');

-- u6 (invitee), u7 (revoked), u8 (second invitee) and u9 (already invited by an admin as an
-- approver) are NOT workspace members.
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
  ('dept_nom_qas', 'd0000000-0000-0000-0000-000000000002', 'author'),
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
-- 9. Nobody nominates themselves — that would be a self-service role lift.
-- ---------------------------------------------------------------------------
select throws_like(
  $$ select public.nominate_department_reviewer('dept_nom_prd', 'nom-author@anacorp.com', 'Engineer') $$,
  '%nominate yourself%',
  'an author cannot nominate themselves into the reviewer role'
);

-- ---------------------------------------------------------------------------
-- 10-13. Modes for people already in the workspace: added, and a stale marker is cleared.
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

-- A marker left behind by another join path would misroute this seat forever.
reset role;
update public.department_members set pending_invite_at = now()
 where department_id = 'dept_nom_prd' and user_id = 'd0000000-0000-0000-0000-000000000005';
select test_as('d0000000-0000-0000-0000-000000000002');
select is(
  (public.nominate_department_reviewer('dept_nom_prd', 'nom-member@anacorp.com', 'Production Supervisor'))->>'mode',
  'already_eligible',
  're-nominating a real reviewer is a no-op'
);
reset role;
select is(
  (select pending_invite_at from public.department_members
    where department_id = 'dept_nom_prd' and user_id = 'd0000000-0000-0000-0000-000000000005'),
  null,
  'a re-nomination clears a stale marker on a real member'
);

-- ---------------------------------------------------------------------------
-- 14-16. Modes: lifted / already_eligible.
-- ---------------------------------------------------------------------------
select test_as('d0000000-0000-0000-0000-000000000002');
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
-- 17-19. Invite mode: fixed-package grant + provisional row for an existing auth user.
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
-- 20-22. An admin's approver invitation is never downgraded by a nomination.
-- ---------------------------------------------------------------------------
select test_as('d0000000-0000-0000-0000-000000000001');
reset role;  -- postgres bypasses RLS; the claims stay so the manager-protection trigger sees an admin
insert into public.workspace_access_grants
  (workspace_id, email, role, quality_access, access_package, planning_access, project_access,
   department_access, granted_by, expires_at)
values
  ('ws_nom', 'nom-preapproved@anacorp.com', 'editor', 'edit', 'custom', false, '[]'::jsonb,
   '[{"department_id":"dept_nom_prd","role":"approver","position_title":"QA Lead"}]'::jsonb,
   'd0000000-0000-0000-0000-000000000001', now() + interval '30 days');

select test_as('d0000000-0000-0000-0000-000000000002');
select is(
  (public.nominate_department_reviewer('dept_nom_prd', 'nom-preapproved@anacorp.com', 'Line Lead'))->>'mode',
  'invite',
  'nominating someone an admin already invited still reports invite'
);
reset role;
select is(
  (select g.department_access->0->>'role' from public.workspace_access_grants g
    where g.workspace_id = 'ws_nom' and g.email = 'nom-preapproved@anacorp.com'),
  'approver',
  'an admin''s approver invitation is not downgraded'
);
select is(
  (select dept_role::text from public.department_members
    where user_id = 'd0000000-0000-0000-0000-000000000009' and department_id = 'dept_nom_prd'),
  'approver',
  'the provisional row mirrors the kept approver entry'
);

-- ---------------------------------------------------------------------------
-- 23-25. mint_pending_department_reviewer: refused without a matching grant BY THE CALLER,
-- refused for a department the grant does not name, idempotent with one.
-- ---------------------------------------------------------------------------
select test_as('d0000000-0000-0000-0000-000000000003');
select throws_like(
  $$ select public.mint_pending_department_reviewer('dept_nom_prd', 'd0000000-0000-0000-0000-000000000006') $$,
  '%No matching invitation%',
  'a peer who did not send the invitation cannot mint the provisional row'
);
reset role;
select test_as('d0000000-0000-0000-0000-000000000002');
select throws_like(
  $$ select public.mint_pending_department_reviewer('dept_nom_eng', 'd0000000-0000-0000-0000-000000000006') $$,
  '%does not name this department%',
  'the nominator cannot mint a row in a department the invitation does not name'
);
select lives_ok(
  $$ select public.mint_pending_department_reviewer('dept_nom_prd', 'd0000000-0000-0000-0000-000000000006') $$,
  'the nominator can re-mint (resend) idempotently'
);

-- ---------------------------------------------------------------------------
-- 26. RLS unchanged: an author still cannot write department_members directly.
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
-- 27. Gate A passes with a provisional signer; the guard is untouched.
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
-- 28/29. The provisional row grants the nominee nothing: they cannot sign or even read the SOP.
-- ---------------------------------------------------------------------------
select test_as('d0000000-0000-0000-0000-000000000006');
select throws_ok(
  $$ select public.sign_sop('sop_nom_1', 'dept_approval', null, 'dept_nom_prd') $$,
  null,
  null,
  'a provisional signer cannot sign before joining'
);
select is(
  (select count(*) from public.sops where id = 'sop_nom_1'),
  0::bigint,
  'a provisional signer cannot read the SOP before joining'
);
reset role;

-- ---------------------------------------------------------------------------
-- 30/31. An expired invitation mints nothing; deleting the invitation cascades the
-- provisional row (second invitee, u8).
-- ---------------------------------------------------------------------------
select test_as('d0000000-0000-0000-0000-000000000002');
select public.nominate_department_reviewer('dept_nom_prd', 'nom-second@anacorp.com', 'Technician');
reset role;
update public.workspace_access_grants set expires_at = now() - interval '1 day'
 where workspace_id = 'ws_nom' and email = 'nom-second@anacorp.com';
select test_as('d0000000-0000-0000-0000-000000000002');
select throws_like(
  $$ select public.mint_pending_department_reviewer('dept_nom_prd', 'd0000000-0000-0000-0000-000000000008') $$,
  '%No matching invitation%',
  'an expired invitation cannot mint a provisional row'
);
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
-- 32. protect_manager_invitation still stands: an author cannot touch an admin-role invitation.
-- ---------------------------------------------------------------------------
select test_as('d0000000-0000-0000-0000-000000000001');
reset role;  -- an admin writes the administrator invitation; the author must not be able to merge into it
insert into public.workspace_access_grants
  (workspace_id, email, role, quality_access, access_package, planning_access, project_access,
   department_access, granted_by, expires_at)
values
  ('ws_nom', 'nom-adminmail@anacorp.com', 'admin', 'edit', 'custom', false, '[]'::jsonb, '[]'::jsonb,
   'd0000000-0000-0000-0000-000000000001', now() + interval '30 days');
select test_as('d0000000-0000-0000-0000-000000000002');
select throws_like(
  $$ select public.nominate_department_reviewer('dept_nom_prd', 'nom-adminmail@anacorp.com', 'Engineer') $$,
  '%Only an owner%',
  'an author cannot merge a reviewer entry into an administrator invitation'
);
reset role;

-- ---------------------------------------------------------------------------
-- 33/34. The resend trigger refreshes provisional markers only.
-- ---------------------------------------------------------------------------
update public.workspace_access_grants set expires_at = now() + interval '60 days'
 where workspace_id = 'ws_nom' and email = 'nom-invitee@anacorp.com';
select is(
  (select pending_invite_at > now() - interval '10 seconds' from public.department_members
    where department_id = 'dept_nom_prd' and user_id = 'd0000000-0000-0000-0000-000000000006'),
  true,
  'an admin resend refreshes the pending marker'
);
insert into public.workspace_access_grants
  (workspace_id, email, role, quality_access, access_package, planning_access, project_access,
   department_access, granted_by, expires_at)
values
  ('ws_nom', 'nom-member@anacorp.com', 'editor', 'edit', 'custom', false, '[]'::jsonb, '[]'::jsonb,
   'd0000000-0000-0000-0000-000000000001', now() + interval '30 days');
update public.workspace_access_grants set expires_at = now() + interval '60 days'
 where workspace_id = 'ws_nom' and email = 'nom-member@anacorp.com';
select is(
  (select pending_invite_at from public.department_members
    where department_id = 'dept_nom_prd' and user_id = 'd0000000-0000-0000-0000-000000000005'),
  null,
  'a resend never marks a real member pending'
);

-- ---------------------------------------------------------------------------
-- 35-37. Acceptance: redeem clears the marker, keeps the seat, and mints the workspace membership.
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

-- ---------------------------------------------------------------------------
-- 38. The ledger admits the author-side stall kind.
-- ---------------------------------------------------------------------------
select lives_ok(
  $$ insert into public.sop_notifications (sop_id, recipient_id, kind, reminder_index, review_cycle)
     values ('sop_nom_1', 'd0000000-0000-0000-0000-000000000002', 'reviewer_not_joined', 1, 0) $$,
  'reviewer_not_joined is an accepted sop_notifications kind'
);

select * from finish();
rollback;
