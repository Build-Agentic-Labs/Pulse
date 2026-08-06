-- pgTAP coverage for atomic project creation.
-- Run with: supabase db reset && supabase test db

begin;
select plan(11);

insert into public.workspaces (id, name) values ('ws_project_create', 'Project Creation Org');
insert into public.workspace_auto_join_domains (domain, workspace_id)
values ('project-create.test', 'ws_project_create');

insert into auth.users (id, aud, role, email) values
  ('f1000000-0000-0000-0000-000000000001', 'authenticated', 'authenticated', 'editor@project-create.test'),
  ('f1000000-0000-0000-0000-000000000002', 'authenticated', 'authenticated', 'viewer@project-create.test');

insert into public.workspace_members (workspace_id, user_id, role) values
  ('ws_project_create', 'f1000000-0000-0000-0000-000000000001', 'editor'),
  ('ws_project_create', 'f1000000-0000-0000-0000-000000000002', 'viewer');

create or replace function test_as(p_uid text) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
end $$;

select test_as('f1000000-0000-0000-0000-000000000001');

select lives_ok(
  $$ select public.create_project_with_starter_plan('ws_project_create', 'Prep Accessories') $$,
  'an editor can atomically create a starter project'
);

select is(
  (select count(*) from public.projects where workspace_id = 'ws_project_create' and name = 'Prep Accessories'),
  1::bigint,
  'the transaction creates one active project row'
);

select is(
  (select count(*)
   from public.products pr
   join public.projects p on p.id = pr.project_id
   where p.workspace_id = 'ws_project_create' and p.name = 'Prep Accessories'),
  1::bigint,
  'the transaction creates one starter product'
);

select is(
  (select count(*)
   from public.scenarios s
   join public.products pr on pr.id = s.product_id
   join public.projects p on p.id = pr.project_id
   where p.workspace_id = 'ws_project_create' and p.name = 'Prep Accessories'),
  1::bigint,
  'the transaction creates one current-state scenario'
);

select is(
  (select count(*)
   from public.document_type_codes dt
   join public.products pr on pr.id = dt.product_id
   join public.projects p on p.id = pr.project_id
   where p.workspace_id = 'ws_project_create' and p.name = 'Prep Accessories'),
  4::bigint,
  'the transaction creates the four standard document types'
);

select is(
  (select pa.level::text
   from public.project_access pa
   join public.projects p on p.id = pa.project_id
   where p.workspace_id = 'ws_project_create'
     and p.name = 'Prep Accessories'
     and pa.user_id = 'f1000000-0000-0000-0000-000000000001'),
  'edit',
  'the creator receives edit access before project-scoped rows are inserted'
);

select is(
  (select pr.net_available_minutes::numeric
   from public.products pr
   join public.projects p on p.id = pr.project_id
   where p.workspace_id = 'ws_project_create' and p.name = 'Prep Accessories'),
  420::numeric,
  'the starter product retains the app calendar calculations'
);

select throws_ok(
  $$ select public.create_project_with_starter_plan('ws_project_create', '  prep-accessories  ') $$,
  '23505',
  'An active project with the same name already exists.',
  'punctuation, case, and whitespace variants cannot create duplicate active projects'
);

select is(
  (select count(*) from public.projects where workspace_id = 'ws_project_create'),
  1::bigint,
  'a refused duplicate leaves no partial project row'
);

select test_as('f1000000-0000-0000-0000-000000000002');
select throws_ok(
  $$ select public.create_project_with_starter_plan('ws_project_create', 'Viewer Project') $$,
  '42501',
  'You do not have permission to create projects in this organization.',
  'a viewer cannot create projects'
);

reset role;
select is(
  (select count(*) from public.projects where workspace_id = 'ws_project_create'),
  1::bigint,
  'a denied create also leaves no partial project row'
);

select * from finish();
rollback;
