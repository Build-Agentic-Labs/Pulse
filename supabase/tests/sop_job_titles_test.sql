-- pgTAP tests for the workspace job-title vocabulary (sop_job_titles).
--
-- The rule in one sentence: anyone who can edit SOPs in the workspace may read and add job titles;
-- only workspace owners/admins may rename or delete one. Curation is a narrower privilege than
-- authoring on purpose — an author adding a job title is routine, rewriting the shared vocabulary is
-- not — so the two must be shown to come apart.
--
-- Run with the local stack:  supabase db reset && supabase test db
--
-- Auth is simulated the Supabase way: set the JWT claims GUC + role `authenticated` so
-- auth.uid() resolves and RLS applies. Fixtures are created as the owner (RLS bypassed).

begin;
select plan(9);

-- ---------------------------------------------------------------------------
-- Fixtures (owner context: RLS bypassed)
-- ---------------------------------------------------------------------------
-- enforce_signup_domain() rejects emails whose domain is absent from
-- workspace_auto_join_domains, which is empty on a fresh db reset.
insert into public.workspaces (id, name) values ('ws_jt', 'Titles Org');
insert into public.workspace_auto_join_domains (domain, workspace_id) values ('test.dev', 'ws_jt');

insert into auth.users (id, aud, role, email)
values
  ('e1000000-0000-0000-0000-000000000001', 'authenticated', 'authenticated', 'jt-author@test.dev'),
  ('e1000000-0000-0000-0000-000000000002', 'authenticated', 'authenticated', 'jt-viewer@test.dev'),
  ('e1000000-0000-0000-0000-000000000003', 'authenticated', 'authenticated', 'jt-admin@test.dev'),
  ('e1000000-0000-0000-0000-000000000004', 'authenticated', 'authenticated', 'jt-outsider@test.dev');

insert into public.workspace_members (workspace_id, user_id, role) values
  ('ws_jt', 'e1000000-0000-0000-0000-000000000001', 'editor'),
  ('ws_jt', 'e1000000-0000-0000-0000-000000000002', 'viewer'),
  ('ws_jt', 'e1000000-0000-0000-0000-000000000003', 'admin');
-- u4 belongs to no workspace at all.

insert into public.org_tool_access (workspace_id, user_id, level) values
  ('ws_jt', 'e1000000-0000-0000-0000-000000000001', 'edit'),
  ('ws_jt', 'e1000000-0000-0000-0000-000000000002', 'view'),
  ('ws_jt', 'e1000000-0000-0000-0000-000000000003', 'edit');

insert into public.sop_job_titles (id, workspace_id, name) values
  ('jt_seed', 'ws_jt', 'Calibration Technician');

-- Helper: act as a given user with the authenticated role.
create or replace function test_as(p_uid text) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
end $$;

-- ---------------------------------------------------------------------------
-- 1/2. An SOP author may read the vocabulary and add to it.
-- ---------------------------------------------------------------------------
select test_as('e1000000-0000-0000-0000-000000000001');
select is(
  (select count(*) from public.sop_job_titles where workspace_id = 'ws_jt'),
  1::bigint,
  'an org-tool editor reads the workspace title vocabulary'
);
select lives_ok(
  $$ insert into public.sop_job_titles (workspace_id, name) values ('ws_jt', 'Line Auditor') $$,
  'an org-tool editor may add a job title'
);

-- ---------------------------------------------------------------------------
-- 3. The unique index makes case and edge whitespace one role, not three.
-- ---------------------------------------------------------------------------
select throws_ok(
  $$ insert into public.sop_job_titles (workspace_id, name) values ('ws_jt', '  line auditor ') $$,
  null,
  'a case/whitespace variant of an existing role is refused by the unique index'
);

-- ---------------------------------------------------------------------------
-- 4/5. Adding is authoring; curating is not. An author may not rename or delete.
-- ---------------------------------------------------------------------------
update public.sop_job_titles set name = 'Renamed By Author' where id = 'jt_seed';
select is(
  (select name from public.sop_job_titles where id = 'jt_seed'),
  'Calibration Technician',
  'an author''s UPDATE matches no row: renaming is owner/admin only'
);
delete from public.sop_job_titles where id = 'jt_seed';
select is(
  (select count(*) from public.sop_job_titles where id = 'jt_seed'),
  1::bigint,
  'an author''s DELETE matches no row: removing is owner/admin only'
);

-- ---------------------------------------------------------------------------
-- 6. A view-only user reads but cannot add.
-- ---------------------------------------------------------------------------
select test_as('e1000000-0000-0000-0000-000000000002');
select throws_ok(
  $$ insert into public.sop_job_titles (workspace_id, name) values ('ws_jt', 'Sneaky') $$,
  null,
  'an org-tool viewer cannot add a job title'
);

-- ---------------------------------------------------------------------------
-- 7/8. An admin curates.
-- ---------------------------------------------------------------------------
select test_as('e1000000-0000-0000-0000-000000000003');
update public.sop_job_titles set name = 'Calibration Technician II' where id = 'jt_seed';
select is(
  (select name from public.sop_job_titles where id = 'jt_seed'),
  'Calibration Technician II',
  'a workspace admin can rename a job title'
);
delete from public.sop_job_titles where id = 'jt_seed';
select is(
  (select count(*) from public.sop_job_titles where id = 'jt_seed'),
  0::bigint,
  'a workspace admin can remove a job title'
);

-- ---------------------------------------------------------------------------
-- 9. Tenancy: someone outside the workspace sees nothing.
-- ---------------------------------------------------------------------------
select test_as('e1000000-0000-0000-0000-000000000004');
select is(
  (select count(*) from public.sop_job_titles where workspace_id = 'ws_jt'),
  0::bigint,
  'a user outside the workspace reads none of its job titles'
);

select finish();
rollback;
