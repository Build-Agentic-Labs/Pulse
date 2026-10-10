-- Run only in test databases. All fixture writes roll back.
begin;
select plan(12);

insert into public.workspaces(id, name) values ('ws_link_guard', 'AWI link guard test');
insert into public.projects(id, workspace_id, name)
values ('lg-project', 'ws_link_guard', 'AWI link guard test');
insert into public.products(id, project_id, name)
values ('lg-product', 'lg-project', 'Product');
insert into public.scenarios(id, product_id, name)
values ('lg-scenario', 'lg-product', 'Main');
insert into public.stations(id, scenario_id, sequence, name)
values ('lg-station', 'lg-scenario', 1, 'Station');
insert into public.tasks(id, scenario_id, station_id, wbs, name, planned_start, planned_finish, custom_fields)
values
  ('lg-plain', 'lg-scenario', 'lg-station', '1', 'Plain task', now(), now(), '{}'),
  ('lg-linked', 'lg-scenario', 'lg-station', '2', 'Linked task', now(), now(), '{"awiMasterLink":{"masterId":"lg-master","projectId":"lg-project","taskId":"lg-plain","documentNumber":"AWI-0001"}}'),
  ('lg-later', 'lg-scenario', 'lg-station', '3', 'Linked later', now(), now(), '{}');

select lives_ok($$
  insert into public.manufacturing_steps(id, task_id, sequence, name, instruction, duration_minutes)
  values ('lg-step', 'lg-plain', 1, 'Step', 'Instruction', 1)
$$, 'plain tasks accept manufacturing steps');

select throws_ok($$
  insert into public.manufacturing_steps(id, task_id, sequence, name, instruction, duration_minutes)
  values ('lg-linked-step', 'lg-linked', 2, 'Step', 'Instruction', 1)
$$, '23514', 'Edit these instructions in the linked master AWI.', 'linked tasks refuse manufacturing steps');

select throws_ok($$
  update public.manufacturing_steps set task_id = 'lg-linked' where id = 'lg-step'
$$, '23514', 'Edit these instructions in the linked master AWI.', 'steps cannot move into a linked task');

select lives_ok($$
  insert into public.step_tools(id, step_id, task_id, tool_name, sequence)
  values ('lg-tool', 'lg-step', 'lg-plain', 'Wrench', 1)
$$, 'plain tasks accept tools');

select throws_ok($$
  insert into public.step_tools(id, step_id, task_id, tool_name, sequence)
  values ('lg-linked-tool', 'lg-step', 'lg-linked', 'Drill', 1)
$$, '23514', 'Edit these instructions in the linked master AWI.', 'linked tasks refuse tools');

select throws_ok($$
  insert into public.step_photos(id, step_id, task_id, storage_path, public_url, file_name)
  values ('lg-linked-photo', 'lg-step', 'lg-linked', 'ci/lg.png', 'ci/lg.png', 'Photo')
$$, '23514', 'Edit these instructions in the linked master AWI.', 'linked tasks refuse photos');

-- Legacy children must remain removable after the task acquires a master link.
insert into public.manufacturing_steps(id, task_id, sequence, name, instruction, duration_minutes)
values ('lg-old-step', 'lg-later', 1, 'Old step', 'Legacy instruction', 1);
insert into public.step_photos(id, step_id, task_id, storage_path, public_url, file_name)
values ('lg-old-photo', 'lg-old-step', 'lg-later', 'ci/lg-old.png', 'ci/lg-old.png', 'Old photo');
update public.tasks
set custom_fields = '{"awiMasterLink":{"masterId":"lg-master","projectId":"lg-project","taskId":"lg-plain","documentNumber":"AWI-0001"}}'
where id = 'lg-later';

select lives_ok($$
  update public.step_photos set deleted_at = now() where id = 'lg-old-photo'
$$, 'legacy photos can be soft-deleted after linking');

select lives_ok($$
  delete from public.manufacturing_steps where id = 'lg-old-step'
$$, 'legacy steps can be deleted after linking');

select has_trigger('public', 'part_references', 'awi_link_child_guard', 'part references have the AWI child guard');
select has_trigger('public', 'step_exploded_views', 'awi_link_child_guard', 'exploded views have the AWI child guard');
select has_trigger('public', 'task_videos', 'awi_link_child_guard', 'task videos have the AWI child guard');
select is(
  has_function_privilege('authenticated', to_regprocedure('private.refuse_linked_awi_task_child()'), 'EXECUTE'),
  false,
  'authenticated cannot call the guard function directly'
);

select * from finish();
rollback;
