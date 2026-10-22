-- Regression: feedback, final-approval reassignment, membership revocation and release.
begin;
select no_plan();

-- ---------------------------------------------------------------------------
-- Fixtures (owner context: RLS bypassed)
-- ---------------------------------------------------------------------------
-- enforce_signup_domain() rejects emails whose domain is absent from
-- workspace_auto_join_domains, which is empty on a fresh db reset. Seed it before
-- any auth.users insert, and create the workspace it points at first.
insert into public.workspaces (id, name) values ('ws_authz', 'Authz Org');
insert into public.workspace_auto_join_domains (domain, workspace_id) values ('test.dev', 'ws_authz');

insert into auth.users (id, aud, role, email)
values
  ('e0000000-0000-0000-0000-000000000001', 'authenticated', 'authenticated', 'z-author@test.dev'),
  ('e0000000-0000-0000-0000-000000000002', 'authenticated', 'authenticated', 'z-resp@test.dev'),
  ('e0000000-0000-0000-0000-000000000003', 'authenticated', 'authenticated', 'z-acct@test.dev'),
  ('e0000000-0000-0000-0000-000000000004', 'authenticated', 'authenticated', 'z-quality@test.dev'),
  ('e0000000-0000-0000-0000-000000000005', 'authenticated', 'authenticated', 'z-quality-seated@test.dev'),
  ('e0000000-0000-0000-0000-000000000006', 'authenticated', 'authenticated', 'z-admin@test.dev'),
  ('e0000000-0000-0000-0000-000000000007', 'authenticated', 'authenticated', 'z-author-quality@test.dev');


insert into public.workspace_members (workspace_id, user_id, role) values
  ('ws_authz', 'e0000000-0000-0000-0000-000000000001', 'editor'),
  ('ws_authz', 'e0000000-0000-0000-0000-000000000002', 'editor'),
  ('ws_authz', 'e0000000-0000-0000-0000-000000000003', 'editor'),
  ('ws_authz', 'e0000000-0000-0000-0000-000000000004', 'editor'),
  ('ws_authz', 'e0000000-0000-0000-0000-000000000005', 'editor'),
  ('ws_authz', 'e0000000-0000-0000-0000-000000000006', 'admin'),
  ('ws_authz', 'e0000000-0000-0000-0000-000000000007', 'editor');

insert into public.org_tool_access (workspace_id, user_id, level)
select 'ws_authz', u.id, 'edit'::public.access_level from (values
  ('e0000000-0000-0000-0000-000000000001'::uuid),
  ('e0000000-0000-0000-0000-000000000002'::uuid),
  ('e0000000-0000-0000-0000-000000000003'::uuid),
  ('e0000000-0000-0000-0000-000000000004'::uuid),
  ('e0000000-0000-0000-0000-000000000005'::uuid),
  ('e0000000-0000-0000-0000-000000000007'::uuid)) as u(id);

insert into public.departments (id, workspace_id, code, name, is_quality_gate) values
  ('dept_z_prd', 'ws_authz', 'PRD', 'Production', false),
  ('dept_z_a', 'ws_authz', 'ENG', 'Engineering', false),
  ('dept_z_b', 'ws_authz', 'MNT', 'Maintenance', false),
  ('dept_z_c', 'ws_authz', 'LOG', 'Logistics', false),
  ('dept_z_qa', 'ws_authz', 'QA', 'Quality', true);

insert into public.department_members (department_id, user_id, dept_role) values
  ('dept_z_prd', 'e0000000-0000-0000-0000-000000000001', 'author'),
  ('dept_z_a', 'e0000000-0000-0000-0000-000000000002', 'approver'),
  ('dept_z_b', 'e0000000-0000-0000-0000-000000000003', 'approver'),
  ('dept_z_qa', 'e0000000-0000-0000-0000-000000000004', 'approver'),
  -- u5 is BOTH a Quality approver and a member of Logistics (they hold a seat below).
  ('dept_z_qa', 'e0000000-0000-0000-0000-000000000005', 'approver'),
  ('dept_z_c', 'e0000000-0000-0000-0000-000000000005', 'reviewer'),
  -- u7 is BOTH an author in Production and a Quality approver.
  ('dept_z_prd', 'e0000000-0000-0000-0000-000000000007', 'author'),
  ('dept_z_qa', 'e0000000-0000-0000-0000-000000000007', 'approver');
