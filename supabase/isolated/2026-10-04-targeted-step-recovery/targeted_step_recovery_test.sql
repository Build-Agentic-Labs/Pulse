-- Targeted step delete/restore and diff-based step tool changes. Every fixture and write is rolled back.
begin;
select plan(33);

insert into public.workspaces(id,name) values ('ws_safe_ci','Step recovery CI'), ('ws_safe_other','Other org');
insert into public.workspace_auto_join_domains(domain,workspace_id) values ('safe-ci.test','ws_safe_ci'), ('safe-other.test','ws_safe_other')
 on conflict (domain) do update set workspace_id = excluded.workspace_id;
insert into auth.users(id,aud,role,email) values
 ('b8100000-0000-0000-0000-000000000001','authenticated','authenticated','editor@safe-ci.test'),
 ('b8100000-0000-0000-0000-000000000002','authenticated','authenticated','teammate@safe-ci.test'),
 ('b8100000-0000-0000-0000-000000000003','authenticated','authenticated','viewer@safe-ci.test'),
 ('b8100000-0000-0000-0000-000000000004','authenticated','authenticated','outsider@safe-other.test');
insert into public.workspace_members(workspace_id,user_id,role) values
 ('ws_safe_ci','b8100000-0000-0000-0000-000000000001','editor'),
 ('ws_safe_ci','b8100000-0000-0000-0000-000000000002','editor'),
 ('ws_safe_ci','b8100000-0000-0000-0000-000000000003','viewer'),
 ('ws_safe_other','b8100000-0000-0000-0000-000000000004','owner')
on conflict (workspace_id,user_id) do update set role = excluded.role;

create function public.test_safe_as(p_uid text) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub',p_uid,'role','authenticated')::text, true);
  execute 'set local role authenticated';
end $$;
create function public.test_safe_as_anon() returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('role','anon')::text, true);
  execute 'set local role anon';
end $$;
create function public.test_safe_owner() returns void language plpgsql as $$
begin
  execute 'reset role';
  perform set_config('request.jwt.claims', '', true);
end $$;
-- Every row the tests care about, keyed by table.
create function public.test_safe_rows() returns jsonb language sql as $$
  select jsonb_build_object(
    'tasks', (select jsonb_agg(to_jsonb(t) order by t.id) from public.tasks t where t.id like 'safe-task-%'),
    'steps', (select jsonb_agg(to_jsonb(s) order by s.id) from public.manufacturing_steps s where s.task_id like 'safe-task-%'),
    'tools', (select jsonb_agg(to_jsonb(x) order by x.id) from public.step_tools x where x.task_id like 'safe-task-%'),
    'photos', (select jsonb_agg(to_jsonb(x) order by x.id) from public.step_photos x where x.task_id like 'safe-task-%'),
    'views', (select jsonb_agg(to_jsonb(x) order by x.id) from public.step_exploded_views x where x.task_id like 'safe-task-%'),
    'parts', (select jsonb_agg(to_jsonb(x) order by x.id) from public.part_references x where x.task_id like 'safe-task-%'),
    'events', (select jsonb_agg(to_jsonb(x) order by x.id) from public.actual_events x where x.task_id like 'safe-task-%'),
    'deps', (select jsonb_agg(to_jsonb(x) order by x.id) from public.task_dependencies x where x.predecessor_task_id like 'safe-task-%'));
$$;
-- The same, minus one step and its children (for "nothing else changed" comparisons).
create function public.test_safe_rows_without(p_step text) returns jsonb language sql as $$
  select jsonb_set(jsonb_set(jsonb_set(jsonb_set(r, '{steps}',
      coalesce((select jsonb_agg(e) from jsonb_array_elements(r->'steps') e where e->>'id' <> p_step), '[]')),
    '{tools}', coalesce((select jsonb_agg(e) from jsonb_array_elements(r->'tools') e where e->>'step_id' <> p_step), '[]')),
    '{photos}', coalesce((select jsonb_agg(e) from jsonb_array_elements(r->'photos') e where e->>'step_id' <> p_step), '[]')),
    '{views}', coalesce((select jsonb_agg(e) from jsonb_array_elements(r->'views') e where e->>'step_id' <> p_step), '[]'))
  from (select public.test_safe_rows() r) x;
$$;
-- Steps without the sequence/version that a positional shift legitimately changes.
create function public.test_safe_step_content(p_rows jsonb) returns jsonb language sql as $$
  select jsonb_agg(e - array['sequence','version','updated_at'] order by e->>'id') from jsonb_array_elements(p_rows->'steps') e;
$$;
create temporary table rec(name text primary key, val jsonb);
grant all on rec to authenticated, anon;

