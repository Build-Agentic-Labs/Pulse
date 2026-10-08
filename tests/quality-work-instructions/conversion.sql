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
create function public.wi_test_claim(n integer default 1) returns boolean language sql as $$
 select public.begin_quality_wi_conversion(('e7500000-0000-0000-0000-'||lpad(n::text,12,'0'))::uuid,'wi-test-ws','wi-test-pro','users/e7100000-0000-0000-0000-000000000001/wi-test-ws/source.docx','Original.docx');
$$;
create function public.wi_test_payload() returns jsonb language sql as $$ select '{
 "title":"Delivery Photos","purpose":"Capture deliveries","responsibilities":"Operator",
 "steps":[{"id":"e7300000-0000-0000-0000-000000000001","title":"Record serial number","instruction":"Photograph the plate.","image":{"id":"e7400000-0000-0000-0000-000000000001","stepId":"e7300000-0000-0000-0000-000000000001","sourceImageId":"img1","name":"Record serial number.jpg","storagePath":"wi-test-ws/e7500000-0000-0000-0000-000000000001/e7300000-0000-0000-0000-000000000001/e7400000-0000-0000-0000-000000000001.jpg","width":500,"height":400}}],
 "uploads":[{"id":"e7400000-0000-0000-0000-000000000001","stepId":"e7300000-0000-0000-0000-000000000001","sourceImageId":"img1","name":"Record serial number.jpg","storagePath":"wi-test-ws/e7500000-0000-0000-0000-000000000001/e7300000-0000-0000-0000-000000000001/e7400000-0000-0000-0000-000000000001.jpg","width":500,"height":400}],
 "source":{"metadata":{"author":"Legacy Author","documentNumber":"FIP-00001","revision":"C"},"warnings":[]}
 }'::jsonb $$;
