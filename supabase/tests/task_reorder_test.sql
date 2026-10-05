-- Run only in test databases. All fixture writes roll back.
begin;
select plan(41);
insert into public.workspaces(id,name) values('d-reorder-ws','Atomic reorder test');
insert into public.workspace_auto_join_domains(domain,workspace_id) values('d-reorder.test','d-reorder-ws');
insert into auth.users(id,aud,role,email) values
 ('d4000000-0000-0000-0000-000000000001','authenticated','authenticated','author@d-reorder.test'),
 ('d4000000-0000-0000-0000-000000000002','authenticated','authenticated','teammate@d-reorder.test'),
 ('d4000000-0000-0000-0000-000000000003','authenticated','authenticated','viewer@d-reorder.test');
insert into public.workspace_members(workspace_id,user_id,role) values
 ('d-reorder-ws','d4000000-0000-0000-0000-000000000001','editor'),
 ('d-reorder-ws','d4000000-0000-0000-0000-000000000002','editor'),
 ('d-reorder-ws','d4000000-0000-0000-0000-000000000003','viewer');
insert into public.projects(id,workspace_id,name) values('d-project','d-reorder-ws','Pilot');
insert into public.project_access(project_id,user_id,level) values
 ('d-project','d4000000-0000-0000-0000-000000000001','edit'),
 ('d-project','d4000000-0000-0000-0000-000000000002','edit'),
 ('d-project','d4000000-0000-0000-0000-000000000003','view');
insert into public.products(id,project_id,name) values('d-product','d-project','Pilot');
insert into public.scenarios(id,product_id,name) values('d-scenario','d-product','Main'),('d-other','d-product','Other');
insert into public.zones(id,scenario_id,sequence,name) values('d-zone','d-scenario',1,'Zone'),('d-zone-2','d-scenario',2,'Second zone'),('d-foreign-zone','d-other',1,'Other');
insert into public.stations(id,scenario_id,sequence,name) values('d-station','d-scenario',1,'Station'),('d-station-2','d-scenario',2,'Second station'),('d-foreign-station','d-other',1,'Other');
insert into public.tasks(id,scenario_id,station_id,zone_id,wbs,name,planned_start,planned_finish,description) values
 ('d-task-a','d-scenario','d-station','d-zone','1','A',now(),now(),'Preserve A'),
 ('d-task-b','d-scenario','d-station','d-zone','2','B',now(),now(),'Preserve B'),
 ('d-task-c','d-scenario','d-station','d-zone','3','C',now(),now(),'Preserve C');
insert into public.manufacturing_steps(id,task_id,sequence,name,instruction,duration_minutes)
 values('d-step','d-task-a',1,'Step','Preserve instruction',1);
insert into public.step_tools(id,step_id,task_id,tool_name,sequence)
 values('d-tool','d-step','d-task-a','Wrench',1);
insert into public.step_photos(id,step_id,task_id,storage_path,public_url,file_name)
 values('d-photo','d-step','d-task-a','ci/d.png','ci/d.png','Preserve photo');
create function public.test_d_request() returns jsonb language sql as $$
 select jsonb_build_object('versions',jsonb_object_agg(id,version),
 'order',jsonb_agg(jsonb_build_object('id',id,'wbs',case id when 'd-task-a' then '2' when 'd-task-b' then '1' else wbs end,
 'zone_id',zone_id,'station_id',station_id) order by id)) from public.tasks where scenario_id='d-scenario';
$$;
create function public.test_d_apply(p jsonb,op uuid default 'd4000000-0000-0000-0000-000000000010') returns jsonb language sql as $$
 select public.reorder_scenario_tasks('d-project','d-scenario',op,p->'versions',p->'order',auth.uid());
$$;
create function public.test_d_as(uid text) returns void language plpgsql as $$
begin
 perform set_config('request.jwt.claims',json_build_object('sub',uid,'role','authenticated')::text,true);
 execute 'set local role authenticated';
end $$;
create temporary table d_inputs(name text primary key,payload jsonb);
grant all on d_inputs to authenticated;
insert into d_inputs values ('base',public.test_d_request()),
 ('initial',(select jsonb_agg(to_jsonb(t) order by id) from public.tasks t where scenario_id='d-scenario')),
 ('children',jsonb_build_object('step',(select to_jsonb(s) from public.manufacturing_steps s where id='d-step'),
 'tool',(select to_jsonb(t) from public.step_tools t where id='d-tool'),
 'photo',(select to_jsonb(p) from public.step_photos p where id='d-photo')));

select public.test_d_as('d4000000-0000-0000-0000-000000000003');
select throws_ok($$select public.load_task_reorder_baseline('d-project','d-scenario',auth.uid())$$,
 '42501','You do not have permission to reorder these tasks.','viewer cannot use edit-only baseline');
select throws_ok($$select public.test_d_apply((select payload from d_inputs where name='base'))$$,'42501',
 'You do not have permission to reorder these tasks.','viewer cannot reorder');
