-- Every person in a department has an independent, required approval assignment.
begin;
select plan(30);
select ok(not has_function_privilege('anon','public.reassign_sop_seat(text,text,uuid,uuid)','execute'),
 'anonymous callers cannot reassign approval seats');
select ok(not has_function_privilege('anon','public.stage_sop_approver(text,text,text,text)','execute'),
 'anonymous callers cannot stage approvers');
insert into public.workspaces(id,name) values ('ws_multi','Multiple approvers'),('ws_multi_other','Other org');
insert into public.workspace_auto_join_domains(domain,workspace_id) values ('multi.test','ws_multi');
insert into auth.users(id,aud,role,email) values
 ('a1300000-0000-0000-0000-000000000001','authenticated','authenticated','author@multi.test'),
 ('a1300000-0000-0000-0000-000000000002','authenticated','authenticated','plant1@multi.test'),
 ('a1300000-0000-0000-0000-000000000003','authenticated','authenticated','plant2@multi.test'),
 ('a1300000-0000-0000-0000-000000000004','authenticated','authenticated','quality@multi.test'),
 ('a1300000-0000-0000-0000-000000000005','authenticated','authenticated','admin@multi.test');
insert into public.workspace_members(workspace_id,user_id,role)
 select 'ws_multi',id,case when email='admin@multi.test' then 'admin'::public.workspace_role else 'editor'::public.workspace_role end
 from auth.users where email like '%@multi.test';
insert into public.org_tool_access(workspace_id,user_id,level)
 select 'ws_multi',id,'edit'::public.access_level from auth.users where email like '%@multi.test';
insert into public.departments(id,workspace_id,code,name,is_quality_gate) values
 ('multi_mfg','ws_multi','MFG','Manufacturing',false),
 ('multi_quality','ws_multi','QA','Quality',true),
 ('multi_other','ws_multi_other','MFG','Other Manufacturing',false);
insert into public.department_members(department_id,user_id,dept_role) values
 ('multi_mfg','a1300000-0000-0000-0000-000000000001','author'),
 ('multi_mfg','a1300000-0000-0000-0000-000000000002','author'),
 ('multi_mfg','a1300000-0000-0000-0000-000000000003','author'),
 ('multi_quality','a1300000-0000-0000-0000-000000000004','approver'),
 ('multi_mfg','a1300000-0000-0000-0000-000000000005','author');
insert into public.user_signature_profiles(user_id,signature_strokes)
 select id,'[[{"x":0,"y":0},{"x":1,"y":1}]]'::jsonb from auth.users where email like '%@multi.test';
insert into public.sops(id,workspace_id,title,document,status,created_by,department_id)
 values ('sop_multi','ws_multi','Multiple plant managers','{"body":"Review me"}','draft',
 'a1300000-0000-0000-0000-000000000001','multi_mfg');
create or replace function test_multi_as(p_uid text) returns void language plpgsql as $$
begin
 perform set_config('request.jwt.claims',json_build_object('sub',p_uid,'role','authenticated')::text,true);
 execute 'set local role authenticated';
end $$;
select test_multi_as('a1300000-0000-0000-0000-000000000001');
insert into public.sop_review_seats(id,sop_id,department_id,rasic,signer_id)
 values ('a1310000-0000-0000-0000-000000000001','sop_multi','multi_mfg','responsible','a1300000-0000-0000-0000-000000000002');
select throws_ok($$update public.sop_review_seats set id=gen_random_uuid() where id='a1310000-0000-0000-0000-000000000001'$$,
 'P0001','An approval assignment identity cannot change','persisted assignment identities are immutable');
select lives_ok($$insert into public.sop_review_seats(id,sop_id,department_id,rasic,signer_id)
 values ('a1310000-0000-0000-0000-000000000002','sop_multi','multi_mfg','responsible','a1300000-0000-0000-0000-000000000003')$$,
 'a second plant manager can be assigned in the same department');
select throws_ok($$insert into public.sop_review_seats(sop_id,department_id,rasic,signer_id)
 values ('sop_multi','multi_mfg','responsible','a1300000-0000-0000-0000-000000000003')$$,
 '23505',null,'the same person cannot be added twice to the department');
select throws_ok($$insert into public.sop_review_seats(sop_id,department_id,rasic,signer_id)
 values ('sop_multi','multi_mfg','responsible','a1300000-0000-0000-0000-000000000001')$$,
 'P0001','The author or submitter cannot approve their own SOP','self approval remains blocked');
select throws_ok($$insert into public.sop_review_seats(sop_id,department_id,rasic,signer_id)
 values ('sop_multi','multi_other','responsible','a1300000-0000-0000-0000-000000000003')$$,
 'P0001','A review seat must name a department in this SOP''s workspace','cross-organization departments remain blocked');