create function public.wi_test_prepare(p jsonb default public.wi_test_payload()) returns void language sql as $$ select public.prepare_quality_wi_conversion('e7500000-0000-0000-0000-000000000001',p) $$;
create function public.wi_test_import() returns jsonb language sql as $$ select public.import_quality_wi_conversion('e7500000-0000-0000-0000-000000000001','Delivery Photos','Capture deliveries','Operator') $$;
select ok(not has_function_privilege('anon','public.begin_quality_wi_conversion(uuid,text,text,text,text)','EXECUTE'),'anonymous has no conversion grant');
select public.wi_test_actor(0);
select throws_ok($$select public.wi_test_claim()$$,'42501',null,'unauthenticated conversion denied');
select public.wi_test_actor(2);
select throws_ok($$select public.wi_test_claim()$$,'42501',null,'viewer cannot convert');
select public.wi_test_actor(3);
select throws_ok($$select public.wi_test_claim()$$,'42501',null,'different department editor denied');
select public.wi_test_actor(4);
select throws_ok($$select public.wi_test_claim()$$,'42501',null,'different workspace denied');
select public.wi_test_actor(1);
select throws_ok($$select public.begin_quality_wi_conversion(gen_random_uuid(),'wi-test-ws','wi-test-pro',null,'x.docx')$$,'22023',null,'null source rejected');
select throws_ok($$select public.begin_quality_wi_conversion(gen_random_uuid(),'wi-test-ws','wi-test-pro','users/another/wi-test-ws/source.docx','x.docx')$$,'22023',null,'another author source rejected');
select is(public.wi_test_claim(),true,'claim succeeds');
select is(public.wi_test_claim(),false,'same claim retries without another analysis');
select throws_ok($$select public.begin_quality_wi_conversion('e7500000-0000-0000-0000-000000000001','wi-test-ws','wi-test-pro','users/e7100000-0000-0000-0000-000000000001/wi-test-ws/other.docx','Other.docx')$$,'42501',null,'cannot substitute source for existing claim');
select throws_ok($$select public.wi_test_import()$$,'22023',null,'cannot import an unfinished conversion');
select throws_ok($$select public.wi_test_prepare(public.wi_test_payload()-'title')$$,'22023',null,'missing title rejected');
select throws_ok($$select public.wi_test_prepare(jsonb_set(public.wi_test_payload(),'{steps}','[]'))$$,'22023',null,'empty procedure rejected');
select throws_ok($$select public.wi_test_prepare(jsonb_set(public.wi_test_payload(),'{uploads,0,storagePath}','"another/path.jpg"'))$$,'22023',null,'cross-document image path rejected');
select throws_ok($$select public.wi_test_prepare(jsonb_set(public.wi_test_payload(),'{steps,0,image,name}','"Spoofed.jpg"'))$$,'22023',null,'image must exactly match reserved image');
select throws_ok($$select public.wi_test_prepare(jsonb_set(public.wi_test_payload(),'{steps}',(public.wi_test_payload()->'steps')||(public.wi_test_payload()->'steps')))$$,'22023',null,'duplicate steps rejected');
select lives_ok($$select public.wi_test_prepare()$$,'prepare valid result');
select lives_ok($$select public.wi_test_prepare()$$,'prepare retry idempotent');
select throws_ok($$select public.wi_test_prepare(jsonb_set(public.wi_test_payload(),'{title}','"Changed"'))$$,'22023',null,'prepared result immutable');
select ok(public.quality_wi_conversion_image_access(public.wi_test_payload()->'uploads'->0->>'storagePath',true),'owner may upload reserved image');
select ok(not public.quality_wi_conversion_image_access('wi-test-ws/e7500000-0000-0000-0000-000000000001/extra.jpg',true),'unreserved image denied');
select throws_ok($$select public.finish_quality_wi_conversion('e7500000-0000-0000-0000-000000000001')$$,'22023',null,'missing images prevent ready state');
select public.wi_test_actor(3);
select is((select count(*)::integer from public.quality_wi_conversions),0,'another author cannot read private results');
select ok(not public.quality_wi_conversion_image_access(public.wi_test_payload()->'uploads'->0->>'storagePath',false),'another author cannot preview reserved image');
select throws_ok($$select public.wi_test_prepare()$$,'42501',null,'another author cannot finish conversion');
select public.wi_test_actor(1);
insert into storage.objects(bucket_id,name,owner_id) values('quality-wi-images',public.wi_test_payload()->'uploads'->0->>'storagePath',auth.uid()::text);
select lives_ok($$select public.finish_quality_wi_conversion('e7500000-0000-0000-0000-000000000001')$$,'all images uploaded allows review');
select ok(not public.quality_wi_conversion_image_access(public.wi_test_payload()->'uploads'->0->>'storagePath',true),'ready image cannot be overwritten');
select public.wi_test_actor(0);
create function public.wi_test_fail_step() returns trigger language plpgsql as $$ begin raise exception 'injected failure'; end $$;
create trigger wi_test_fail_step before insert on public.quality_wi_steps for each row execute function public.wi_test_fail_step();
select public.wi_test_actor(1);
select throws_ok($$select public.wi_test_import()$$,'P0001','injected failure','step failure rolls back entire import');
select public.wi_test_actor(0);
select is((select count(*)::integer from public.quality_work_instructions where id='e7500000-0000-0000-0000-000000000001'),0,'no partial WI remains');
drop trigger wi_test_fail_step on public.quality_wi_steps;
select public.wi_test_actor(1);
select lives_ok($$select public.wi_test_import()$$,'retry imports complete draft');
select lives_ok($$select public.wi_test_import()$$,'lost-response retry succeeds without duplicates');
select is((select count(*)::integer from public.quality_work_instructions where id='e7500000-0000-0000-0000-000000000001'),1,'one draft created');
select is((select created_by::text from public.quality_work_instructions where id='e7500000-0000-0000-0000-000000000001'),auth.uid()::text,'signed-in user is author');
select is((select conversion_source->'metadata'->>'author' from public.quality_work_instructions where id='e7500000-0000-0000-0000-000000000001'),'Legacy Author','original author retained as source metadata');
select is((select document_number from public.quality_work_instructions where id='e7500000-0000-0000-0000-000000000001'),null::text,'legacy document number never becomes new WI number');
select is((select count(*)::integer from public.quality_wi_steps where wi_id='e7500000-0000-0000-0000-000000000001'),1,'all steps imported');
select is((select position from public.quality_wi_steps where wi_id='e7500000-0000-0000-0000-000000000001'),1,'sequence starts at one');
select lives_ok($$select public.delete_quality_wi('e7500000-0000-0000-0000-000000000001','wi-test-ws',1,auth.uid())$$,'author retains hard-delete ability');
select throws_ok($$select public.wi_test_import()$$,'22023',null,'import retry cannot resurrect a deleted draft');
select is(public.wi_test_claim(2),true,'second conversion allowed');
select is(public.wi_test_claim(3),true,'third conversion allowed');
select throws_ok($$select public.wi_test_claim(4)$$,'P0001',null,'distributed rate limit rejects fourth conversion');
select * from finish();
rollback;