select public.test_d_as('d4000000-0000-0000-0000-000000000001');
select throws_ok($$select public.load_task_reorder_baseline('d-project','d-scenario','d4000000-0000-0000-0000-000000000002')$$,
 '42501','Sign in to reorder tasks.','baseline is actor-bound');
select throws_ok($$select public.load_task_reorder_baseline('wrong','d-scenario',auth.uid())$$,
 '42501','You do not have permission to reorder these tasks.','baseline refuses project mismatch');
select is(public.load_task_reorder_baseline('d-project','d-scenario',auth.uid()),
 (select jsonb_agg(jsonb_build_object('id',id,'wbs',wbs,'zone_id',zone_id,'station_id',station_id,'version',version) order by id)
 from public.tasks where scenario_id='d-scenario'),'baseline returns the complete ordered narrow row set');
select throws_ok($$select public.reorder_scenario_tasks('d-project','d-scenario',gen_random_uuid(),
 (select payload->'versions' from d_inputs where name='base'),(select payload->'order' from d_inputs where name='base'),
 'd4000000-0000-0000-0000-000000000002')$$,'42501','Sign in to reorder tasks.','captured actor must match the authenticated account');
select throws_ok($$insert into public.task_reorder_receipts(actor_id,operation_id,project_id,scenario_id,request)
 values(auth.uid(),gen_random_uuid(),'d-project','d-scenario','{}')$$,'42501',null,'client cannot forge receipt');
select throws_ok($$select public.reorder_scenario_tasks('wrong','d-scenario',gen_random_uuid(),
 (select payload->'versions' from d_inputs where name='base'),(select payload->'order' from d_inputs where name='base'),auth.uid())$$,
 '42501','You do not have permission to reorder these tasks.','project mismatch refuses');
select throws_ok($$select public.test_d_apply(jsonb_set((select payload from d_inputs where name='base'),'{order,0,description}','"overwrite"'))$$,
 '22023','Invalid task reorder fields.','unrelated fields refuse');
select throws_ok($$select public.test_d_apply(jsonb_set((select payload from d_inputs where name='base'),'{order,0,wbs}','"1"'))$$,
 '22023','Invalid task reorder fields.','duplicate WBS refuses');
select throws_ok($$select public.test_d_apply(jsonb_set((select payload from d_inputs where name='base'),'{order,0,zone_id}','"d-foreign-zone"'))$$,
 '22023','Task placement must belong to this scenario.','cross-scenario zone refuses');
select throws_ok($$select public.test_d_apply(jsonb_set((select payload from d_inputs where name='base'),'{order,0,station_id}','"d-foreign-station"'))$$,
 '22023','Task placement must belong to this scenario.','cross-scenario station refuses');
select throws_ok($$select public.test_d_apply(jsonb_set((select payload from d_inputs where name='base'),'{versions,d-task-a}','0'))$$,
 '22023','Invalid task reorder fields.','missing version is not fabricated');

-- Fault after the parking update: neither parked WBS nor receipt may survive.
reset role;
create function public.test_d_fail_final() returns trigger language plpgsql as $$
begin raise exception 'Injected final reorder failure'; end $$;
create trigger d_fail_final before update of wbs on public.tasks for each row
 when (new.id='d-task-a' and new.wbs='2') execute function public.test_d_fail_final();
select public.test_d_as('d4000000-0000-0000-0000-000000000001');
select throws_ok($$select public.test_d_apply((select payload from d_inputs where name='base'))$$,
 'P0001','Injected final reorder failure','mid-operation fault rejects');
select is((select jsonb_agg(to_jsonb(t) order by id) from public.tasks t where scenario_id='d-scenario'),
 (select payload from d_inputs where name='initial'),'every task field/version restored after fault');
select is((select count(*) from public.task_reorder_receipts),0::bigint,'failed operation creates no receipt');
reset role;
drop trigger d_fail_final on public.tasks;
select public.test_d_as('d4000000-0000-0000-0000-000000000001');
select lives_ok($$select public.test_d_apply((select payload from d_inputs where name='base'))$$,'swap commits');
select is((select jsonb_object_agg(id,wbs) from public.tasks where scenario_id='d-scenario'),
 '{"d-task-a":"2","d-task-b":"1","d-task-c":"3"}'::jsonb,'complete final ordering');
select is((select jsonb_agg(to_jsonb(t)-array['wbs','version','updated_at'] order by id) from public.tasks t where scenario_id='d-scenario'),
 (select jsonb_agg(x-array['wbs','version','updated_at'] order by x->>'id') from d_inputs,jsonb_array_elements(payload) x where name='initial'),
 'all unrelated task columns untouched');
select is(jsonb_build_object('step',(select to_jsonb(s) from public.manufacturing_steps s where id='d-step'),
 'tool',(select to_jsonb(t) from public.step_tools t where id='d-tool'),
 'photo',(select to_jsonb(p) from public.step_photos p where id='d-photo')),
 (select payload from d_inputs where name='children'),'steps tools and photos byte-identical');
