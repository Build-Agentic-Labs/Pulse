-- Local-only until user acceptance; fixtures and injected failures roll back.
begin;
create extension if not exists pgtap with schema extensions;
set local search_path=public,extensions;
select no_plan();
insert into public.workspaces(id,name) values('wi-test-ws','WI tests'),('wi-test-other','Other organization');
insert into public.workspace_auto_join_domains(domain,workspace_id) values('wi-test.local','wi-test-ws'),('wi-other.local','wi-test-other');
insert into auth.users(id,aud,role,email) values
 ('e7100000-0000-0000-0000-000000000001','authenticated','authenticated','author@wi-test.local'),
 ('e7100000-0000-0000-0000-000000000002','authenticated','authenticated','viewer@wi-test.local'),
 ('e7100000-0000-0000-0000-000000000003','authenticated','authenticated','other-dept@wi-test.local'),
 ('e7100000-0000-0000-0000-000000000004','authenticated','authenticated','outsider@wi-other.local');
update public.profiles set full_name='Original Author' where id='e7100000-0000-0000-0000-000000000001';
insert into public.workspace_members(workspace_id,user_id,role) values
 ('wi-test-ws','e7100000-0000-0000-0000-000000000001','editor'),('wi-test-ws','e7100000-0000-0000-0000-000000000002','viewer'),
 ('wi-test-ws','e7100000-0000-0000-0000-000000000003','editor'),('wi-test-other','e7100000-0000-0000-0000-000000000004','editor')
 on conflict(workspace_id,user_id) do update set role=excluded.role;
insert into public.org_tool_access(workspace_id,user_id,level) values
 ('wi-test-ws','e7100000-0000-0000-0000-000000000001','edit'),('wi-test-ws','e7100000-0000-0000-0000-000000000002','view'),
 ('wi-test-ws','e7100000-0000-0000-0000-000000000003','edit'),('wi-test-other','e7100000-0000-0000-0000-000000000004','edit') on conflict(workspace_id,user_id) do update set level=excluded.level;
insert into public.departments(id,workspace_id,code,name) values('wi-test-pro','wi-test-ws','WIP','WI process'),('wi-test-pur','wi-test-ws','WIB','WI purchasing');
insert into public.department_members(department_id,user_id) values('wi-test-pro','e7100000-0000-0000-0000-000000000001'),('wi-test-pro','e7100000-0000-0000-0000-000000000002'),('wi-test-pur','e7100000-0000-0000-0000-000000000003');
create function public.wi_test_actor(n integer) returns void language plpgsql as $$ begin
 execute 'reset role';
 perform set_config('request.jwt.claims',case when n=0 then '{}' else jsonb_build_object('sub','e7100000-0000-0000-0000-'||lpad(n::text,12,'0'),'role','authenticated')::text end,true);
 if n>0 then execute 'set local role authenticated'; end if;
end $$;
create function public.wi_test_edit(k text,p jsonb,o uuid default gen_random_uuid(),v integer default null) returns jsonb language sql as $$
 select public.edit_quality_wi('e7200000-0000-0000-0000-000000000001',coalesce(v,(select version from public.quality_work_instructions where id='e7200000-0000-0000-0000-000000000001')),o,k,p,auth.uid());
$$;
create function public.wi_test_publish(o uuid default gen_random_uuid(),v integer default null) returns jsonb language sql as $$
 select public.publish_quality_wi('e7200000-0000-0000-0000-000000000001',coalesce(v,(select version from public.quality_work_instructions where id='e7200000-0000-0000-0000-000000000001')),o,'Release',auth.uid());
$$;

