-- Targeted step delete/restore and diff-based step tool changes. Every fixture and write is rolled back.
begin;
select plan(48);

insert into public.workspaces(id,name) values ('ws_rec_ci','Step recovery CI'), ('ws_rec_other','Other org');
insert into public.workspace_auto_join_domains(domain,workspace_id) values ('rec-ci.test','ws_rec_ci'), ('rec-other.test','ws_rec_other')
 on conflict (domain) do update set workspace_id = excluded.workspace_id;
insert into auth.users(id,aud,role,email) values
 ('a8100000-0000-0000-0000-000000000001','authenticated','authenticated','editor@rec-ci.test'),
 ('a8100000-0000-0000-0000-000000000002','authenticated','authenticated','teammate@rec-ci.test'),
 ('a8100000-0000-0000-0000-000000000003','authenticated','authenticated','viewer@rec-ci.test'),
 ('a8100000-0000-0000-0000-000000000004','authenticated','authenticated','outsider@rec-other.test');
insert into public.workspace_members(workspace_id,user_id,role) values
 ('ws_rec_ci','a8100000-0000-0000-0000-000000000001','editor'),
 ('ws_rec_ci','a8100000-0000-0000-0000-000000000002','editor'),
 ('ws_rec_ci','a8100000-0000-0000-0000-000000000003','viewer'),
 ('ws_rec_other','a8100000-0000-0000-0000-000000000004','owner')
on conflict (workspace_id,user_id) do update set role = excluded.role;

create function public.test_rec_as(p_uid text) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub',p_uid,'role','authenticated')::text, true);
  execute 'set local role authenticated';
end $$;
create function public.test_rec_as_anon() returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('role','anon')::text, true);
  execute 'set local role anon';
end $$;
create function public.test_rec_owner() returns void language plpgsql as $$
begin
  execute 'reset role';
  perform set_config('request.jwt.claims', '', true);
end $$;
-- Every row the tests care about, keyed by table.
create function public.test_rec_rows() returns jsonb language sql as $$
  select jsonb_build_object(
    'tasks', (select jsonb_agg(to_jsonb(t) order by t.id) from public.tasks t where t.id like 'rec-task-%'),
    'steps', (select jsonb_agg(to_jsonb(s) order by s.id) from public.manufacturing_steps s where s.task_id like 'rec-task-%'),
    'tools', (select jsonb_agg(to_jsonb(x) order by x.id) from public.step_tools x where x.task_id like 'rec-task-%'),
    'photos', (select jsonb_agg(to_jsonb(x) order by x.id) from public.step_photos x where x.task_id like 'rec-task-%'),
    'views', (select jsonb_agg(to_jsonb(x) order by x.id) from public.step_exploded_views x where x.task_id like 'rec-task-%'),
    'parts', (select jsonb_agg(to_jsonb(x) order by x.id) from public.part_references x where x.task_id like 'rec-task-%'),
    'events', (select jsonb_agg(to_jsonb(x) order by x.id) from public.actual_events x where x.task_id like 'rec-task-%'),
    'deps', (select jsonb_agg(to_jsonb(x) order by x.id) from public.task_dependencies x where x.predecessor_task_id like 'rec-task-%'));
$$;
-- The same, minus one step and its children (for "nothing else changed" comparisons).
create function public.test_rec_rows_without(p_step text) returns jsonb language sql as $$
  select jsonb_set(jsonb_set(jsonb_set(jsonb_set(r, '{steps}',
      coalesce((select jsonb_agg(e) from jsonb_array_elements(r->'steps') e where e->>'id' <> p_step), '[]')),
    '{tools}', coalesce((select jsonb_agg(e) from jsonb_array_elements(r->'tools') e where e->>'step_id' <> p_step), '[]')),
    '{photos}', coalesce((select jsonb_agg(e) from jsonb_array_elements(r->'photos') e where e->>'step_id' <> p_step), '[]')),
    '{views}', coalesce((select jsonb_agg(e) from jsonb_array_elements(r->'views') e where e->>'step_id' <> p_step), '[]'))
  from (select public.test_rec_rows() r) x;