select is((select version from public.tasks where id='d-task-c'),1,'unchanged task version unchanged');
insert into d_inputs values('committed',(select jsonb_agg(to_jsonb(t) order by id) from public.tasks t where scenario_id='d-scenario'));
select lives_ok($$select public.test_d_apply((select payload from d_inputs where name='base'))$$,'lost-response retry succeeds');
select is((select jsonb_agg(to_jsonb(t) order by id) from public.tasks t where scenario_id='d-scenario'),
 (select payload from d_inputs where name='committed'),'duplicate retry does not update any row');
select throws_ok($$select public.test_d_apply(jsonb_set((select payload from d_inputs where name='base'),'{order,0,wbs}','"4"'))$$,
 '22023','Task reorder operation id was reused with different content.','operation token cannot be repurposed');
select public.test_d_as('d4000000-0000-0000-0000-000000000002');
select throws_ok($$select public.test_d_apply((select payload from d_inputs where name='base'),gen_random_uuid())$$,
 '40001','Task reorder conflict. Reload before reordering again.','second user stale reorder refuses');
select is((select count(*) from public.task_reorder_receipts),0::bigint,'teammate cannot read another actor receipt');
select public.test_d_as('d4000000-0000-0000-0000-000000000001');
insert into d_inputs values('fresh',public.test_d_request());
update public.tasks set description='Concurrent field edit' where id='d-task-c';
select throws_ok($$select public.test_d_apply((select payload from d_inputs where name='fresh'),gen_random_uuid())$$,
 '40001','Task reorder conflict. Reload before reordering again.','concurrent field edit refuses stale reorder');
select is((select description from public.tasks where id='d-task-c'),'Concurrent field edit','field edit preserved');
insert into d_inputs values('before-add',public.test_d_request());
insert into public.tasks(id,scenario_id,wbs,name,planned_start,planned_finish) values('d-task-new','d-scenario','4','Added',now(),now());
select throws_ok($$select public.test_d_apply((select payload from d_inputs where name='before-add'),gen_random_uuid())$$,
 '40001','Task reorder conflict. Reload before reordering again.','added task invalidates baseline');
insert into d_inputs values('before-delete',public.test_d_request());
delete from public.tasks where id='d-task-new';
select throws_ok($$select public.test_d_apply((select payload from d_inputs where name='before-delete'),gen_random_uuid())$$,
 '40001','Task reorder conflict. Reload before reordering again.','deleted task invalidates baseline');
-- A later successful order must survive retry of the first operation.
insert into d_inputs values('later',public.test_d_request());
select public.test_d_apply(jsonb_set(jsonb_set((select payload from d_inputs where name='later'),'{order,0,wbs}','"1"'),'{order,1,wbs}','"2"'),
 'd4000000-0000-0000-0000-000000000011');
select public.test_d_apply((select payload from d_inputs where name='base'));
select is((select wbs from public.tasks where id='d-task-a'),'1','late duplicate never replays old order');
select throws_ok($$update public.task_reorder_receipts set request='{}'$$,'42501',null,'client cannot rewrite receipt');
select throws_ok($$delete from public.task_reorder_receipts$$,'42501',null,'client cannot delete receipt');
insert into d_inputs values('move',(select jsonb_build_object('versions',jsonb_object_agg(id,version),
 'order',jsonb_agg(jsonb_build_object('id',id,'wbs',wbs,'zone_id',case when id='d-task-a' then 'd-zone-2' else zone_id end,
 'station_id',case when id='d-task-a' then 'd-station-2' else station_id end))) from public.tasks where scenario_id='d-scenario'));
select lives_ok($$select public.test_d_apply((select payload from d_inputs where name='move'),gen_random_uuid())$$,'valid placement commits atomically');
select is((select zone_id from public.tasks where id='d-task-a'),'d-zone-2','intended zone applied');
select is((select station_id from public.tasks where id='d-task-a'),'d-station-2','intended station applied');
reset role;
update public.project_access set level='view' where project_id='d-project' and user_id='d4000000-0000-0000-0000-000000000001';
select public.test_d_as('d4000000-0000-0000-0000-000000000001');
select throws_ok($$select public.test_d_apply((select payload from d_inputs where name='base'))$$,
 '42501','You do not have permission to reorder these tasks.','revoked permission blocks even duplicate acknowledgment');
select is((select count(*) from public.tasks where wbs like '~reorder~%'),0::bigint,'no temporary numbering visible after any call');
select is((select count(*) from public.task_reorder_receipts),3::bigint,'only successful distinct operations recorded');
reset role;
set local role anon;
select throws_ok($$select public.reorder_scenario_tasks('d-project','d-scenario',gen_random_uuid(),'{}','[]',null)$$,
 '42501',null,'anonymous callers cannot execute the RPC');
select throws_ok($$select public.load_task_reorder_baseline('d-project','d-scenario',null)$$,
 '42501',null,'anonymous callers cannot execute baseline read');
reset role;
select * from finish();
rollback;
