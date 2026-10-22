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


-- A minor revision keeps the last effective release accessible and preserves provenance.
select test_as('e0000000-0000-0000-0000-000000000001');
update public.sops set status='draft',change_significance='MINOR',revision_reason='Correct grammar' where id='auto_clean';
select is((select version from public.sops where id='auto_clean'),'1.1','minor revision increments automatically');
select throws_ok($$update public.sops set deleted_at=now() where id='auto_clean'$$,null,'working revisions cannot delete the current effective release');
select throws_ok($$update public.sops set status='obsolete' where id='auto_clean'$$,null,'working revisions cannot retire the current effective release');

select ok(public.get_sop_effective_release('auto_clean')->>'version'='1.0','last effective release stays available during authoring');
select is((select count(*) from public.sop_change_requests where sop_id='auto_clean'),1::bigint,'controlled change is recorded once');
select is(jsonb_array_length(public.list_sop_carried_approvals(array['auto_clean'])),2,'unchanged approvers retain approvals with source provenance');
select set_config('request.jwt.claims','{"role":"service_role"}',true);
set local role service_role;
select is(jsonb_array_length(public.list_sop_carried_approvals(array['auto_clean'])),2,'notification worker can resolve carries without a user session');
select test_as('e0000000-0000-0000-0000-000000000001');
update public.sop_annex_files set storage_path='workspaces/ws_authz/sops/auto_clean/annexes/a1/revised.pdf',original_name='revised.pdf' where id='revision-file';
select is(public.get_sop_effective_release('auto_clean')->'files'->0->>'original_name','original.pdf','working attachment replacement does not change released attachment');
select ok(public.sop_file_is_released('workspaces/ws_authz/sops/auto_clean/annexes/a1/original.pdf'),'released attachment is pinned against deletion');
select is((select count(*) from storage.objects where name='workspaces/ws_authz/sops/auto_clean/annexes/a1/original.pdf'),1::bigint,'current effective attachment remains readable during authoring');
update public.sops set status='draft',change_significance='MAJOR',revision_reason='Another change' where id='auto_clean';
select is((select version from public.sops where id='auto_clean'),'1.1','cannot open another version while already drafting');
update public.sops set document=document||'{"body":"grammatical correction"}'::jsonb where id='auto_clean';
select lives_ok($$select public.submit_sop_controlled_draft('auto_clean',(select content_hash from public.sops where id='auto_clean'),1)$$,'minor revision submits to Quality without repeating departmental reviews');
select is((select status from public.sops where id='auto_clean'),'approved','unchanged minor revision awaits Quality');
select is((select count(*) from public.sop_signatures where sop_id='auto_clean' and review_cycle=1 and meaning='dept_approval'),0::bigint,'no fabricated fresh signatures');
select is((select count(*) from public.sop_review_submissions where sop_id='auto_clean' and review_cycle=1),0::bigint,'no fabricated reviewer responses');
select test_as('e0000000-0000-0000-0000-000000000004');
select public.sign_sop('auto_clean','quality_approval');
update public.sops set status='effective' where id='auto_clean';
select is(public.get_sop_effective_release('auto_clean')->>'version','1.1','Quality release replaces the effective library snapshot');
select is(public.get_sop_effective_release('auto_clean')->'files'->0->>'original_name','revised.pdf','new release exposes revised attachment only after Quality release');
select is((select count(*) from storage.objects where name='workspaces/ws_authz/sops/auto_clean/annexes/a1/original.pdf'),0::bigint,'retired attachment is not downloadable');
select throws_ok($$select document from public.sop_revisions where sop_id='auto_clean'$$,'42501',null,'historical SOP content is protected while metadata remains readable');
select ok(jsonb_array_length(public.get_sop_effective_release('auto_clean')->'approvals')=3,'released snapshot contains original departmental approvals plus fresh Quality signature');
select ok((select released_at is not null and released_by=auth.uid() from public.sop_change_requests where sop_id='auto_clean' and review_cycle=1),'change log records Quality identity and release time');
select is((select count(*) from public.sop_revisions where sop_id='auto_clean' and id<>(select effective_revision_id from public.sops where id='auto_clean')),1::bigint,'previous release becomes retired only after replacement release');

-- A replacement reviewer alone must review and sign a minor revision.
select test_as('e0000000-0000-0000-0000-000000000001');
update public.sops set status='draft',change_significance='MINOR',revision_reason='Replace incorrect approver' where id='auto_clean';
update public.sop_review_seats set signer_id='e0000000-0000-0000-0000-000000000005' where sop_id='auto_clean' and department_id='dept_z_b';
select is(jsonb_array_length(public.list_sop_carried_approvals(array['auto_clean'])),1,'replacement invalidates only the replaced approval');
select public.submit_sop_controlled_draft('auto_clean',(select content_hash from public.sops where id='auto_clean'),2);
select is((select status from public.sops where id='auto_clean'),'in_review','replacement reviewer must review before Quality');
select test_as('e0000000-0000-0000-0000-000000000005');
select lives_ok($$select public.submit_sop_review('auto_clean',true)$$,'replacement reviewer returns no comments');
select ok((select final_approval_requested_at is not null and final_approval_content_hash=content_hash from public.sops where id='auto_clean'),'unchanged approvals plus replacement acceptance automatically request signature');
select public.sign_sop('auto_clean','dept_approval',p_seat_department=>'dept_z_b');
select is((select status from public.sops where id='auto_clean'),'approved','only replacement signature is required for Quality routing');
select throws_ok($$select public.sign_sop('auto_clean','quality_approval')$$,null,'Quality reviewer holding a seat cannot release revision');
select test_as('e0000000-0000-0000-0000-000000000004');
select public.sign_sop('auto_clean','quality_approval');
update public.sops set status='effective' where id='auto_clean';

