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

-- Any changes request keeps the author in control even after the remark is resolved.
select test_as('e0000000-0000-0000-0000-000000000002');
insert into public.sop_review_annotations(sop_id,review_cycle,category,body,created_by)
values('auto_changes',0,'overall','Please clarify this','e0000000-0000-0000-0000-000000000002');
select public.submit_sop_review('auto_changes',false);
select test_as('e0000000-0000-0000-0000-000000000001');
update public.sop_review_annotations set resolved_at=now(),resolved_by=auth.uid() where sop_id='auto_changes';
select test_as('e0000000-0000-0000-0000-000000000003');
select public.submit_sop_review('auto_changes',true);
select is((select final_approval_requested_at from public.sops where id='auto_changes'),null,'resolved changes request never auto-routes');
select test_as('e0000000-0000-0000-0000-000000000001');
select lives_ok($$select public.request_sop_final_approval('auto_changes')$$,'manual author handoff still works for resolved feedback');

-- Synthetic old/hash-mismatched submissions exercise the strict negative gates.
reset role;
insert into public.sop_review_submissions(sop_id,review_cycle,reviewer_id,no_changes,content_hash)
select id,case when id='auto_old_cycle' then -1 else review_cycle end,
 'e0000000-0000-0000-0000-000000000002',true,
 case when id='auto_stale' then 'old-document-hash' else content_hash end
from public.sops where id in ('auto_stale','auto_old_cycle','auto_open','auto_pending','auto_removed');
select test_as('e0000000-0000-0000-0000-000000000002');
insert into public.sop_review_annotations(sop_id,review_cycle,category,body,created_by)
values('auto_open',0,'overall','Unresolved remark','e0000000-0000-0000-0000-000000000002');
select test_as('e0000000-0000-0000-0000-000000000003');
select public.submit_sop_review('auto_stale',true);
select public.submit_sop_review('auto_old_cycle',true);
select public.submit_sop_review('auto_open',true);
select is((select final_approval_requested_at from public.sops where id='auto_stale'),null,'stale content response blocks automatic routing');
select is((select final_approval_requested_at from public.sops where id='auto_old_cycle'),null,'previous-cycle response blocks automatic routing');
select is((select final_approval_requested_at from public.sops where id='auto_open'),null,'any unresolved remark blocks automatic routing');
reset role;
update public.department_members set pending_invite_at=now() where user_id='e0000000-0000-0000-0000-000000000002';
select test_as('e0000000-0000-0000-0000-000000000003');
select public.submit_sop_review('auto_pending',true);
select is((select final_approval_requested_at from public.sops where id='auto_pending'),null,'pending membership blocks automatic routing');
reset role;
delete from public.workspace_members where user_id='e0000000-0000-0000-0000-000000000002';
select test_as('e0000000-0000-0000-0000-000000000003');
select public.submit_sop_review('auto_removed',true);
select is((select final_approval_requested_at from public.sops where id='auto_removed'),null,'removed approver blocks automatic routing');
reset role;
select is((select count(*) from public.sops where id in ('sop_z1','sop_z2') and final_approval_requested_at is null),2::bigint,
 'existing SOPs are untouched');
select * from finish();
rollback;
