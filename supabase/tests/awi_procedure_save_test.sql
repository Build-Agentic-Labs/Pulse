-- Every fixture and test write is rolled back; no existing AWI is modified.
begin;
select plan(42);
insert into public.workspaces(id,name) values('ws_awi_save_ci','AWI save CI');
insert into public.workspace_auto_join_domains(domain,workspace_id) values('awi-save-ci.test','ws_awi_save_ci');
insert into auth.users(id,aud,role,email) values
 ('a7200000-0000-0000-0000-000000000001','authenticated','authenticated','author@awi-save-ci.test'),
 ('a7200000-0000-0000-0000-000000000002','authenticated','authenticated','other@awi-save-ci.test'),
 ('a7200000-0000-0000-0000-000000000003','authenticated','authenticated','viewer@awi-save-ci.test');
insert into public.workspace_members(workspace_id,user_id,role) values
 ('ws_awi_save_ci','a7200000-0000-0000-0000-000000000001','editor'),
 ('ws_awi_save_ci','a7200000-0000-0000-0000-000000000002','editor'),
 ('ws_awi_save_ci','a7200000-0000-0000-0000-000000000003','viewer');
create function public.test_awi_save_as(p_uid text) returns void language plpgsql as $$
begin
 perform set_config('request.jwt.claims',json_build_object('sub',p_uid,'role','authenticated')::text,true);
 execute 'set local role authenticated';
end $$;
create function public.test_awi_save_payload(p_task text) returns jsonb language sql as $$
 select jsonb_build_object('p_task_id',t.id,'p_project_id',public.task_project_id(t.id),
   'p_expected_version',t.version,'p_expected_step_versions',
   (select coalesce(jsonb_object_agg(s.id,s.version),'{}'::jsonb) from public.manufacturing_steps s where s.task_id=t.id),
   'p_task_patch',jsonb_build_object('name',t.name,'description',t.description,'safety_notes',t.safety_notes,
     'planned_duration_minutes',t.planned_duration_minutes,'custom_fields',t.custom_fields),
   'p_steps',(select coalesce(jsonb_agg(to_jsonb(s)-array['created_at','updated_at','version'] order by s.sequence),'[]'::jsonb)
     from public.manufacturing_steps s where s.task_id=t.id),
   'p_parts',(select coalesce(jsonb_agg(to_jsonb(p)-array['created_at','updated_at'] order by p.id),'[]'::jsonb)
     from public.part_references p where p.task_id=t.id),
   'p_expected_parts',(select coalesce(jsonb_agg(to_jsonb(p)-array['created_at','updated_at'] order by p.id),'[]'::jsonb)
     from public.part_references p where p.task_id=t.id))
 from public.tasks t where t.id=p_task;
$$;
create function public.test_awi_save_apply(p jsonb) returns void language sql as $$
 select public.save_awi_procedure(p->>'p_task_id',p->>'p_project_id',(p->>'p_expected_version')::integer,
   p->'p_expected_step_versions',p->'p_expected_parts',p->'p_task_patch',p->'p_steps',p->'p_parts');
$$;
create function public.test_awi_save_snapshot(p_task text) returns jsonb language sql as $$
 select jsonb_build_object('task',(select to_jsonb(t) from public.tasks t where id=p_task),
   'steps',(select jsonb_agg(to_jsonb(s) order by id) from public.manufacturing_steps s where task_id=p_task),
   'parts',(select jsonb_agg(to_jsonb(p) order by id) from public.part_references p where task_id=p_task),
   'master',(select to_jsonb(m) from public.awi_masters m where task_id=p_task));
$$;
create temporary table awi_save_inputs(name text primary key,payload jsonb);
grant all on awi_save_inputs to authenticated;

select public.test_awi_save_as('a7200000-0000-0000-0000-000000000001');
select public.create_awi_master('ws_awi_save_ci','Atomic instruction','ATOMIC-001');
insert into awi_save_inputs values('task',to_jsonb((select task_id from public.awi_masters where document_number='ATOMIC-001')));
insert into public.manufacturing_steps(id,task_id,sequence,name,instruction,duration_minutes)
 select 'awi-save-second',payload#>>'{}',20,'Second','Preserve me',2 from awi_save_inputs where name='task';