-- u6 (the workspace admin) belongs to no department.

insert into public.sops (id, workspace_id, sop_number, title, document, status, created_by, department_id)
values
  ('sop_z1', 'ws_authz', 'PRD-SOP-001', 'Bypass bait', '{"body":"z1"}'::jsonb, 'draft',
   'e0000000-0000-0000-0000-000000000001', 'dept_z_prd'),
  ('sop_z2', 'ws_authz', 'PRD-SOP-002', 'Self release bait', '{"body":"z2"}'::jsonb, 'draft',
   'e0000000-0000-0000-0000-000000000007', 'dept_z_prd');

insert into public.sop_review_seats (sop_id, department_id, rasic, signer_id) values
  ('sop_z1', 'dept_z_a', 'responsible', 'e0000000-0000-0000-0000-000000000002'),
  ('sop_z1', 'dept_z_b', 'responsible', 'e0000000-0000-0000-0000-000000000003'),
  ('sop_z1', 'dept_z_c', 'responsible', 'e0000000-0000-0000-0000-000000000005'),
  ('sop_z2', 'dept_z_a', 'responsible', 'e0000000-0000-0000-0000-000000000002'),
  ('sop_z2', 'dept_z_b', 'responsible', 'e0000000-0000-0000-0000-000000000003');

-- Helper: act as a given user with the authenticated role.
create or replace function test_as(p_uid text) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
end $$;


select ok(not has_function_privilege('authenticated','public.sop_unanimous_review_ready(text)','execute'),
 'readiness helper is not a public RPC');
select ok(not has_function_privilege('authenticated','public.auto_route_sop_unanimous_review()','execute'),
 'automatic routing trigger cannot be invoked as a client RPC');
select ok(not has_table_privilege('authenticated','public.sop_change_requests','insert'),'clients cannot forge change requests');
select ok(not has_table_privilege('authenticated','public.sop_approval_carry_forwards','insert'),'clients cannot forge carried approvals');
select ok(not has_column_privilege('authenticated','public.sop_revisions','document','select'),'retired release documents are not downloadable through the data API');
-- Every test below is transactional synthetic data in an isolated database.
insert into public.sops(id,workspace_id,title,document,status,created_by,department_id)
select 'auto_' || name,'ws_authz',name,'{"body":"synthetic"}'::jsonb,'draft',
 'e0000000-0000-0000-0000-000000000001','dept_z_prd'
from unnest(array['clean','changes','stale','old_cycle','unassigned','pending','removed','open','empty']) name;
insert into public.sop_review_seats(sop_id,department_id,rasic,signer_id)
select s.id,'dept_z_a','responsible','e0000000-0000-0000-0000-000000000002'::uuid
from public.sops s where s.id like 'auto_%' and s.id <> 'auto_empty';
insert into public.sop_review_seats(sop_id,department_id,rasic,signer_id)
select s.id,'dept_z_b','responsible','e0000000-0000-0000-0000-000000000003'::uuid
from public.sops s where s.id like 'auto_%' and s.id <> 'auto_empty';
insert into public.sop_annex_files(id,workspace_id,sop_id,annex_id,storage_path,original_name,content_type,size_bytes,uploaded_by)
values('revision-file','ws_authz','auto_clean','a1','workspaces/ws_authz/sops/auto_clean/annexes/a1/original.pdf','original.pdf','application/pdf',10,'e0000000-0000-0000-0000-000000000001');
insert into storage.buckets(id,name,public) values('sop-annexes','sop-annexes',false) on conflict do nothing;
insert into storage.objects(bucket_id,name) values('sop-annexes','workspaces/ws_authz/sops/auto_clean/annexes/a1/original.pdf');
-- Unassigned is valid only during draft; test it through the readiness predicate.
update public.sop_review_seats set signer_id=null where sop_id='auto_unassigned' and department_id='dept_z_b';
select ok(not public.sop_unanimous_review_ready('auto_unassigned'),'unassigned roster never qualifies');
select ok(not public.sop_unanimous_review_ready('auto_empty'),'empty roster never qualifies');
select test_as('e0000000-0000-0000-0000-000000000001');
select public.sign_sop(id,'authorship') from public.sops where id like 'auto_%' and id not in ('auto_unassigned','auto_empty');
update public.sops set status='in_review' where id like 'auto_%' and id not in ('auto_unassigned','auto_empty');
select test_as('e0000000-0000-0000-0000-000000000002');
update public.sops set final_approval_requested_at=now() where id='auto_clean';
select is((select final_approval_requested_at from public.sops where id='auto_clean'),null,
 'RLS prevents reviewer from manually updating routing fields');