-- Fixture: a project created the normal way, a teammate with edit, a viewer, and an outsider.
select public.test_safe_as('b8100000-0000-0000-0000-000000000001');
insert into rec values ('project', to_jsonb(public.create_project_with_starter_plan('ws_safe_ci','Recovery product')));
select public.test_safe_owner();
insert into public.project_access(project_id,user_id,level) values
 ((select val#>>'{}' from rec where name='project'),'b8100000-0000-0000-0000-000000000002','edit'),
 ((select val#>>'{}' from rec where name='project'),'b8100000-0000-0000-0000-000000000003','view')
on conflict (project_id,user_id) do update set level = excluded.level;
insert into rec values ('scenario', to_jsonb((select s.id from public.scenarios s join public.products p on p.id=s.product_id
  where p.project_id=(select val#>>'{}' from rec where name='project'))));
insert into public.tasks(id,scenario_id,name,wbs,planned_start,planned_finish,planned_duration_minutes,planned_operators,custom_fields)
select id, (select val#>>'{}' from rec where name='scenario'), name, wbs, now(), now(), 10, 1, cf
from (values
  ('safe-task-A','Task A','1','{"stepPartMentions":{"safe-A2":["P-1"]},"keep":1}'::jsonb),
  ('safe-task-B','Task B','2','{}'::jsonb)) v(id,name,wbs,cf);
insert into public.manufacturing_steps(id,task_id,sequence,name,instruction,duration_minutes) values
 ('safe-A1','safe-task-A',1,'A1','Do A1',5), ('safe-A2','safe-task-A',2,'A2','Do A2',5),
 ('safe-A3','safe-task-A',3,'A3','Do A3',5), ('safe-B1','safe-task-B',1,'B1','Do B1',5);
insert into public.step_tools(id,task_id,step_id,tool_name,sequence)
 select 'tool-'||id||'-wrench', task_id, id, 'Wrench', 1 from public.manufacturing_steps where task_id like 'safe-task-%';
insert into public.step_photos(id,task_id,step_id,storage_path,public_url,file_name)
 select 'photo-'||id, task_id, id, 'safe-ci/'||id||'.png', 'safe-ci/'||id||'.png', id||'.png' from public.manufacturing_steps where task_id like 'safe-task-%';
insert into public.step_exploded_views(id,task_id,step_id,storage_path,public_url,file_name)
 select 'view-'||id, task_id, id, 'safe-ci/'||id||'-view.png', 'safe-ci/'||id||'-view.png', id||'-view.png' from public.manufacturing_steps where task_id like 'safe-task-%';
insert into public.part_references(id,task_id,part_number,quantity) values ('rec-part-A','safe-task-A','P-1',1);
insert into public.actual_events(id,task_id,event_type) values ('rec-event-B','safe-task-B','start');
insert into public.task_dependencies(id,predecessor_task_id,successor_task_id) values ('rec-dep','safe-task-A','safe-task-B');
update public.tasks set custom_fields=custom_fields||'{"stepPhotoAttachments":{"safe-A2":["photo"]},"stepToolLists":{"safe-A2":["Wrench"]}}'::jsonb where id='safe-task-A';
insert into rec values ('before', public.test_safe_rows());
insert into rec values ('a2_version', to_jsonb((select version from public.manufacturing_steps where id='safe-A2')));


create function public.test_safe_delete(p_version integer default null,p_step text default 'safe-A2') returns jsonb language sql as $$
 select public.delete_task_step_atomic((select val#>>'{}' from rec where name='project'),'safe-task-A',p_step,
 coalesce(p_version,(select (val#>>'{}')::int from rec where name='a2_version')),
 'b8200000-0000-0000-0000-000000000001','b8100000-0000-0000-0000-000000000001');
$$;
create function public.test_safe_restore() returns jsonb language sql as $$
 select public.restore_task_step_atomic((select val#>>'{}' from rec where name='project'),'safe-task-A',
 'b8200000-0000-0000-0000-000000000001',auth.uid());
$$;
select public.test_safe_as('b8100000-0000-0000-0000-000000000003');
select throws_ok($$select public.test_safe_delete()$$,'42501',null,'viewer cannot delete');
select public.test_safe_as('b8100000-0000-0000-0000-000000000004');
select throws_ok($$select public.test_safe_delete()$$,'42501',null,'foreign actor cannot delete');
select public.test_safe_as('b8100000-0000-0000-0000-000000000001');
select throws_ok($$select public.test_safe_delete(999)$$,'40001',null,'stale version refused');
select public.test_safe_owner();
select is(public.test_safe_rows(),(select val from rec where name='before'),'refused deletes leave all rows unchanged');
select public.test_safe_as('b8100000-0000-0000-0000-000000000001');
select lives_ok($$select public.test_safe_delete()$$,'delete succeeds');
select lives_ok($$select public.test_safe_delete()$$,'lost response retry succeeds without deleting twice');
select throws_ok($$select public.test_safe_delete(null,'safe-A1')$$,'22023',null,'operation id cannot be reused for another step');
select throws_ok($$delete from public.task_step_recovery_records$$,'42501',null,'client cannot delete recovery records');
select public.test_safe_owner();
select is((select count(*)::int from public.task_step_recovery_records where task_id='safe-task-A'),1,'one immutable record');
select is((select count(*)::int from public.manufacturing_steps where id='safe-A2'),0,'only selected step deleted');
select is((select sequence from public.manufacturing_steps where id='safe-A3'),2,'remaining order compacted');
select is((select step_custom_fields from public.task_step_recovery_records where task_id='safe-task-A'),
 '{"stepPartMentions":["P-1"],"stepPhotoAttachments":["photo"],"stepToolLists":["Wrench"]}'::jsonb,'all three targeted maps preserved');
select is((select planned_duration_minutes from public.tasks where id='safe-task-A'),10::numeric,'duration recalculated');
select is((select to_jsonb(t) from public.tasks t where id='safe-task-B'),
 (select e from jsonb_array_elements((select val->'tasks' from rec where name='before')) e where e->>'id'='safe-task-B'),'other task unchanged');
-- Every refusal is atomic and keeps the recovery record available.
insert into public.manufacturing_steps(id,task_id,sequence,name,duration_minutes) values('safe-A2','safe-task-B',2,'Collision',1);
insert into rec values ('collision',public.test_safe_rows());
select public.test_safe_as('b8100000-0000-0000-0000-000000000001');
select throws_ok($$select public.test_safe_restore()$$,'40001',null,'occupied step id refuses restore');
select public.test_safe_owner();
select is(public.test_safe_rows(),(select val from rec where name='collision'),'occupied id refusal changes nothing');
delete from public.manufacturing_steps where id='safe-A2';
update public.tasks set custom_fields=jsonb_set(custom_fields,'{stepToolLists}','"changed shape"') where id='safe-task-A';
insert into rec values ('malformed',public.test_safe_rows());
select public.test_safe_as('b8100000-0000-0000-0000-000000000001');
select throws_ok($$select public.test_safe_restore()$$,'40001',null,'malformed current map refuses restore');
select public.test_safe_owner();
select is(public.test_safe_rows(),(select val from rec where name='malformed'),'malformed refusal changes nothing');
update public.tasks set custom_fields=jsonb_set(custom_fields,'{stepToolLists}','{}') where id='safe-task-A';
select public.test_safe_as_anon();
select throws_ok($$select public.test_safe_restore()$$,'42501',null,'anonymous caller cannot restore');
select public.test_safe_as('b8100000-0000-0000-0000-000000000001');
select throws_ok($$update public.task_step_recovery_records set step='{}'$$,'42501',null,'client cannot forge recovery payload');
select throws_ok($$select public.delete_task_step_atomic((select val#>>'{}' from rec where name='project'),'safe-task-A','safe-A1',1,
 'b8200000-0000-0000-0000-000000000002','b8100000-0000-0000-0000-000000000002')$$,'42501',null,'captured actor must match session');
select public.test_safe_owner();
-- Task/project ownership is rechecked rather than recreating a missing task.
savepoint missing_parent;
delete from public.tasks where id='safe-task-A';
select public.test_safe_as('b8100000-0000-0000-0000-000000000001');
select throws_ok($$select public.test_safe_restore()$$,'P0002',null,'missing parent refuses restore');
select public.test_safe_owner();
select is((select count(*)::int from public.task_step_recovery_records where task_id='safe-task-A' and restored_at is null),1,'missing parent leaves recovery available');
rollback to missing_parent;
-- Concurrent teammate changes must survive restoration.
update public.manufacturing_steps set instruction='Teammate correction' where id='safe-A1';
update public.tasks set name='Teammate name' where id='safe-task-A';
insert into public.manufacturing_steps(id,task_id,sequence,name,instruction,duration_minutes) values('safe-A4','safe-task-A',3,'A4','New teammate step',7);
select public.test_safe_as('b8100000-0000-0000-0000-000000000003');
select throws_ok($$select public.test_safe_restore()$$,'42501',null,'viewer cannot restore');
select public.test_safe_as('b8100000-0000-0000-0000-000000000002');
select lives_ok($$select public.test_safe_restore()$$,'authorized teammate restores');
select lives_ok($$select public.test_safe_restore()$$,'restore response retry is idempotent');
select public.test_safe_owner();
select is((select instruction from public.manufacturing_steps where id='safe-A1'),'Teammate correction','teammate step edit preserved');
select is((select name from public.tasks where id='safe-task-A'),'Teammate name','teammate task edit preserved');
select is((select count(*)::int from public.manufacturing_steps where id='safe-A4'),1,'new teammate step preserved');
select is((select string_agg(id,',' order by sequence) from public.manufacturing_steps where task_id='safe-task-A'),
 'safe-A1,safe-A2,safe-A3,safe-A4','restore inserts only original step into current order');
select is((select count(*)::int from public.step_tools where step_id='safe-A2')+
 (select count(*)::int from public.step_photos where step_id='safe-A2')+
 (select count(*)::int from public.step_exploded_views where step_id='safe-A2'),3,'all original children restored');
select public.test_safe_as('b8100000-0000-0000-0000-000000000001');
select lives_ok($$select public.test_safe_delete()$$,'old delete replay after restore does not delete again');
select public.test_safe_owner();
select is((select count(*)::int from public.manufacturing_steps where id='safe-A2'),1,'restored step remains after old delete replay');
select * from finish();
rollback;