insert into public.part_references(id,task_id,part_number,quantity)
 select 'awi-save-part',payload#>>'{}','PN-1',1 from awi_save_inputs where name='task';
insert into public.step_tools(id,step_id,task_id,tool_name,sequence)
 select 'awi-save-tool','awi-save-second',payload#>>'{}','Wrench',1 from awi_save_inputs where name='task';
insert into public.step_photos(id,step_id,task_id,storage_path,public_url,file_name)
 select 'awi-save-photo','awi-save-second',payload#>>'{}','ci/atomic.png','ci/atomic.png','Keep photo' from awi_save_inputs where name='task';
insert into awi_save_inputs values('base',public.test_awi_save_payload((select payload#>>'{}' from awi_save_inputs where name='task')));
insert into awi_save_inputs values('initial',public.test_awi_save_snapshot((select payload#>>'{}' from awi_save_inputs where name='task')));
insert into awi_save_inputs values('edit',(select jsonb_set(jsonb_set(payload,'{p_task_patch,name}','"Renamed instruction"'),'{p_steps,0,instruction}','"Edited instruction"') from awi_save_inputs where name='base'));

select lives_ok($$select public.test_awi_save_apply((select payload from awi_save_inputs where name='edit'))$$,'one transaction saves task and step');
select is((select title from public.awi_masters where document_number='ATOMIC-001'),'Renamed instruction','list title changes in the same transaction');
select is((select instruction from public.manufacturing_steps where task_id=(select payload#>>'{}' from awi_save_inputs where name='task') and sequence=10),'Edited instruction','step edit persisted');
select is((select version from public.manufacturing_steps where id='awi-save-second'),1,'unchanged step version is not bumped');
select is((select updated_at from public.part_references where id='awi-save-part'),
 (select (payload->'parts'->0->>'updated_at')::timestamptz from awi_save_inputs where name='initial'),
 'unchanged part is not rewritten');
-- Capture exact versions and draft metadata, then retry the old request as if its response was lost.
insert into awi_save_inputs values('before_retry',public.test_awi_save_snapshot((select payload#>>'{}' from awi_save_inputs where name='task')));
select lives_ok($$select public.test_awi_save_apply((select payload from awi_save_inputs where name='edit'))$$,'lost acknowledgement can be retried');
select is(public.test_awi_save_snapshot((select payload#>>'{}' from awi_save_inputs where name='task')),
 (select payload from awi_save_inputs where name='before_retry'),'retry does not rewrite unchanged rows or timestamps');
select throws_ok($$select public.test_awi_save_apply(jsonb_set((select payload from awi_save_inputs where name='base'),'{p_task_patch,name}','"Stale rename"'))$$,
 'PT409',null,'stale task version is rejected');
select is(public.test_awi_save_snapshot((select payload#>>'{}' from awi_save_inputs where name='task')),
 (select payload from awi_save_inputs where name='before_retry'),'conflict changes no task, steps, parts, or master metadata');

-- Fail after a valid step edit, during the later part insert. Earlier writes must roll back.
update awi_save_inputs set payload=public.test_awi_save_payload((select payload#>>'{}' from awi_save_inputs where name='task')) where name='base';
insert into awi_save_inputs values('invalid',(
 select jsonb_set(jsonb_set(payload,'{p_steps,0,instruction}','"Must roll back"'),'{p_parts}',payload->'p_parts' ||
 jsonb_build_array(jsonb_build_object('id','awi-save-bad-part','task_id',payload->>'p_task_id','part_number','BAD','quantity',-1,'description',null,'disposition',null)))
 from awi_save_inputs where name='base'));
select throws_ok($$select public.test_awi_save_apply((select payload from awi_save_inputs where name='invalid'))$$,'23514',null,'later constraint failure aborts the whole save');
select is(public.test_awi_save_snapshot((select payload#>>'{}' from awi_save_inputs where name='task')),
 (select payload from awi_save_inputs where name='before_retry'),'failed save leaves previous contents, versions, and timestamps intact');

-- A direct mobile/step edit need not bump the task version: the step baseline still protects it.
update public.manufacturing_steps set instruction='Other device edit' where id='awi-save-second';
select throws_ok($$select public.test_awi_save_apply(jsonb_set((select payload from awi_save_inputs where name='base'),'{p_task_patch,description}','"Stale snapshot"'))$$,
 'PT409',null,'changed step version is rejected even with a current task version');
select is((select instruction from public.manufacturing_steps where id='awi-save-second'),'Other device edit','conflict keeps the other device edit');
-- Omitting an unseen row cannot delete it, even when its version was not present in the browser.
select throws_ok($$select public.test_awi_save_apply(jsonb_set(jsonb_set((select payload from awi_save_inputs where name='base'),'{p_steps}',jsonb_build_array((select payload->'p_steps'->0 from awi_save_inputs where name='base'))),'{p_expected_step_versions}','{}'))$$,
 'PT409',null,'incomplete step baseline cannot remove unseen rows');
select is((select count(*) from public.manufacturing_steps where task_id=(select payload#>>'{}' from awi_save_inputs where name='task')),2::bigint,'both steps survive incomplete input');

update awi_save_inputs set payload=public.test_awi_save_payload((select payload#>>'{}' from awi_save_inputs where name='task')) where name='base';
update public.part_references set quantity=3 where id='awi-save-part';
select throws_ok($$select public.test_awi_save_apply(jsonb_set((select payload from awi_save_inputs where name='base'),'{p_task_patch,description}','"Part conflict"'))$$,
 'PT409',null,'unversioned part edits are protected by the confirmed baseline');
select is((select quantity from public.part_references where id='awi-save-part'),3::numeric,'part conflict keeps newer quantity');
update awi_save_inputs set payload=public.test_awi_save_payload((select payload#>>'{}' from awi_save_inputs where name='task')) where name='base';
select lives_ok($$select public.test_awi_save_apply(jsonb_set(jsonb_set((select payload from awi_save_inputs where name='base'),'{p_steps,0,sequence}','20'),'{p_steps,1,sequence}','10'))$$,
 'reordering two steps succeeds without unique-key collisions');
select is((select sequence from public.manufacturing_steps where id='awi-save-second'),10,'new order persisted');
select is((select count(*) from public.step_photos where id='awi-save-photo'),1::bigint,'reordering preserves the photo record');
select is((select count(*) from public.step_tools where id='awi-save-tool'),1::bigint,'reordering preserves the tool record');

-- Caller cannot smuggle planning fields, forge a document identity, or move a child from another task.
update awi_save_inputs set payload=public.test_awi_save_payload((select payload#>>'{}' from awi_save_inputs where name='task')) where name='base';
select throws_ok($$select public.test_awi_save_apply(jsonb_set((select payload from awi_save_inputs where name='base'),'{p_task_patch,planned_operators}','99'))$$,
 '22023',null,'planning fields cannot be written by procedure saves');
select throws_ok($$select public.test_awi_save_apply(jsonb_set((select payload from awi_save_inputs where name='base'),'{p_task_patch,custom_fields,awiDocumentNumber}','"FORGED"'))$$,
 '22023',null,'document identity remains unchanged');
select throws_ok($$select public.test_awi_save_apply(jsonb_set((select payload from awi_save_inputs where name='base'),'{p_steps,0,task_id}','"other-task"'))$$,
 '22023',null,'cross-task child payload is rejected');
select throws_ok($$select public.test_awi_save_apply((select payload - 'p_parts' from awi_save_inputs where name='base'))$$,
 '22023',null,'missing parts payload cannot clear the saved parts');

select public.test_awi_save_as('a7200000-0000-0000-0000-000000000002');
select throws_ok($$select public.test_awi_save_apply((select payload from awi_save_inputs where name='base'))$$,
 '42501',null,'another editor cannot save a private master');
reset role;
insert into public.project_access(project_id,user_id,level)
 select payload->>'p_project_id','a7200000-0000-0000-0000-000000000003','view'
 from awi_save_inputs where name='base';
select public.test_awi_save_as('a7200000-0000-0000-0000-000000000003');
select throws_ok($$select public.test_awi_save_apply((select payload from awi_save_inputs where name='base'))$$,
 '42501',null,'read-only access does not grant AWI save access');
reset role;
select ok(not has_function_privilege('anon','public.save_awi_procedure(text,text,integer,jsonb,jsonb,jsonb,jsonb,jsonb)','EXECUTE'),'anonymous save execution is revoked');
select ok(not (select prosecdef from pg_proc where oid='public.save_awi_procedure(text,text,integer,jsonb,jsonb,jsonb,jsonb,jsonb)'::regprocedure),'save runs with caller RLS');
select is((select count(*) from public.manufacturing_steps where task_id=(select payload#>>'{}' from awi_save_inputs where name='task')),2::bigint,'all saved steps survive rejected requests');
select is((select document_number from public.awi_masters where task_id=(select payload#>>'{}' from awi_save_inputs where name='task')),'ATOMIC-001','document number survives all edits');
select is((select count(*) from public.work_instruction_releases where task_id=(select payload#>>'{}' from awi_save_inputs where name='task')),0::bigint,'draft saving does not publish a release');
select public.test_awi_save_as('a7200000-0000-0000-0000-000000000001');
select throws_ok($$select public.test_awi_save_apply(jsonb_set((select payload from awi_save_inputs where name='base'),'{p_project_id}','"other-project"'))$$,
 '42501',null,'active project scope cannot be changed by the caller');
select lives_ok($$select public.test_awi_save_apply(jsonb_set((select payload from awi_save_inputs where name='base'),'{p_steps}',
 (select payload->'p_steps' from awi_save_inputs where name='base') || jsonb_build_array(jsonb_build_object(
 'id','awi-save-new','task_id',(select payload->>'p_task_id' from awi_save_inputs where name='base'),
 'sequence',30,'name','New step','instruction','Added','duration_minutes',0,'quality_check',null,'dependency_ids','[]'::jsonb))))$$,
 'new step is added in the same transaction');
select is((select count(*) from public.manufacturing_steps where task_id=(select payload#>>'{}' from awi_save_inputs where name='task')),3::bigint,'adding retains every existing step');
update awi_save_inputs set payload=public.test_awi_save_payload((select payload#>>'{}' from awi_save_inputs where name='task')) where name='base';
select lives_ok($$select public.test_awi_save_apply(jsonb_set(jsonb_set((select payload from awi_save_inputs where name='base'),'{p_steps}',
 (select jsonb_agg(x) from awi_save_inputs,jsonb_array_elements(payload->'p_steps') x where name='base' and x->>'id'<>'awi-save-new')),'{p_parts}','[]'))$$,
 'user-requested removals use the confirmed baseline');
select is((select count(*) from public.manufacturing_steps where id='awi-save-new'),0::bigint,'only the removed step is deleted');
select is((select count(*) from public.step_photos where id='awi-save-photo'),1::bigint,'removing another step keeps existing attachments');
select is((select count(*) from public.part_references where id='awi-save-part'),0::bigint,'confirmed part removal is applied');

-- A longer AWI still changes just one step; all rows appear in the acknowledgement.
select public.create_awi_master('ws_awi_save_ci','Long instruction','ATOMIC-LONG');
insert into public.manufacturing_steps(id,task_id,sequence,name,instruction)
 select 'awi-long-'||i,m.task_id,i+10,'Step '||i,'Unchanged'
 from public.awi_masters m cross join generate_series(1,1202) i where m.document_number='ATOMIC-LONG';
insert into awi_save_inputs values('long',public.test_awi_save_payload((select task_id from public.awi_masters where document_number='ATOMIC-LONG')));
insert into awi_save_inputs values('long_ack',public.save_awi_procedure(
 (select payload->>'p_task_id' from awi_save_inputs where name='long'),
 (select payload->>'p_project_id' from awi_save_inputs where name='long'),
 (select (payload->>'p_expected_version')::integer from awi_save_inputs where name='long'),
 (select payload->'p_expected_step_versions' from awi_save_inputs where name='long'),'[]',
 (select payload->'p_task_patch' from awi_save_inputs where name='long'),
 (select jsonb_set(payload->'p_steps','{1202,instruction}','"Last step edited"') from awi_save_inputs where name='long'),'[]'));
select is((select jsonb_array_length(payload->'steps') from awi_save_inputs where name='long_ack'),1203,'acknowledgement includes every step beyond the API page cap');
select is((select count(*) from public.manufacturing_steps where task_id=(select payload->>'p_task_id' from awi_save_inputs where name='long') and version=1),1202::bigint,'long instruction leaves all 1202 unchanged step versions intact');
select is((select instruction from public.manufacturing_steps where id='awi-long-1202'),'Last step edited','late-page step is saved correctly');
select * from finish();
rollback;
