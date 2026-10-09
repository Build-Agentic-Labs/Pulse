begin;
select no_plan();
insert into public.workspaces(id,name) values('product_rbac_a','Product RBAC A'),('product_rbac_b','Product RBAC B');
insert into public.workspace_auto_join_domains(domain,workspace_id) values('product-rbac.test','product_rbac_a');
insert into auth.users(id,aud,role,email,email_confirmed_at)
select ('a9200000-0000-0000-0000-'||lpad(n::text,12,'0'))::uuid,'authenticated','authenticated','user'||n||'@product-rbac.test',now() from generate_series(1,7) n;
insert into public.workspace_members(workspace_id,user_id,role)
select 'product_rbac_a',('a9200000-0000-0000-0000-'||lpad(n::text,12,'0'))::uuid,
(case n when 1 then 'owner' when 2 then 'viewer' else 'editor' end)::public.workspace_role from generate_series(1,6) n
on conflict(workspace_id,user_id) do update set role=excluded.role;
insert into public.workspace_members(workspace_id,user_id,role) values('product_rbac_b','a9200000-0000-0000-0000-000000000007','owner');
insert into public.product_module_access(workspace_id,user_id,level) values
('product_rbac_a','a9200000-0000-0000-0000-000000000002','edit'),
('product_rbac_a','a9200000-0000-0000-0000-000000000003','view'),
('product_rbac_a','a9200000-0000-0000-0000-000000000005','edit');
create function pg_temp.product_as(n integer) returns void language plpgsql as $$ begin
 perform set_config('request.jwt.claims',jsonb_build_object('sub','a9200000-0000-0000-0000-'||lpad(n::text,12,'0'),'role','authenticated','email','user'||n||'@product-rbac.test')::text,true);
 execute 'set local role authenticated';
