-- pgTAP: D1 regression — department-scoped SOP visibility must DENY, not grant.
--
-- The shipped policy (20260708120000) grandfathered "memberless" departments with an inline
-- subquery on department_members, which is filtered by that table's OWN RLS. To any non-member
-- every department looked memberless, so the branch evaluated true and every org-tool viewer
-- could read — and every editor could modify — every department's non-effective SOPs.
--
-- This fix routes the predicate through the security definer department_has_members(dept_id),
-- which runs as the table owner and is not re-filtered. This test pins:
--   * a workspace member with org-tool view and NO department cannot read a scoped draft
--   * the same user cannot UPDATE it
--   * an owning-department member still reads it
--   * a draft in a genuinely memberless department stays open (grandfather retained)

begin;
select plan(3);

insert into public.workspaces (id, name) values ('ws_d1', 'D1 Org');
insert into public.workspace_auto_join_domains (domain, workspace_id) values ('test.dev', 'ws_d1');

insert into auth.users (id, aud, role, email) values
  ('d1000000-0000-0000-0000-000000000001', 'authenticated', 'authenticated', 'd1-member@test.dev'),
  ('d1000000-0000-0000-0000-000000000002', 'authenticated', 'authenticated', 'd1-viewer@test.dev');

insert into public.workspace_members (workspace_id, user_id, role) values
  ('ws_d1', 'd1000000-0000-0000-0000-000000000001', 'editor'),
  ('ws_d1', 'd1000000-0000-0000-0000-000000000002', 'editor');

insert into public.org_tool_access (user_id, level) values
  ('d1000000-0000-0000-0000-000000000001', 'edit'),
  ('d1000000-0000-0000-0000-000000000002', 'edit');

insert into public.departments (id, workspace_id, code, name, is_quality_gate) values
  ('d1_prd', 'ws_d1', 'PRD', 'Production', false),
  ('d1_empty', 'ws_d1', 'NEW', 'Brand New', false);

-- member owns Production; viewer belongs to no department.
insert into public.department_members (department_id, user_id, dept_role) values
  ('d1_prd', 'd1000000-0000-0000-0000-000000000001', 'author');

insert into public.sops (id, workspace_id, sop_number, title, document, status, created_by, department_id)
values
  ('sop_d1_scoped', 'ws_d1', 'PRD-SOP-001', 'Scoped draft', '{"body":"secret"}'::jsonb, 'draft',
   'd1000000-0000-0000-0000-000000000001', 'd1_prd'),
  ('sop_d1_legacy', 'ws_d1', 'NEW-SOP-001', 'Legacy draft', '{"body":"open"}'::jsonb, 'draft',
   'd1000000-0000-0000-0000-000000000001', 'd1_empty');

create or replace function test_as(p_uid text) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
end $$;

-- 1. A no-department org-tool viewer cannot READ another department's draft.
select test_as('d1000000-0000-0000-0000-000000000002');
select is(
  (select count(*) from public.sops where id = 'sop_d1_scoped'),
  0::bigint,
  'a no-department org-tool viewer cannot read a scoped draft (D1 read)'
);

-- 2. Nor can they UPDATE it — the same hole affected the write policy. An RLS-denied UPDATE
--    touches zero rows and raises nothing, so we confirm the title from the OWNER's side.
update public.sops set title = 'tampered' where id = 'sop_d1_scoped';

-- 3. The owning department's member still reads it — and sees the untampered title.
select test_as('d1000000-0000-0000-0000-000000000001');
select is(
  (select title from public.sops where id = 'sop_d1_scoped'),
  'Scoped draft',
  'a no-department viewer''s UPDATE changed nothing, and the owner still reads the draft (D1 write + read)'
);

-- 4. Grandfathering survives, but only for a TRULY memberless department.
select test_as('d1000000-0000-0000-0000-000000000002');
select is(
  (select count(*) from public.sops where id = 'sop_d1_legacy'),
  1::bigint,
  'a draft in a memberless department stays open to org-tool viewers (department_has_members)'
);

select finish();
rollback;
