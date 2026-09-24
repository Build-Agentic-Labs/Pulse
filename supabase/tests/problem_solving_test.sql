begin;
select plan(29);
insert into public.workspaces(id,name) values ('ws_problem_test','Problem solving test'), ('ws_problem_other','Other workspace');
insert into public.workspace_auto_join_domains(domain,workspace_id) values ('problem-test.invalid','ws_problem_test');
insert into auth.users(id,aud,role,email) values
 ('32b1ed97-d60c-4198-ae70-4a6786d8ad50','authenticated','authenticated','rlopez@problem-test.invalid'),
 ('e0912400-0000-0000-0000-000000000001','authenticated','authenticated','other@problem-test.invalid')
 on conflict (id) do nothing;
insert into public.workspace_members(workspace_id,user_id,role) values
 ('ws_problem_test','32b1ed97-d60c-4198-ae70-4a6786d8ad50','owner'),
 ('ws_problem_test','e0912400-0000-0000-0000-000000000001','owner');
create or replace function pg_temp.problem_as(uid text) returns void language plpgsql as $$
begin
 perform set_config('request.jwt.claims',json_build_object('sub',uid,'role','authenticated')::text,true);
 execute 'set local role authenticated';
end $$;
select pg_temp.problem_as('32b1ed97-d60c-4198-ae70-4a6786d8ad50');
select is(public.is_problem_solving_pilot(),true,'rlopez is allowlisted');
select lives_ok($$insert into public.problem_cases(id,workspace_id,title) values ('a0912400-0000-0000-0000-000000000001','ws_problem_test','QA case')$$,'pilot creates incomplete draft');
select throws_ok($$insert into public.problem_cases(workspace_id,title) values ('ws_problem_other','Wrong scope')$$,'42501',null,'pilot cannot cross workspace boundary');
select throws_ok($$update public.problem_cases set stage='closed' where id='a0912400-0000-0000-0000-000000000001'$$,'P0001','Complete each stage in order.','cannot skip stages');
select throws_ok($$update public.problem_cases set stage='contain' where id='a0912400-0000-0000-0000-000000000001'$$,'P0001',null,'definition required');
select lives_ok($$update public.problem_cases set owner='RL',problem='Wrong decal',expected='Correct decal',affected='Unit 1',stage='contain' where id='a0912400-0000-0000-0000-000000000001'$$,'definition advances');
select throws_ok($$update public.problem_cases set containment='Held unit',stage='investigate' where id='a0912400-0000-0000-0000-000000000001'$$,'P0001',null,'completed containment required');
select throws_ok($$insert into public.problem_actions(case_id,kind,description,owner,due_on,status) values ('a0912400-0000-0000-0000-000000000001','containment','Hold','RL',current_date,'done')$$,'23514',null,'completed action needs evidence');
select lives_ok($$insert into public.problem_actions(case_id,kind,description,owner,due_on,status,completion_evidence) values ('a0912400-0000-0000-0000-000000000001','containment','Hold','RL',current_date,'done','Hold tag applied')$$,'containment saves');
select lives_ok($$update public.problem_cases set containment='Held unit',stage='investigate' where id='a0912400-0000-0000-0000-000000000001'$$,'investigation advances');
select throws_ok($$update public.problem_cases set root_cause='Old template',stage='correct' where id='a0912400-0000-0000-0000-000000000001'$$,'P0001',null,'cause evidence required');
select lives_ok($$update public.problem_cases set root_cause='Old template',cause_evidence='Compared template revisions',stage='correct' where id='a0912400-0000-0000-0000-000000000001'$$,'cause evidence allows correction');
select throws_ok($$update public.problem_cases set stage='prevent' where id='a0912400-0000-0000-0000-000000000001'$$,'P0001',null,'corrective action required');
insert into public.problem_actions(case_id,kind,description,owner,due_on,status,completion_evidence) values ('a0912400-0000-0000-0000-000000000001','corrective','Replace','RL',current_date,'done','Compared replacement');
update public.problem_cases set stage='prevent' where id='a0912400-0000-0000-0000-000000000001';
select throws_ok($$update public.problem_cases set stage='verify' where id='a0912400-0000-0000-0000-000000000001'$$,'P0001',null,'prevention and verification plan required');
insert into public.problem_actions(case_id,kind,description,owner,due_on,status,completion_evidence) values ('a0912400-0000-0000-0000-000000000001','preventive','Retire old template','RL',current_date,'done','Template disabled');
update public.problem_cases set prevention='Retired old template',verification_plan='Check next ten',stage='verify' where id='a0912400-0000-0000-0000-000000000001';
select throws_ok($$update public.problem_cases set stage='closed' where id='a0912400-0000-0000-0000-000000000001'$$,'P0001',null,'effectiveness required for closure');
insert into storage.objects(bucket_id,name) values ('problem-evidence','ws_problem_test/a0912400-0000-0000-0000-000000000001/verify/result.txt');
select lives_ok($$insert into public.problem_evidence(case_id,section,file_name,storage_path) values ('a0912400-0000-0000-0000-000000000001','verify','result.txt','ws_problem_test/a0912400-0000-0000-0000-000000000001/verify/result.txt')$$,'evidence links to section');
select lives_ok($$update public.problem_cases set verification_result='Ten passed',verified_on=current_date,stage='closed' where id='a0912400-0000-0000-0000-000000000001'$$,'verified case closes');
select throws_ok($$update public.problem_cases set title='Tamper' where id='a0912400-0000-0000-0000-000000000001'$$,'P0001','Closed cases are read-only.','closed case immutable');
select throws_ok($$insert into public.problem_actions(case_id,kind,description,owner,due_on) values ('a0912400-0000-0000-0000-000000000001','corrective','Late action','RL',current_date)$$,'P0001',null,'closed actions immutable');
select ok((select count(*) > 0 from public.problem_history),'audit history recorded');
select pg_temp.problem_as('e0912400-0000-0000-0000-000000000001');
select is(public.is_problem_solving_pilot(),false,'another workspace owner is not allowlisted');
select is((select count(*) from public.problem_cases),0::bigint,'other user cannot read cases');
select is((select count(*) from public.problem_actions),0::bigint,'other user cannot read actions');
select is((select count(*) from public.problem_evidence),0::bigint,'other user cannot read evidence metadata');
select is((select count(*) from public.problem_history),0::bigint,'other user cannot read audit history');
select is((select count(*) from storage.objects where bucket_id='problem-evidence'),0::bigint,'other user cannot read evidence files');
select throws_ok($$insert into storage.objects(bucket_id,name) values ('problem-evidence','ws_problem_test/a0912400-0000-0000-0000-000000000001/verify/unauthorized.txt')$$,'42501',null,'other user cannot upload files');
select throws_ok($$insert into public.problem_cases(workspace_id,title) values ('ws_problem_test','Unauthorized')$$,'42501',null,'other user cannot create cases');
reset role;
select is((select public from storage.buckets where id='problem-evidence'),false,'evidence bucket is private');
select * from finish();
rollback;