end $$;
select pg_temp.product_as(2);
select is(public.product_access_level('product_rbac_a'),'edit'::public.access_level,'module Edit overrides generic member role');
select lives_ok($$select public.create_awi_master('product_rbac_a','Shared assembly','AWI-RBAC-1')$$,'Product editor creates AWI');
select lives_ok($$select public.create_project_with_starter_plan('product_rbac_a','Shared generator')$$,'Product editor creates product');
select is((select count(*) from public.project_access pa join public.projects p on p.id=pa.project_id where p.workspace_id='product_rbac_a'),0::bigint,'creation does not generate individual project grants');
select is((select count(*) from public.projects where workspace_id='product_rbac_a'),2::bigint,'creator sees all Product projects');
select pg_temp.product_as(3);
select is((select count(*) from public.awi_masters where workspace_id='product_rbac_a'),1::bigint,'different Product viewer sees master draft');
select is((select count(*) from public.projects where workspace_id='product_rbac_a'),2::bigint,'viewer sees every product without project grants');
select is((select count(*) from public.manufacturing_steps s join public.awi_masters a on a.task_id=s.task_id where a.workspace_id='product_rbac_a'),1::bigint,'viewer reads procedure graph');
with changed as (update public.projects set name='Denied rename' where workspace_id='product_rbac_a' returning id) select is(count(*),0::bigint,'viewer cannot rename') from changed;
with changed as (update public.manufacturing_steps set instruction='Denied edit' where task_id in(select task_id from public.awi_masters where workspace_id='product_rbac_a') returning id) select is(count(*),0::bigint,'viewer cannot update instruction') from changed;
select throws_ok($$select public.create_awi_master('product_rbac_a','Denied AWI','')$$,'P0001',null,'viewer cannot create AWI');
select throws_ok($$select public.create_project_with_starter_plan('product_rbac_a','Denied product')$$,'42501',null,'viewer cannot create product');
select throws_ok($$insert into public.product_module_access(workspace_id,user_id,level) values('product_rbac_a','a9200000-0000-0000-0000-000000000003','edit') on conflict(workspace_id,user_id) do update set level=excluded.level$$,'42501',null,'viewer cannot elevate permission');
select ok(not public.has_space_access('product_rbac_a','planning'),'Product access does not grant Planning');
select ok(not public.has_org_tool_access('product_rbac_a','view'),'Product access does not grant Quality');
select pg_temp.product_as(5);
with changed as (update public.manufacturing_steps set instruction='Shared edit' where task_id in(select task_id from public.awi_masters where workspace_id='product_rbac_a') returning id) select is(count(*),1::bigint,'another Product editor edits creator instruction') from changed;
select lives_ok($$insert into public.work_instruction_releases(project_id,task_id,change_description,effective_date,content,content_hash) select project_id,task_id,'Initial',current_date,'{"instruction":"Shared edit"}','v1:product-rbac' from public.awi_masters where workspace_id='product_rbac_a'$$,'Product editor publishes another user instruction');
select pg_temp.product_as(3);
select is((select count(*) from public.work_instruction_releases r join public.projects p on p.id=r.project_id where p.workspace_id='product_rbac_a'),1::bigint,'viewer reads published revision');
select pg_temp.product_as(4);
select is((select count(*) from public.projects where workspace_id='product_rbac_a'),0::bigint,'generic editor without Product cannot read');
select throws_ok($$select public.create_awi_master('product_rbac_a','Denied editor AWI','')$$,'P0001',null,'generic editor cannot create AWI');
select pg_temp.product_as(7);
select is((select count(*) from public.awi_masters where workspace_id='product_rbac_a'),0::bigint,'another organization owner cannot read');
reset role;
insert into public.project_access(project_id,user_id,level) select id,'a9200000-0000-0000-0000-000000000004','edit' from public.projects where workspace_id='product_rbac_a';
select pg_temp.product_as(4);
select is((select count(*) from public.projects where workspace_id='product_rbac_a'),0::bigint,'legacy grants do not bypass Product revocation');
select pg_temp.product_as(1);
select is(public.product_access_level('product_rbac_a'),'edit'::public.access_level,'owner inherits Product Edit');
select lives_ok($$update public.product_module_access set level='none' where workspace_id='product_rbac_a' and user_id='a9200000-0000-0000-0000-000000000005'$$,'owner revokes module access');
select pg_temp.product_as(5);
select is((select count(*) from public.awi_masters where workspace_id='product_rbac_a'),0::bigint,'revocation immediately hides all AWIs');
reset role;
insert into public.workspace_access_grants(workspace_id,email,role,product_access,granted_by) values('product_rbac_a','user6@product-rbac.test','editor','view','a9200000-0000-0000-0000-000000000001');
select pg_temp.product_as(6);
select lives_ok('select public.redeem_workspace_access_grants()','invitation redeems Product level');
select is(public.product_access_level('product_rbac_a'),'view'::public.access_level,'invitation grants module View');
select pg_temp.product_as(1);
update public.product_module_access set level='none' where workspace_id='product_rbac_a' and user_id='a9200000-0000-0000-0000-000000000006';
select pg_temp.product_as(6);
select public.redeem_workspace_access_grants();
select is(public.product_access_level('product_rbac_a'),'none'::public.access_level,'repeated redemption does not restore revoked access');
select pg_temp.product_as(1);
select lives_ok($$select public.remove_workspace_member('product_rbac_a','a9200000-0000-0000-0000-000000000003')$$,'owner removes Product member');
select pg_temp.product_as(3);
select is(public.product_access_level('product_rbac_a'),'none'::public.access_level,'removed member loses Product access');
reset role;
select is((select count(*) from public.product_module_access where workspace_id='product_rbac_a' and user_id='a9200000-0000-0000-0000-000000000003'),0::bigint,'offboarding cascades grant cleanup');
select ok(not has_function_privilege('anon','public.product_access_level(text)','EXECUTE'),'anonymous cannot call Product permission RPC');
select ok(exists(select 1 from public.audit_log where workspace_id='product_rbac_a' and target_type='product_module_access'),'grant changes audited');
-- File policies follow the same module level and validate organization paths.
reset role;
insert into storage.objects(bucket_id,name)
select 'step-photos','workspaces/product_rbac_a/projects/'||id||'/shared.png' from public.projects where workspace_id='product_rbac_a';
insert into storage.objects(bucket_id,name)
select 'step-photos','workspaces/product_rbac_b/projects/'||id||'/forged.png' from public.projects where workspace_id='product_rbac_a';
select pg_temp.product_as(2);
select is((select count(*) from storage.objects where name like 'workspaces/product_rbac_a/%'),2::bigint,'module editor reads files across Product projects');
select is((select count(*) from storage.objects where name like 'workspaces/product_rbac_b/%'),0::bigint,'forged organization path is denied');
reset role;
update public.product_module_access set level='view' where workspace_id='product_rbac_a' and user_id='a9200000-0000-0000-0000-000000000002';
select pg_temp.product_as(2);
select is((select count(*) from storage.objects where name like 'workspaces/product_rbac_a/%'),2::bigint,'module viewer reads Product attachments');
select throws_ok($$insert into storage.objects(bucket_id,name) select 'step-photos','workspaces/product_rbac_a/projects/'||id||'/denied.png' from public.projects where workspace_id='product_rbac_a' limit 1$$,'42501',null,'module viewer cannot upload');
select throws_ok($$insert into public.work_instruction_releases(project_id,task_id,change_description,effective_date,content,content_hash) select project_id,task_id,'Denied release',current_date,'{}','v1:denied' from public.awi_masters where workspace_id='product_rbac_a'$$,'42501',null,'module viewer cannot publish through direct API');
reset role;
select pg_temp.product_as(1);
select ok(not public.has_product_access('product_rbac_a','none'),'None is not an authorization threshold');
reset role;
update public.workspace_members set role='owner' where workspace_id='product_rbac_a' and user_id='a9200000-0000-0000-0000-000000000004';
update public.workspace_members set role='editor' where workspace_id='product_rbac_a' and user_id='a9200000-0000-0000-0000-000000000001';
select pg_temp.product_as(1);
select is(public.product_access_level('product_rbac_a'),'none'::public.access_level,'demotion removes inherited manager Product access');
reset role;
select * from finish();
rollback;