select throws_ok($$select public.request_sop_final_approval('auto_clean')$$,
 'P0001','Only the SOP author or submitter can request final approval','reviewer cannot invoke author handoff RPC');
select public.submit_sop_review('auto_clean',true);
select is((select final_approval_requested_at from public.sops where id='auto_clean'),null,'first acceptance does not route early');
select test_as('e0000000-0000-0000-0000-000000000003');
select lives_ok($$select public.submit_sop_review('auto_clean',true)$$,'last no-comments response atomically routes for signatures');
select ok((select final_approval_requested_at is not null and final_approval_content_hash=content_hash
 and final_approval_requested_by is null from public.sops where id='auto_clean'),'automatic handoff binds current hash and records system attribution');
select is((select count(*) from public.sop_event_log where sop_id='auto_clean' and event_type='final_approval_requested'),1::bigint,'one signature request event');
select ok((select (details->>'automatic')::boolean and details->>'reason' is not null from public.sop_event_log
 where sop_id='auto_clean' and event_type='final_approval_requested'),'activity captures automatic handoff and reason');
select is((select status from public.sops where id='auto_clean'),'in_review','routing requests signatures without approving');
select throws_ok($$select public.submit_sop_review('auto_clean',true)$$,null,'duplicate submission rejected');
select test_as('e0000000-0000-0000-0000-000000000001');
select public.request_sop_final_approval('auto_clean');
select is((select count(*) from public.sop_event_log where sop_id='auto_clean' and event_type='final_approval_requested'),1::bigint,'author retry does not duplicate routing');
reset role;
insert into public.user_signature_profiles(user_id,signature_strokes)
select id,'[[{"x":0,"y":0},{"x":1,"y":1}]]'::jsonb from auth.users where email like 'z-%@test.dev';
select test_as('e0000000-0000-0000-0000-000000000002');
select public.sign_sop('auto_clean','dept_approval',p_seat_department=>'dept_z_a');
select is((select status from public.sops where id='auto_clean'),'in_review','first signature waits for all signatures');
select test_as('e0000000-0000-0000-0000-000000000003');
select public.sign_sop('auto_clean','dept_approval',p_seat_department=>'dept_z_b');
select is((select status from public.sops where id='auto_clean'),'approved','last signature automatically routes to Quality');
select is((select count(*) from public.sop_event_log where sop_id='auto_clean' and event_type='status_changed'
 and details->>'to_status'='approved'),1::bigint,'one Quality handoff event');
select ok((select (details->>'automatic_review_routing')::boolean from public.sop_event_log
 where sop_id='auto_clean' and event_type='status_changed' and details->>'to_status'='approved'),
 'Quality event carries provenance for the author notification');
select test_as('e0000000-0000-0000-0000-000000000001');
select throws_ok($$select public.sign_sop('auto_clean','quality_approval')$$,null,'author cannot release automatically routed SOP');
select test_as('e0000000-0000-0000-0000-000000000004');
select public.sign_sop('auto_clean','quality_approval');
select lives_ok($$update public.sops set status='effective' where id='auto_clean'$$,'independent Quality approver explicitly releases SOP');