delete from public.sop_review_seats where id='a1310000-0000-0000-0000-000000000002';
select is((select count(*) from public.sop_review_seats where sop_id='sop_multi'),1::bigint,'removing one manager preserves their colleague');
insert into public.sop_review_seats(id,sop_id,department_id,rasic,signer_id)
 values ('a1310000-0000-0000-0000-000000000002','sop_multi','multi_mfg','responsible','a1300000-0000-0000-0000-000000000003');
select lives_ok($$select public.stage_sop_approver('sop_multi','multi_mfg','new1@multi.test','Plant Manager')$$,'invite another person into a represented department');
select lives_ok($$select public.stage_sop_approver('sop_multi','multi_mfg','new2@multi.test','Plant Manager')$$,'multiple pending people can share a department');
select throws_ok($$select public.stage_sop_approver('sop_multi','multi_mfg','new2@multi.test','Plant Manager')$$,
 'P0001','This person is already assigned to approve this SOP.','duplicate pending people are rejected');
delete from public.sop_review_seats where id=(select seat_id from public.sop_approver_nominations where sop_id='sop_multi' and email='new1@multi.test');
select is((select count(*) from public.sop_approver_nominations where sop_id='sop_multi'),1::bigint,'removing a pending person only deletes their nomination');
select is((select email from public.sop_approver_nominations where sop_id='sop_multi'),'new2@multi.test','the sibling invitation remains attached to its own assignment');
delete from public.sop_review_seats where sop_id='sop_multi' and signer_id is null;
select test_multi_as('a1300000-0000-0000-0000-000000000005');
select throws_ok($$select public.reassign_sop_seat('sop_multi','multi_mfg','a1300000-0000-0000-0000-000000000004')$$,
 'P0001','Choose the individual approval assignment to reassign','legacy admin call cannot replace a whole department');
select lives_ok($$select public.reassign_sop_seat('sop_multi','multi_mfg','a1300000-0000-0000-0000-000000000004','a1310000-0000-0000-0000-000000000002')$$,
 'an admin can target one individual assignment');
select is((select signer_id::text from public.sop_review_seats where id='a1310000-0000-0000-0000-000000000001'),
 'a1300000-0000-0000-0000-000000000002','reassignment preserves the other manager');
select public.reassign_sop_seat('sop_multi','multi_mfg','a1300000-0000-0000-0000-000000000003','a1310000-0000-0000-0000-000000000002');
select test_multi_as('a1300000-0000-0000-0000-000000000001');
select public.sign_sop('sop_multi','authorship');
update public.sops set status='in_review' where id='sop_multi';
reset role;
select throws_ok($$delete from public.sop_review_seats where id='a1310000-0000-0000-0000-000000000002'$$,
 'P0001','The review roster is frozen once the SOP has been submitted','the roster remains frozen after submission');
select test_multi_as('a1300000-0000-0000-0000-000000000002');
select lives_ok($$select public.submit_sop_review('sop_multi',true)$$,'first manager returns their draft review');
select test_multi_as('a1300000-0000-0000-0000-000000000001');
select throws_ok($$select public.request_sop_final_approval('sop_multi')$$,
 null,'final approval waits for the second manager to review');
select test_multi_as('a1300000-0000-0000-0000-000000000003');
select lives_ok($$select public.submit_sop_review('sop_multi',true)$$,'second manager returns their independent draft review');
select test_multi_as('a1300000-0000-0000-0000-000000000001');
select lives_ok($$select public.request_sop_final_approval('sop_multi')$$,'both completed reviews unlock final approval');
select test_multi_as('a1300000-0000-0000-0000-000000000002');
select lives_ok($$select public.sign_sop('sop_multi','dept_approval',null,'multi_mfg')$$,'first manager signs their own assignment');
select is((select status from public.sops where id='sop_multi'),'in_review','one signature does not approve the whole department');
select ok(not public.sop_quorum_met('sop_multi'),'quorum requires the second manager signature');
select test_multi_as('a1300000-0000-0000-0000-000000000004');
select throws_ok($$select public.sign_sop('sop_multi','quality_approval')$$,null,'Quality cannot skip the outstanding manager');
select test_multi_as('a1300000-0000-0000-0000-000000000005');
select throws_ok($$select public.sign_sop('sop_multi','dept_approval',null,'multi_mfg')$$,null,'an unassigned department member cannot sign for either manager');
select test_multi_as('a1300000-0000-0000-0000-000000000003');
select lives_ok($$select public.sign_sop('sop_multi','dept_approval',null,'multi_mfg')$$,'second manager signs independently');
select is((select status from public.sops where id='sop_multi'),'approved','both signatures complete departmental approval');
select is((select count(*) from public.sop_signatures where sop_id='sop_multi' and meaning='dept_approval'),2::bigint,'both managers retain separate signed records');
select test_multi_as('a1300000-0000-0000-0000-000000000004');
select lives_ok($$select public.sign_sop('sop_multi','quality_approval')$$,'independent Quality approval remains the final gate');
select * from finish();
rollback;