$$;
-- Steps without the sequence/version that a positional shift legitimately changes.
create function public.test_rec_step_content(p_rows jsonb) returns jsonb language sql as $$
  select jsonb_agg(e - array['sequence','version','updated_at'] order by e->>'id') from jsonb_array_elements(p_rows->'steps') e;
$$;
create temporary table rec(name text primary key, val jsonb);
grant all on rec to authenticated, anon;

-- Fixture: a project created the normal way, a teammate with edit, a viewer, and an outsider.
select public.test_rec_as('a8100000-0000-0000-0000-000000000001');
insert into rec values ('project', to_jsonb(public.create_project_with_starter_plan('ws_rec_ci','Recovery product')));
select public.test_rec_owner();
insert into public.project_access(project_id,user_id,level) values
 ((select val#>>'{}' from rec where name='project'),'a8100000-0000-0000-0000-000000000002','edit'),
 ((select val#>>'{}' from rec where name='project'),'a8100000-0000-0000-0000-000000000003','view')
on conflict (project_id,user_id) do update set level = excluded.level;
insert into rec values ('scenario', to_jsonb((select s.id from public.scenarios s join public.products p on p.id=s.product_id
  where p.project_id=(select val#>>'{}' from rec where name='project'))));
insert into public.tasks(id,scenario_id,name,wbs,planned_start,planned_finish,planned_duration_minutes,planned_operators,custom_fields)
select id, (select val#>>'{}' from rec where name='scenario'), name, wbs, now(), now(), 10, 1, cf
from (values
  ('rec-task-A','Task A','1','{"stepPartMentions":{"rec-A2":["P-1"]},"keep":1}'::jsonb),
  ('rec-task-B','Task B','2','{}'::jsonb)) v(id,name,wbs,cf);
insert into public.manufacturing_steps(id,task_id,sequence,name,instruction,duration_minutes) values
 ('rec-A1','rec-task-A',1,'A1','Do A1',5), ('rec-A2','rec-task-A',2,'A2','Do A2',5),
 ('rec-A3','rec-task-A',3,'A3','Do A3',5), ('rec-B1','rec-task-B',1,'B1','Do B1',5);
insert into public.step_tools(id,task_id,step_id,tool_name,sequence)
 select 'tool-'||id||'-wrench', task_id, id, 'Wrench', 1 from public.manufacturing_steps where task_id like 'rec-task-%';
insert into public.step_photos(id,task_id,step_id,storage_path,public_url,file_name)
 select 'photo-'||id, task_id, id, 'rec-ci/'||id||'.png', 'rec-ci/'||id||'.png', id||'.png' from public.manufacturing_steps where task_id like 'rec-task-%';
insert into public.step_exploded_views(id,task_id,step_id,storage_path,public_url,file_name)
 select 'view-'||id, task_id, id, 'rec-ci/'||id||'-view.png', 'rec-ci/'||id||'-view.png', id||'-view.png' from public.manufacturing_steps where task_id like 'rec-task-%';
insert into public.part_references(id,task_id,part_number,quantity) values ('rec-part-A','rec-task-A','P-1',1);
insert into public.actual_events(id,task_id,event_type) values ('rec-event-B','rec-task-B','start');
insert into public.task_dependencies(id,predecessor_task_id,successor_task_id) values ('rec-dep','rec-task-A','rec-task-B');
insert into rec values ('before', public.test_rec_rows());
insert into rec values ('a2_version', to_jsonb((select version from public.manufacturing_steps where id='rec-A2')));

-- Authorization: delete.
select public.test_rec_as_anon();
select throws_ok($$select public.delete_manufacturing_step('rec-A2', null)$$, '42501', null, 'anon cannot delete a step');
select public.test_rec_as('a8100000-0000-0000-0000-000000000003');
select throws_ok($$select public.delete_manufacturing_step('rec-A2', null)$$, '42501', null, 'a viewer cannot delete a step');
select public.test_rec_as('a8100000-0000-0000-0000-000000000004');
select throws_ok($$select public.delete_manufacturing_step('rec-A2', null)$$, '42501', null, 'another organization cannot delete a step');
select public.test_rec_owner();
select is(public.test_rec_rows(), (select val from rec where name='before'), 'refused deletes change nothing');

-- Stale version is refused and changes nothing.
select public.test_rec_as('a8100000-0000-0000-0000-000000000001');
select throws_ok($$select public.delete_manufacturing_step('rec-A2', (select (val#>>'{}')::int + 7 from rec where name='a2_version'))$$,
  '40001', null, 'a stale expected version is refused');
select public.test_rec_owner();
select is(public.test_rec_rows(), (select val from rec where name='before'), 'a refused stale delete changes nothing');

-- Delete exactly A2.
select public.test_rec_as('a8100000-0000-0000-0000-000000000001');
select lives_ok($$insert into rec values ('deleted', public.delete_manufacturing_step('rec-A2', (select (val#>>'{}')::int from rec where name='a2_version')))$$,
  'the editor deletes A2');
select public.test_rec_owner();
insert into rec values ('record1', to_jsonb((select val->>'record_id' from rec where name='deleted')));
select is((select count(*)::int from public.deleted_manufacturing_steps where step_id='rec-A2'), 1, 'one recovery record');
select is((select step->>'instruction' from public.deleted_manufacturing_steps where id=(select val#>>'{}' from rec where name='record1')), 'Do A2', 'the record holds the step row');
select is((select jsonb_array_length(tools) + jsonb_array_length(photos) + jsonb_array_length(exploded_views)
  from public.deleted_manufacturing_steps where id=(select val#>>'{}' from rec where name='record1')), 3, 'the record holds its tool, photo and exploded view');
select is((select step_custom_fields from public.deleted_manufacturing_steps where id=(select val#>>'{}' from rec where name='record1')),
  '{"stepPartMentions":["P-1"]}'::jsonb, 'the record holds its part mentions');
select is((select count(*)::int from public.manufacturing_steps where id='rec-A2'), 0, 'A2 is gone');
select is((select count(*)::int from public.step_tools where step_id='rec-A2') + (select count(*)::int from public.step_photos where step_id='rec-A2')
  + (select count(*)::int from public.step_exploded_views where step_id='rec-A2'), 0, 'its tool, photo and exploded view rows are gone');
select is(public.test_rec_rows() - 'steps',
  (select (val - 'steps') from rec where name='before') || jsonb_build_object(
    'tools', (select jsonb_agg(e) from jsonb_array_elements((select val->'tools' from rec where name='before')) e where e->>'step_id' <> 'rec-A2'),
    'photos', (select jsonb_agg(e) from jsonb_array_elements((select val->'photos' from rec where name='before')) e where e->>'step_id' <> 'rec-A2'),
    'views', (select jsonb_agg(e) from jsonb_array_elements((select val->'views' from rec where name='before')) e where e->>'step_id' <> 'rec-A2')),
  'tasks, other steps'' tools/photos/views, parts, events and dependencies are unchanged');
select is(public.test_rec_step_content(public.test_rec_rows()),
  (select jsonb_agg(e - array['sequence','version','updated_at'] order by e->>'id') from jsonb_array_elements((select val->'steps' from rec where name='before')) e where e->>'id' <> 'rec-A2'),
  'other steps keep their content');
select is((select array_agg(id||':'||sequence order by sequence) from public.manufacturing_steps where task_id='rec-task-A'),
  array['rec-A1:1','rec-A3:2'], 'later steps move up one position');

-- A retry after a lost response returns the same record.
select public.test_rec_as('a8100000-0000-0000-0000-000000000001');
select is((public.delete_manufacturing_step('rec-A2', null))->>'record_id', (select val#>>'{}' from rec where name='record1'), 'a delete retry returns the same record');
select public.test_rec_owner();
select is((select count(*)::int from public.deleted_manufacturing_steps where step_id='rec-A2'), 1, 'and creates no second record');

-- Recovery records: readable with view access, never writable by clients.
select public.test_rec_as('a8100000-0000-0000-0000-000000000003');
select is((select count(*)::int from public.deleted_manufacturing_steps where step_id='rec-A2'), 1, 'a viewer can read the record');
select public.test_rec_as('a8100000-0000-0000-0000-000000000004');
select is((select count(*)::int from public.deleted_manufacturing_steps where step_id='rec-A2'), 0, 'another organization cannot');
select public.test_rec_as('a8100000-0000-0000-0000-000000000001');
select throws_ok($$delete from public.deleted_manufacturing_steps$$, '42501', null, 'a client cannot delete records');
select throws_ok($$update public.deleted_manufacturing_steps set restored_at = now()$$, '42501', null, 'a client cannot change records');
select throws_ok($$insert into public.deleted_manufacturing_steps(project_id,task_id,step_id,step) values ('x','x','x','{}')$$, '42501', null, 'a client cannot forge records');
select throws_ok($$truncate public.deleted_manufacturing_steps$$, '42501', null, 'a client cannot truncate records');

-- A teammate works on the same task and another task while A2 is deleted.
select public.test_rec_as('a8100000-0000-0000-0000-000000000002');
update public.manufacturing_steps set instruction = 'Teammate edit' where id = 'rec-A1';
insert into public.manufacturing_steps(id,task_id,sequence,name,instruction,duration_minutes) values ('rec-A4','rec-task-A',3,'A4','Teammate step',5);
select is(public.apply_step_tool_changes('rec-task-A','rec-A4', array['Teammate Tool'], null), array['Teammate Tool'], 'the teammate tools their new step');
select is(public.apply_step_tool_changes('rec-task-B','rec-B1', array['Hex Key'], null), array['Wrench','Hex Key'], 'and adds a tool on another task');
select public.test_rec_owner();
insert into rec values ('teammate', public.test_rec_rows());

-- Authorization: restore.
select public.test_rec_as('a8100000-0000-0000-0000-000000000003');
select throws_ok($$select public.restore_manufacturing_step((select val#>>'{}' from rec where name='record1'))$$, '42501', null, 'a viewer cannot restore');
select public.test_rec_as('a8100000-0000-0000-0000-000000000004');
select throws_ok($$select public.restore_manufacturing_step((select val#>>'{}' from rec where name='record1'))$$, '42501', null, 'another organization cannot restore');
select public.test_rec_as_anon();
select throws_ok($$select public.restore_manufacturing_step('anything')$$, '42501', null, 'anon cannot restore');

-- Restore A2: back at position 2 with its own rows; the teammate's work survives.
select public.test_rec_as('a8100000-0000-0000-0000-000000000001');
select is((public.restore_manufacturing_step((select val#>>'{}' from rec where name='record1')))->>'restored', 'true', 'the editor restores A2');
select public.test_rec_owner();
select is((select array_agg(id||':'||sequence order by sequence) from public.manufacturing_steps where task_id='rec-task-A'),
  array['rec-A1:1','rec-A2:2','rec-A3:3','rec-A4:4'], 'A2 is back at its position; later steps move down one');
select is((select to_jsonb(s) - 'sequence' from public.manufacturing_steps s where id='rec-A2'),
  (select e - 'sequence' from jsonb_array_elements((select val->'steps' from rec where name='before')) e where e->>'id'='rec-A2'),
  'A2 is the same row (content, version, timestamps)');
select is((select jsonb_agg(to_jsonb(x) order by x.id) from public.step_tools x where step_id='rec-A2'),
  (select jsonb_agg(e) from jsonb_array_elements((select val->'tools' from rec where name='before')) e where e->>'step_id'='rec-A2'), 'its tool row is the same');
select is((select jsonb_agg(to_jsonb(x) order by x.id) from public.step_photos x where step_id='rec-A2'),
  (select jsonb_agg(e) from jsonb_array_elements((select val->'photos' from rec where name='before')) e where e->>'step_id'='rec-A2'), 'its photo row is the same');
select is((select jsonb_agg(to_jsonb(x) order by x.id) from public.step_exploded_views x where step_id='rec-A2'),
  (select jsonb_agg(e) from jsonb_array_elements((select val->'views' from rec where name='before')) e where e->>'step_id'='rec-A2'), 'its exploded view row is the same');
select is(public.test_rec_rows_without('rec-A2') - 'steps', (select val from rec where name='teammate') - 'steps',
  'every other row, including the teammate''s tools, equals the state just before restore');
select is(public.test_rec_step_content(public.test_rec_rows_without('rec-A2')), public.test_rec_step_content((select val from rec where name='teammate')),
  'other steps (the teammate''s edit and new step) keep their content');

-- Restoring again changes nothing.
insert into rec values ('restored', public.test_rec_rows());
select public.test_rec_as('a8100000-0000-0000-0000-000000000001');
select is((public.restore_manufacturing_step((select val#>>'{}' from rec where name='record1')))->>'already_restored', 'true', 'a second restore is a no-op');
select public.test_rec_owner();
select is(public.test_rec_rows(), (select val from rec where name='restored'), 'and changes no row');

-- Restoring into a deleted process is refused, and the record is kept.
select public.test_rec_as('a8100000-0000-0000-0000-000000000001');
insert into rec values ('record3', to_jsonb((public.delete_manufacturing_step('rec-A3', null))->>'record_id'));
delete from public.tasks where id = 'rec-task-A';
select throws_ok($$select public.restore_manufacturing_step((select val#>>'{}' from rec where name='record3'))$$, 'P0002', null, 'a step of a deleted process cannot be restored');
select public.test_rec_owner();
select is((select count(*)::int from public.deleted_manufacturing_steps where id=(select val#>>'{}' from rec where name='record3') and restored_at is null), 1, 'its record is kept');

-- apply_step_tool_changes: diff semantics, client-format ids, authorization.
select public.test_rec_as('a8100000-0000-0000-0000-000000000001');
select is(public.apply_step_tool_changes('rec-task-B','rec-B1', array[' hex key ', 'Torque Driver'], null), array['Wrench','Hex Key','Torque Driver'],
  'adding an existing name (any case or spacing) does not duplicate it');
select is((select id from public.step_tools where step_id='rec-B1' and tool_name='Torque Driver'), 'tool-rec-B1-torque-driver', 'new rows use the client id format');
select is(public.apply_step_tool_changes('rec-task-B','rec-B1', null, array['HEX KEY', 'Not There']), array['Wrench','Torque Driver'],
  'removal is by name, case-insensitive; absent names are ignored');
select throws_ok($$select public.apply_step_tool_changes('rec-task-B','rec-B1', array['Wrench 🔧'], null)$$, '22023', null, 'names outside the BMP are refused');
select throws_ok($$select public.apply_step_tool_changes('rec-task-A-missing','rec-B1', array['X'], null)$$, '42501', null, 'a step must belong to an accessible task');
select public.test_rec_as('a8100000-0000-0000-0000-000000000003');
select throws_ok($$select public.apply_step_tool_changes('rec-task-B','rec-B1', array['X'], null)$$, '42501', null, 'a viewer cannot change tools');
select public.test_rec_as('a8100000-0000-0000-0000-000000000004');
select throws_ok($$select public.apply_step_tool_changes('rec-task-B','rec-B1', array['X'], null)$$, '42501', null, 'another organization cannot change tools');

select * from finish();
rollback;