-- Automatic section detection compares a future draft with its exact baseline release.
select test_as('e0000000-0000-0000-0000-000000000001');
update public.sops set status='draft',change_significance='MINOR',revision_reason='Editorial correction' where id='auto_clean';
select is(public.get_sop_detected_changes('auto_clean'),array[]::text[],'opening a revision alone reports no changes');
select throws_ok($$select public.confirm_sop_change_impact('auto_clean',(select content_hash from public.sops where id='auto_clean'),1,'Invented section',true,true)$$,null,'a manual label cannot authorize an unchanged revision');
select is(public.get_sop_detected_changes('auto_clean',(select document||'{"meta":{"version":"99.9","revisionDate":"2099-01-01","effectiveDate":"2099-01-02"},"status":"draft","updatedAt":"2099-01-01","changeHistory":[{"changes":"system history"}]}'::jsonb from public.sops where id='auto_clean')),array[]::text[],'system version dates status and history are ignored');
select is(public.get_sop_detected_changes('auto_clean',(select document||'{"procedure":{"processFlowDescription":"","roles":[],"activities":[]}}'::jsonb from public.sops where id='auto_clean')),array[]::text[],'empty procedure defaults do not create false changes');
select is(public.get_sop_detected_changes('auto_clean',(select document||'{"purpose":"Changed purpose"}'::jsonb from public.sops where id='auto_clean')),array['Purpose'],'unsaved purpose edits are detected');
select is(public.get_sop_detected_changes('auto_clean',(select document||'{"scope":"Changed scope"}'::jsonb from public.sops where id='auto_clean')),array['Scope'],'scope edits are detected');
select is(public.get_sop_detected_changes('auto_clean',(select document||'{"definitions":[{"term":"Term","definition":"Meaning"}]}'::jsonb from public.sops where id='auto_clean')),array['Definitions'],'definition edits are detected');
select is(public.get_sop_detected_changes('auto_clean',(select document||'{"responsiblePersons":["Inspector"]}'::jsonb from public.sops where id='auto_clean')),array['Responsible persons'],'responsibility edits are detected');
select is(public.get_sop_detected_changes('auto_clean',(select document||'{"references":["Manual"],"linkedSops":[{"sopId":"linked","title":"Manual"}]}'::jsonb from public.sops where id='auto_clean')),array['References'],'reference changes share a single section label');
select is(public.get_sop_detected_changes('auto_clean',(select document||'{"measurements":["Inspection completion rate"]}'::jsonb from public.sops where id='auto_clean')),array['Measurement'],'measurement edits are detected');
select is(public.get_sop_detected_changes('auto_clean',(select document||'{"procedure":{"activities":[{"id":"inspection","description":"Inspect equipment","assignments":{}}]}}'::jsonb from public.sops where id='auto_clean')),array['Procedure'],'procedure steps are detected');
select is(public.get_sop_detected_changes('auto_clean',(select document||'{"annexes":[{"id":"a1","label":"A","description":"Inspection form"}]}'::jsonb from public.sops where id='auto_clean')),array['Annexes & forms'],'annex edits are detected');
select is(public.get_sop_detected_changes('auto_clean',(select document||'{"meta":{"title":"Revised title"}}'::jsonb from public.sops where id='auto_clean')),array['Document details'],'title edits are detected');
select is(public.get_sop_detected_changes('auto_clean',(select document||'{"customField":"Extra information"}'::jsonb from public.sops where id='auto_clean')),array['Document content'],'custom body fields are not silently ignored');
select throws_ok($$select public.get_sop_detected_changes('auto_clean','[]')$$,null,'invalid preview input is rejected');

update public.sop_review_seats set signer_id='e0000000-0000-0000-0000-000000000005' where sop_id='auto_clean' and department_id='dept_z_b';
select is(public.get_sop_detected_changes('auto_clean'),array['Approvers'],'replacement approver is detected without a content edit');
update public.sop_review_seats set signer_id='e0000000-0000-0000-0000-000000000003' where sop_id='auto_clean' and department_id='dept_z_b';
select is(public.get_sop_detected_changes('auto_clean'),array[]::text[],'reverting the approver removes the detected change');

