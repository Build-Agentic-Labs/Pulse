-- pgTAP: work instruction document control (releases and references).
-- Migrations: 20260918120000_work_instruction_control.sql, 20260918121000_..._text_hash.sql
--
-- Pins:
--   * the revision letter sequence (A..Z, AA) matches the app's
--   * an editor releases Rev A then Rev B; the DATABASE assigns revision, releaser and project,
--     ignoring whatever the client sent
--   * a project viewer can read releases but cannot release
--   * a user with no access to the project sees nothing and cannot release
--   * a release cannot be updated, by anyone
--   * references: editor writes, viewer reads only, an SOP from another organization is refused

begin;
select plan(19);

insert into public.workspaces (id, name) values ('ws_wi', 'WI Org'), ('ws_wi_other', 'Other Org');
insert into public.workspace_auto_join_domains (domain, workspace_id) values ('wi.dev', 'ws_wi');

insert into auth.users (id, aud, role, email)
values
  ('f0000000-0000-0000-0000-000000000001', 'authenticated', 'authenticated', 'wi-editor@wi.dev'),
  ('f0000000-0000-0000-0000-000000000002', 'authenticated', 'authenticated', 'wi-viewer@wi.dev'),
  ('f0000000-0000-0000-0000-000000000003', 'authenticated', 'authenticated', 'wi-outsider@wi.dev');

-- Whether or not a signup trigger already made the profile row, it ends up with this name.
insert into public.profiles (id, full_name) values ('f0000000-0000-0000-0000-000000000001', 'Wi Editor')
on conflict (id) do update set full_name = excluded.full_name;

insert into public.workspace_members (workspace_id, user_id, role) values
  ('ws_wi', 'f0000000-0000-0000-0000-000000000001', 'editor'),
  ('ws_wi', 'f0000000-0000-0000-0000-000000000002', 'viewer'),
  ('ws_wi', 'f0000000-0000-0000-0000-000000000003', 'viewer');

insert into public.projects (id, workspace_id, name) values ('proj_wi', 'ws_wi', 'WI Project');
insert into public.project_access (project_id, user_id, level) values
  ('proj_wi', 'f0000000-0000-0000-0000-000000000001', 'edit'),
  ('proj_wi', 'f0000000-0000-0000-0000-000000000002', 'view');

insert into public.products (id, project_id, name) values ('prod_wi', 'proj_wi', 'WI Product');
insert into public.scenarios (id, product_id, name) values ('scen_wi', 'prod_wi', 'Current');
insert into public.tasks (id, scenario_id, name, wbs, planned_start, planned_finish)
values ('task_wi', 'scen_wi', 'Install bracket', '1', '2026-09-18T08:00:00Z', '2026-09-18T09:00:00Z');

insert into public.sops (id, workspace_id, title, document, status, created_by) values
  ('sop_wi_own', 'ws_wi', 'Own SOP', '{}'::jsonb, 'draft', 'f0000000-0000-0000-0000-000000000001'),
  ('sop_wi_foreign', 'ws_wi_other', 'Foreign SOP', '{}'::jsonb, 'draft', 'f0000000-0000-0000-0000-000000000001');

create or replace function test_as(p_uid text) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
end $$;

-- ---------------------------------------------------------------------------
-- 1-4. Revision letters.
-- ---------------------------------------------------------------------------
select is(public.work_instruction_revision_letter(1), 'A', '1 is Rev A');
select is(public.work_instruction_revision_letter(26), 'Z', '26 is Rev Z');
select is(public.work_instruction_revision_letter(27), 'AA', '27 rolls over to AA');
select is(public.work_instruction_revision_letter(703), 'AAA', '703 is AAA');