select public.wi_test_actor(1);
select lives_ok($$select public.create_quality_wi('e7200000-0000-0000-0000-000000000001','wi-test-ws','wi-test-pro',auth.uid())$$,'author creates draft');
select lives_ok($$select public.wi_test_edit('details','{"title":"Delete fixture","purpose":"Scope","responsibilities":"Author"}')$$,'prepare publishable details');
select lives_ok($$select public.wi_test_edit('add_step','{"id":"e7300000-0000-0000-0000-000000000001","title":"Step","instruction":"Perform task"}')$$,'prepare step');
select lives_ok($$select public.wi_test_publish()$$,'prepare published revision');
select public.wi_test_actor(0);
select ok(not has_function_privilege('anon','public.delete_quality_wi(uuid,text,integer,uuid)','EXECUTE'),'anonymous has no delete RPC grant');
select throws_ok($$select public.delete_quality_wi('e7200000-0000-0000-0000-000000000001','wi-test-ws',4,'e7100000-0000-0000-0000-000000000001')$$,'42501',null,'unauthenticated delete rejected');
select public.wi_test_actor(3);
select throws_ok($$select public.delete_quality_wi('e7200000-0000-0000-0000-000000000001','wi-test-ws',4,auth.uid())$$,'42501',null,'other author cannot delete');
select throws_ok($$select public.delete_quality_wi('e7200000-0000-0000-0000-000000000001','wi-test-ws',4,'e7100000-0000-0000-0000-000000000001')$$,'42501',null,'spoofed author rejected');
select public.wi_test_actor(0);
update public.workspace_members set role='owner' where workspace_id='wi-test-ws' and user_id='e7100000-0000-0000-0000-000000000003';
select public.wi_test_actor(3);
select throws_ok($$select public.delete_quality_wi('e7200000-0000-0000-0000-000000000001','wi-test-ws',4,auth.uid())$$,'42501',null,'non-author owner cannot delete');
select public.wi_test_actor(1);
select throws_ok($$select public.delete_quality_wi('e7200000-0000-0000-0000-000000000001','wi-test-other',4,auth.uid())$$,'42501',null,'wrong workspace rejected');
select throws_ok($$select public.delete_quality_wi('e7200000-0000-0000-0000-000000000001','wi-test-ws',1,auth.uid())$$,'PT409',null,'stale list cannot delete changed WI');
select public.wi_test_actor(0);
select throws_ok($$delete from public.quality_wi_revisions where wi_id='e7200000-0000-0000-0000-000000000001'$$,'42501',null,'standalone revision deletion remains forbidden');
select is((select count(*)::integer from public.quality_work_instructions where id='e7200000-0000-0000-0000-000000000001'),1,'rejected deletes leave document intact');
-- Original author may delete even without department membership or Quality edit access.
delete from public.department_members where user_id='e7100000-0000-0000-0000-000000000001';
update public.org_tool_access set level='view' where user_id='e7100000-0000-0000-0000-000000000001';
select public.wi_test_actor(1);
select lives_ok($$select public.delete_quality_wi('e7200000-0000-0000-0000-000000000001','wi-test-ws',4,auth.uid())$$,'original author hard-deletes without Quality approval or edit access');
select lives_ok($$select public.delete_quality_wi('e7200000-0000-0000-0000-000000000001','wi-test-ws',4,auth.uid())$$,'lost-response retry is safe');
select is(public.load_quality_wi_document('e7200000-0000-0000-0000-000000000001','wi-test-ws'),null::jsonb,'deleted WI cannot reopen');
select throws_ok($$select public.edit_quality_wi('e7200000-0000-0000-0000-000000000001',4,gen_random_uuid(),'details','{"title":"resurrect"}',auth.uid())$$,'42501',null,'open editor cannot save deleted WI');
select throws_ok($$select public.publish_quality_wi('e7200000-0000-0000-0000-000000000001',4,gen_random_uuid(),'Release',auth.uid())$$,'42501',null,'open editor cannot publish deleted WI');
select public.wi_test_actor(0);
select is((select count(*)::integer from public.quality_work_instructions where id='e7200000-0000-0000-0000-000000000001'),0,'parent physically removed');
select is((select count(*)::integer from public.quality_wi_steps where wi_id='e7200000-0000-0000-0000-000000000001'),0,'steps physically removed');
select is((select count(*)::integer from public.quality_wi_revisions where wi_id='e7200000-0000-0000-0000-000000000001'),0,'revisions physically removed');
select is((select count(*)::integer from public.quality_wi_operations where wi_id='e7200000-0000-0000-0000-000000000001'),0,'operation receipts physically removed');
select * from finish();
rollback;
