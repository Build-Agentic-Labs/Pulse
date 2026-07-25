-- pgTAP: D1 regression — department-scoped SOP visibility must actually scope.
--
-- The old policy grandfathered "memberless" departments with an inline subquery on
-- department_members, which is filtered by that table's OWN RLS: to any non-member every
-- department looked memberless, so every org-tool viewer could read every draft. The fix
-- routes the predicate through security definer helpers (department_has_members,
-- holds_sop_seat, can_read_sop). This file pins:
--   * a workspace member with org-tool 'view' and NO department cannot read another
--     department's draft SOP
--   * a seat holder from another department CAN read it
--   * an owning-department member still reads it
--   * a genuinely memberless department stays grandfathered (open to org-tool viewers)

begin;
select plan(6);

-- ---------------------------------------------------------------------------
-- Fixtures (owner context: RLS bypassed)
-- ---------------------------------------------------------------------------
-- enforce_signup_domain() rejects emails whose domain is absent from
-- workspace_auto_join_domains, which is empty on a fresh db reset. Seed it before
-- any auth.users insert, and create the workspace it points at first.
insert into public.workspaces (id, name) values ('ws_rls', 'RLS Org');
insert into public.workspace_auto_join_domains (domain, workspace_id) values ('test.dev', 'ws_rls');

insert into auth.users (id, aud, role, email)
values
  ('b0000000-0000-0000-0000-000000000001', 'authenticated', 'authenticated', 'rls-member@test.dev'),
  ('b0000000-0000-0000-0000-000000000002', 'authenticated', 'authenticated', 'rls-viewer@test.dev'),
  ('b0000000-0000-0000-0000-000000000003', 'authenticated', 'authenticated', 'rls-seat@test.dev');


insert into public.workspace_members (workspace_id, user_id, role) values
  ('ws_rls', 'b0000000-0000-0000-0000-000000000001', 'editor'),
  ('ws_rls', 'b0000000-0000-0000-0000-000000000002', 'viewer'),
  ('ws_rls', 'b0000000-0000-0000-0000-000000000003', 'editor');

insert into public.org_tool_access (user_id, level) values
  ('b0000000-0000-0000-0000-000000000001', 'edit'),
  ('b0000000-0000-0000-0000-000000000002', 'view'),
  ('b0000000-0000-0000-0000-000000000003', 'view');

insert into public.departments (id, workspace_id, code, name, is_quality_gate) values
  ('dept_rls_prd', 'ws_rls', 'PRD', 'Production', false),
  ('dept_rls_b', 'ws_rls', 'ENG', 'Engineering', false),
  ('dept_rls_empty', 'ws_rls', 'NEW', 'Brand New', false);

-- u_member owns Production; u_seat belongs to Engineering only; u_view belongs nowhere.
insert into public.department_members (department_id, user_id, dept_role) values
  ('dept_rls_prd', 'b0000000-0000-0000-0000-000000000001', 'author'),
  ('dept_rls_b', 'b0000000-0000-0000-0000-000000000003', 'reviewer');

-- A draft in a department WITH members (scoped) and one in a memberless department.
insert into public.sops (id, workspace_id, sop_number, title, document, status, created_by, department_id)
values
  ('sop_rls_1', 'ws_rls', 'PRD-SOP-001', 'Scoped draft', '{"body":"secret"}'::jsonb, 'draft',
   'b0000000-0000-0000-0000-000000000001', 'dept_rls_prd'),
  ('sop_rls_2', 'ws_rls', 'NEW-SOP-001', 'Legacy draft', '{"body":"open"}'::jsonb, 'draft',
   'b0000000-0000-0000-0000-000000000001', 'dept_rls_empty');

-- u_seat holds a seat on the scoped SOP for their own department.
insert into public.sop_review_seats (sop_id, department_id, rasic, signer_id) values
  ('sop_rls_1', 'dept_rls_b', 'responsible', 'b0000000-0000-0000-0000-000000000003');

-- Helper: act as a given user with the authenticated role.
create or replace function test_as(p_uid text) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
end $$;

-- ---------------------------------------------------------------------------
-- 1. An org-tool viewer in NO department may BROWSE another department's draft, but not edit it.
--    This replaces the original D1 read ban, which 20260715122000 lifted on purpose: "Workspace
--    SOP users may browse every department's documents, while draft content remains editable
--    only by explicit members of the owning department." Reading is no longer the boundary --
--    writing is, so that is what this asserts.
-- ---------------------------------------------------------------------------
select test_as('b0000000-0000-0000-0000-000000000002');
select is(
  (select count(*) from public.sops where id = 'sop_rls_1'),
  1::bigint,
  'an org-tool viewer in no department may browse another department''s draft'
);
select is(
  (select title from public.sops where id = 'sop_rls_1'),
  'Scoped draft',
  'browsing returns the real row, not an empty shell'
);
-- The write boundary. An UPDATE filtered by RLS touches zero rows rather than raising, so assert
-- the content did not move -- a raise here would equally satisfy a naive throws_ok.
update public.sops set document = '{"body":"tampered"}'::jsonb where id = 'sop_rls_1';
select is(
  (select document ->> 'body' from public.sops where id = 'sop_rls_1'),
  'secret',
  'browsing does not confer editing: a non-member UPDATE changes nothing'
);

-- ---------------------------------------------------------------------------
-- 2. A seat holder from another department CAN see the SOP they must review.
-- ---------------------------------------------------------------------------
select test_as('b0000000-0000-0000-0000-000000000003');
select is(
  (select count(*) from public.sops where id = 'sop_rls_1'),
  1::bigint,
  'a review-seat holder from another department can read the draft (holds_sop_seat)'
);

-- ---------------------------------------------------------------------------
-- 3. Sanity: the owning department member still reads it.
-- ---------------------------------------------------------------------------
select test_as('b0000000-0000-0000-0000-000000000001');
select is(
  (select count(*) from public.sops where id = 'sop_rls_1'),
  1::bigint,
  'an owning-department member reads their own draft'
);

-- ---------------------------------------------------------------------------
-- 4. Grandfather clause survives the fix, but only for TRULY memberless departments.
-- ---------------------------------------------------------------------------
select test_as('b0000000-0000-0000-0000-000000000002');
select is(
  (select count(*) from public.sops where id = 'sop_rls_2'),
  1::bigint,
  'a draft in a memberless department stays open to org-tool viewers (department_has_members)'
);

select finish();
rollback;