update public.sop_annex_files set original_name='renamed.pdf' where id='revision-file';
select is(public.get_sop_detected_changes('auto_clean'),array['Annexes & forms'],'renaming a file is detected');
update public.sop_annex_files set original_name='original.pdf' where id='revision-file';
update public.sop_annex_files set storage_path='workspaces/ws_authz/sops/auto_clean/annexes/a1/replaced.pdf' where id='revision-file';
select is(public.get_sop_detected_changes('auto_clean'),array['Annexes & forms'],'replacing the file content path is detected');
update public.sop_annex_files set storage_path='workspaces/ws_authz/sops/auto_clean/annexes/a1/original.pdf' where id='revision-file';
select is(public.get_sop_detected_changes('auto_clean'),array[]::text[],'file timestamps alone do not create changes');

delete from public.sop_annex_files where id='revision-file';
select is(public.get_sop_detected_changes('auto_clean'),array['Annexes & forms'],'removed files are detected');
insert into public.sop_annex_files(id,workspace_id,sop_id,annex_id,storage_path,original_name,content_type,size_bytes,uploaded_by)
values('revision-file','ws_authz','auto_clean','a1','workspaces/ws_authz/sops/auto_clean/annexes/a1/original.pdf','original.pdf','application/pdf',10,'e0000000-0000-0000-0000-000000000001');
select is(public.get_sop_detected_changes('auto_clean'),array[]::text[],'restored original metadata returns to no changes');

update public.sops set document=document||'{"referenceDocs":[{"id":"ref-1","name":"Reference manual"}]}'::jsonb where id='auto_clean';
insert into public.sop_annex_files(id,workspace_id,sop_id,annex_id,storage_path,original_name,content_type,size_bytes,uploaded_by)
values('new-reference','ws_authz','auto_clean','ref-1','workspaces/ws_authz/sops/auto_clean/annexes/ref-1/manual.pdf','manual.pdf','application/pdf',20,'e0000000-0000-0000-0000-000000000001');
select is(public.get_sop_detected_changes('auto_clean'),array['References'],'reference attachments are grouped with references');
delete from public.sop_annex_files where id='new-reference';
update public.sops set document=document-'referenceDocs'||'{"purpose":"Corrected wording"}'::jsonb where id='auto_clean';
select public.confirm_sop_change_impact('auto_clean',(select content_hash from public.sops where id='auto_clean'),1,'FORGED LABEL',true,true);
select is((select sections_affected from public.sop_change_requests where sop_id='auto_clean' and review_cycle=1),'Purpose','saved change log ignores client labels and uses server detection');
update public.sop_annex_files set original_name='final-name.pdf' where id='revision-file';
select throws_ok($$select public.submit_sop_controlled_draft('auto_clean',(select content_hash from public.sops where id='auto_clean'),1)$$,null,'attachment changes invalidate an earlier assessment');
select public.confirm_sop_change_impact('auto_clean',(select content_hash from public.sops where id='auto_clean'),1,'',true,true);
select is((select sections_affected from public.sop_change_requests where sop_id='auto_clean' and review_cycle=1),'Purpose; Annexes & forms','all saved detected sections are recorded automatically');
select lives_ok($$select public.submit_sop_controlled_draft('auto_clean',(select content_hash from public.sops where id='auto_clean'),1)$$,'detected sections and valid confirmations permit submission');
select is((select status from public.sops where id='auto_clean'),'approved','unchanged approvers still route the minor revision to Quality');
select test_as('e0000000-0000-0000-0000-000000000004');
select public.confirm_sop_change_quality('auto_clean',(select content_hash from public.sops where id='auto_clean'),1,true,true,true);
select public.sign_sop('auto_clean','quality_approval');
select lives_ok($$update public.sops set status='effective' where id='auto_clean'$$,'Quality releases the automatically documented change');
select ok(public.list_sop_controlled_changes('auto_clean')->0->>'sections_affected'='Purpose; Annexes & forms','released history retains automatic sections');
select ok(not has_function_privilege('authenticated','public.sop_detect_changed_sections(text,jsonb)','execute'),'internal detector is not a public RPC');
select test_as('f0000000-0000-0000-0000-000000000099');
select throws_ok($$select public.get_sop_detected_changes('auto_clean')$$,null,'nonmembers cannot inspect SOP change data');
select * from finish();
rollback;
