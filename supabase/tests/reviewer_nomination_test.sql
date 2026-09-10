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