-- A major version always resets departmental approvals.
select test_as('e0000000-0000-0000-0000-000000000001');
update public.sops set status='draft',change_significance='MAJOR',revision_reason='Change the process' where id='auto_clean';
select is((select version from public.sops where id='auto_clean'),'2.0','major version resets minor and increments major');
select is(jsonb_array_length(public.list_sop_carried_approvals(array['auto_clean'])),0,'major version carries no approvals');
select public.submit_sop_controlled_draft('auto_clean',(select content_hash from public.sops where id='auto_clean'),3);
select is((select status from public.sops where id='auto_clean'),'in_review','major version enters full draft review');
select is((select final_approval_requested_at from public.sops where id='auto_clean'),null,'major version cannot skip draft review');
select test_as('e0000000-0000-0000-0000-000000000002');
select public.submit_sop_review('auto_clean',true);
select is((select final_approval_requested_at from public.sops where id='auto_clean'),null,'major version waits for every approver');
select test_as('e0000000-0000-0000-0000-000000000005');
select public.submit_sop_review('auto_clean',true);
select public.sign_sop('auto_clean','dept_approval',p_seat_department=>'dept_z_b');
select is((select status from public.sops where id='auto_clean'),'in_review','major version waits for every fresh signature');
select test_as('e0000000-0000-0000-0000-000000000002');
select public.sign_sop('auto_clean','dept_approval',p_seat_department=>'dept_z_a');
select test_as('e0000000-0000-0000-0000-000000000004');
select public.sign_sop('auto_clean','quality_approval');
update public.sops set status='effective' where id='auto_clean';
select is(public.get_sop_effective_release('auto_clean')->>'version','2.0','major version releases through original full approval workflow');

-- Quality may return a minor revision or require the full-version process.
select test_as('e0000000-0000-0000-0000-000000000001');
update public.sops set status='draft',change_significance='MINOR',revision_reason='Typographical correction' where id='auto_clean';
select public.submit_sop_controlled_draft('auto_clean',(select content_hash from public.sops where id='auto_clean'),4);
select throws_ok($$select public.return_sop_controlled_change('auto_clean','Forged return',(select content_hash from public.sops where id='auto_clean'),false)$$,null,'author cannot act as Quality');
select test_as('e0000000-0000-0000-0000-000000000004');
select throws_ok($$select public.return_sop_controlled_change('auto_clean','', (select content_hash from public.sops where id='auto_clean'),false)$$,null,'Quality must explain returned revisions');
select lives_ok($$select public.return_sop_controlled_change('auto_clean','Please clarify the change',(select content_hash from public.sops where id='auto_clean'),false)$$,'Quality can return minor revision to author');
select is((select status from public.sops where id='auto_clean'),'draft','returned minor revision is editable by author');
select is((select version from public.sops where id='auto_clean'),'2.1','Quality return does not invent another version number');
select is(public.get_sop_effective_release('auto_clean')->>'version','2.0','Quality rejection keeps prior effective release available');
select ok((select closed_at is not null from public.sop_change_requests where sop_id='auto_clean' and review_cycle=4),'returned change remains in the audit history');
select test_as('e0000000-0000-0000-0000-000000000001');
select public.submit_sop_controlled_draft('auto_clean',(select content_hash from public.sops where id='auto_clean'),5);
select test_as('e0000000-0000-0000-0000-000000000004');
select public.return_sop_controlled_change('auto_clean','This alters the process',(select content_hash from public.sops where id='auto_clean'),true);
select is((select version from public.sops where id='auto_clean'),'3.0','Quality can require a major version with automatic numbering');
select is(jsonb_array_length(public.list_sop_carried_approvals(array['auto_clean'])),0,'Quality escalation removes all carry-forward authority');
select test_as('e0000000-0000-0000-0000-000000000001');
select public.submit_sop_controlled_draft('auto_clean',(select content_hash from public.sops where id='auto_clean'),6);
select is((select status from public.sops where id='auto_clean'),'in_review','escalated major version must complete full review');
select is((select final_approval_requested_at from public.sops where id='auto_clean'),null,'escalation cannot reuse earlier signature requests');
select ok(jsonb_array_length(public.list_sop_controlled_changes('auto_clean'))>=6,'change log includes pending, returned and released requests');
select ok(public.list_sop_controlled_changes('auto_clean')->0 ? 'requested_by_name','change log supplies human-readable identities');
select ok(public.list_sop_effective_library('ws_authz') @> '[{"id":"auto_clean","version":"2.0","hasWorkingDraft":true}]','library shows current release alongside new version in progress');

select * from finish();
rollback;
