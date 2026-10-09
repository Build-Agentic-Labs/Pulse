-- Master authoring, recovery metadata, fixed revisions and project isolation.
begin;
select plan(18);
insert into public.workspaces(id,name) values('ws_awi_ci','AWI CI');
insert into public.workspace_auto_join_domains(domain,workspace_id) values('awi-ci.test','ws_awi_ci');
insert into auth.users(id,aud,role,email) values
 ('a7100000-0000-0000-0000-000000000001','authenticated','authenticated','one@awi-ci.test'),
 ('a7100000-0000-0000-0000-000000000002','authenticated','authenticated','two@awi-ci.test'),
 ('a7100000-0000-0000-0000-000000000003','authenticated','authenticated','viewer@awi-ci.test');
insert into public.workspace_members(workspace_id,user_id,role) values
 ('ws_awi_ci','a7100000-0000-0000-0000-000000000001','editor'),
 ('ws_awi_ci','a7100000-0000-0000-0000-000000000002','editor'),
 ('ws_awi_ci','a7100000-0000-0000-0000-000000000003','viewer');
insert into public.product_module_access(workspace_id,user_id,level) values
('ws_awi_ci','a7100000-0000-0000-0000-000000000001','edit'),
('ws_awi_ci','a7100000-0000-0000-0000-000000000002','edit'),
('ws_awi_ci','a7100000-0000-0000-0000-000000000003','view');
create or replace function test_as(p_uid text) returns void language plpgsql as $$
begin
 perform set_config('request.jwt.claims',json_build_object('sub',p_uid,'role','authenticated')::text,true);
 execute 'set local role authenticated';
end $$;
select test_as('a7100000-0000-0000-0000-000000000001');
select lives_ok($$select public.create_awi_master('ws_awi_ci','Shared install','')$$,'editor creates a master draft');
select is((select document_number from public.awi_masters where workspace_id='ws_awi_ci'),'AWI-0001','automatic document identity');
select ok((select published_at is null and published_release_id is null from public.awi_masters where workspace_id='ws_awi_ci'),'starts unpublished');
select ok((select p.is_awi_master from public.projects p join public.awi_masters m on m.project_id=p.id where m.workspace_id='ws_awi_ci'),'backing project stays distinguishable from products');
select is((select count(*) from public.manufacturing_steps s join public.awi_masters m on m.task_id=s.task_id where m.workspace_id='ws_awi_ci'),1::bigint,'blank procedure step saved atomically');
select throws_ok($$select public.create_awi_master('ws_awi_ci','Duplicate','awi-0001')$$,'23505',null,'document identity rejects case-insensitive duplicates');
select is((select count(*) from public.projects where workspace_id='ws_awi_ci'),1::bigint,'duplicate creation leaves no orphan');
update public.manufacturing_steps set instruction='Original instruction' where task_id=(select task_id from public.awi_masters where workspace_id='ws_awi_ci');
select ok((select draft_updated_at>created_at from public.awi_masters where workspace_id='ws_awi_ci'),'procedure edits update master draft metadata');
insert into public.work_instruction_releases(project_id,task_id,change_description,effective_date,content,content_hash)
 select project_id,task_id,'Initial',current_date,'{"instruction":"Original instruction"}'::jsonb,'v1:awi-ci' from public.awi_masters where workspace_id='ws_awi_ci';
select ok((select published_at is not null and published_release_id is not null from public.awi_masters where workspace_id='ws_awi_ci'),'publishing pins release metadata');
update public.manufacturing_steps set instruction='New draft' where task_id=(select task_id from public.awi_masters where workspace_id='ws_awi_ci');
select ok((select draft_updated_at>published_at from public.awi_masters where workspace_id='ws_awi_ci'),'later changes remain a draft');
select is((select r.content->>'instruction' from public.work_instruction_releases r join public.awi_masters m on m.published_release_id=r.id where m.workspace_id='ws_awi_ci'),'Original instruction','published copy does not change with the draft');
select test_as('a7100000-0000-0000-0000-000000000002');
select is((select count(*) from public.awi_masters where workspace_id='ws_awi_ci'),1::bigint,'another Product editor sees the shared master');
select lives_ok($$select public.create_awi_master('ws_awi_ci','Other install','')$$,'second editor creates despite hidden first master');
select is((select document_number from public.awi_masters where workspace_id='ws_awi_ci' and title='Other install'),'AWI-0002','number allocation includes hidden masters');
select test_as('a7100000-0000-0000-0000-000000000003');
select throws_ok($$select public.create_awi_master('ws_awi_ci','Viewer install','')$$,'P0001','You do not have permission to create AWIs in this organization.','viewer cannot create a master');
select ok(not has_table_privilege('authenticated','public.sop_approver_delivery_payloads','SELECT'),'seed preserves private delivery payload revokes');
select ok(not has_function_privilege('anon','public.create_awi_master(text,text,text)','EXECUTE'),'anonymous callers cannot create master drafts');
reset role;
select ok(not has_function_privilege('authenticated','private.awi_publish_release()','EXECUTE'),'clients cannot forge master publication through its trigger function');
select * from finish();
rollback;