-- ---------------------------------------------------------------------------
-- 5-9. An editor releases; the database decides revision, releaser, project and name.
-- ---------------------------------------------------------------------------
select test_as('f0000000-0000-0000-0000-000000000001');
select lives_ok(
  $$ insert into public.work_instruction_releases
       (project_id, task_id, revision_index, revision, released_by, released_by_name, change_description, effective_date, content, content_hash)
     values
       ('proj_forged', 'task_wi', 9, 'ZZ', 'f0000000-0000-0000-0000-000000000002', 'Forged Name',
        '  Initial release  ', '2026-09-18', '{"taskId":"task_wi"}'::jsonb, 'v1:aaa') $$,
  'a project editor can release a work instruction'
);
select is(
  (select revision || ':' || revision_index || ':' || project_id from public.work_instruction_releases where task_id = 'task_wi'),
  'A:1:proj_wi',
  'the first release is Rev A in the task''s real project, whatever the client sent'
);
select is(
  (select released_by::text || ':' || released_by_name || ':' || change_description from public.work_instruction_releases where task_id = 'task_wi'),
  'f0000000-0000-0000-0000-000000000001:Wi Editor:Initial release',
  'the releaser and their name come from the session, and the note is trimmed'
);
insert into public.work_instruction_releases (project_id, task_id, change_description, effective_date, content, content_hash)
values ('proj_wi', 'task_wi', 'Raised torque', '2026-09-19', '{"taskId":"task_wi"}'::jsonb, 'v1:bbb');
select is(
  (select string_agg(revision, ',' order by revision_index) from public.work_instruction_releases where task_id = 'task_wi'),
  'A,B',
  'the next release is Rev B'
);
select throws_like(
  $$ insert into public.work_instruction_releases (project_id, task_id, change_description, effective_date, content, content_hash)
     values ('proj_wi', 'task_missing', 'x', '2026-09-19', '{}'::jsonb, 'v1:ccc') $$,
  '%does not exist%',
  'a release for an unknown task is refused'
);

-- ---------------------------------------------------------------------------
-- 10-11. Immutable.
-- ---------------------------------------------------------------------------
update public.work_instruction_releases set change_description = 'tampered' where task_id = 'task_wi';
select is(
  (select count(*) from public.work_instruction_releases where change_description = 'tampered'),
  0::bigint,
  'an editor''s UPDATE changes nothing (no policy grants it)'
);
reset role;
select throws_like(
  $$ update public.work_instruction_releases set change_description = 'tampered' where task_id = 'task_wi' $$,
  '%immutable%',
  'even the owner role cannot rewrite a released document'
);

-- ---------------------------------------------------------------------------
-- 12-13. A viewer reads but cannot release.
-- ---------------------------------------------------------------------------
select test_as('f0000000-0000-0000-0000-000000000002');
select is((select count(*) from public.work_instruction_releases where task_id = 'task_wi'), 2::bigint, 'a project viewer can read the releases');
select throws_ok(
  $$ insert into public.work_instruction_releases (project_id, task_id, change_description, effective_date, content, content_hash)
     values ('proj_wi', 'task_wi', 'Viewer release', '2026-09-20', '{}'::jsonb, 'v1:ddd') $$,
  '42501',
  null,
  'a project viewer cannot release'
);
reset role;

-- ---------------------------------------------------------------------------
-- 14-15. No project access: nothing visible, nothing writable.
-- ---------------------------------------------------------------------------
select test_as('f0000000-0000-0000-0000-000000000003');
select is((select count(*) from public.work_instruction_releases where task_id = 'task_wi'), 0::bigint, 'a user without project access sees no releases');
select throws_ok(
  $$ insert into public.work_instruction_releases (project_id, task_id, change_description, effective_date, content, content_hash)
     values ('proj_wi', 'task_wi', 'Outsider release', '2026-09-20', '{}'::jsonb, 'v1:eee') $$,
  '42501',
  null,
  'a user without project access cannot release'
);
reset role;

-- ---------------------------------------------------------------------------
-- 16-19. References.
-- ---------------------------------------------------------------------------
select test_as('f0000000-0000-0000-0000-000000000001');
insert into public.work_instruction_references (project_id, task_id, kind, sop_id) values ('proj_forged', 'task_wi', 'sop', 'sop_wi_own');
select is(
  (select project_id || ':' || title from public.work_instruction_references where task_id = 'task_wi'),
  'proj_wi:Own SOP',
  'an SOP reference lands in the task''s project and carries the SOP''s title as its own label'
);
select throws_like(
  $$ insert into public.work_instruction_references (project_id, task_id, kind, sop_id) values ('proj_wi', 'task_wi', 'sop', 'sop_wi_foreign') $$,
  '%does not belong%',
  'an SOP from another organization cannot be referenced'
);
reset role;

select test_as('f0000000-0000-0000-0000-000000000002');
select is((select count(*) from public.work_instruction_references where task_id = 'task_wi'), 1::bigint, 'a project viewer can read references');
select throws_ok(
  $$ insert into public.work_instruction_references (project_id, task_id, kind, title) values ('proj_wi', 'task_wi', 'link', 'Wiki') $$,
  '42501',
  null,
  'a project viewer cannot add a reference'
);
reset role;

select * from finish();
rollback;
