-- Regression: feedback, final-approval reassignment, membership revocation and release.
begin;
select plan(24);

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

-- Exercise the real feedback -> edit -> signatures -> Quality release path.
select test_as('e0000000-0000-0000-0000-000000000001');
select throws_ok($$update public.sop_review_seats set department_id='dept_z_b' where sop_id='sop_z1' and department_id='dept_z_a'$$,
 '23505',null,'moving to an already seated department fails atomically');
select is((select signer_id::text from public.sop_review_seats where sop_id='sop_z1' and department_id='dept_z_a'),
 'e0000000-0000-0000-0000-000000000002','failed department move preserves the original reviewer');
select lives_ok($$update public.sop_review_seats set department_id='dept_z_qa' where sop_id='sop_z1' and department_id='dept_z_c'$$,
 'author can atomically move a draft seat to another department');
update public.sop_review_seats set department_id='dept_z_c' where sop_id='sop_z1' and department_id='dept_z_qa';
select public.sign_sop('sop_z1', 'authorship');
update public.sops set status='in_review' where id='sop_z1';
select throws_ok($$update public.sops set final_approval_requested_at=now(), final_approval_content_hash=content_hash,
 final_approval_requested_by=auth.uid() where id='sop_z1'$$,
 'P0001','Every required departmental approver must respond before final approval',
 'direct updates cannot skip the draft-review gate');
update public.sops set final_approval_requested_at=null,final_approval_content_hash=null,final_approval_requested_by=null where id='sop_z1';

select test_as('e0000000-0000-0000-0000-000000000002');
insert into public.sop_review_annotations(sop_id,review_cycle,category,body,created_by)
values ('sop_z1',0,'overall','Clarify the safety check','e0000000-0000-0000-0000-000000000002');
select lives_ok($$select public.submit_sop_review('sop_z1',false)$$,'assigned reviewer returns feedback');
select test_as('e0000000-0000-0000-0000-000000000003');
select lives_ok($$select public.submit_sop_review('sop_z1',true)$$,'second reviewer accepts');
select test_as('e0000000-0000-0000-0000-000000000005');
select lives_ok($$select public.submit_sop_review('sop_z1',true)$$,'Quality seat participates in normal draft review');
select test_as('e0000000-0000-0000-0000-000000000001');
select throws_ok($$select public.request_sop_final_approval('sop_z1')$$,null,'open remarks block final approval');
update public.sops set status='draft' where id='sop_z1';
update public.sops set document=document || '{"body":"safety check clarified"}'::jsonb where id='sop_z1';
update public.sop_review_annotations set resolved_at=now(),resolved_by=auth.uid() where sop_id='sop_z1';
select public.sign_sop('sop_z1','authorship');
update public.sops set status='in_review' where id='sop_z1';
select lives_ok($$select public.request_sop_final_approval('sop_z1')$$,'resolved feedback advances without an impossible second draft review');
select is((select count(*) from public.sop_event_log where sop_id='sop_z1' and event_type='final_approval_requested'),
 1::bigint,'one final-approval request creates exactly one notification event');
select public.request_sop_final_approval('sop_z1');
select is((select count(*) from public.sop_event_log where sop_id='sop_z1' and event_type='final_approval_requested'),
 1::bigint,'retrying the request does not duplicate the notification event');
update public.sops set final_approval_content_hash='forged',
 final_approval_requested_by='e0000000-0000-0000-0000-000000000004' where id='sop_z1';
select ok((select final_approval_content_hash=content_hash and final_approval_requested_by=auth.uid()
 from public.sops where id='sop_z1'),'direct updates cannot forge the requested content or requesting person');

select test_as('e0000000-0000-0000-0000-000000000002');
select throws_ok($$select public.submit_sop_review('sop_z1',true)$$,null,'one review per cycle remains enforced');
reset role;
insert into public.department_members(department_id,user_id,dept_role) values
 ('dept_z_a','e0000000-0000-0000-0000-000000000001','reviewer'),
 ('dept_z_a','e0000000-0000-0000-0000-000000000007','reviewer');
insert into public.user_signature_profiles(user_id,signature_strokes)
select id,'[[{"x":0,"y":0},{"x":1,"y":1}]]'::jsonb from auth.users where email like 'z-%@test.dev';
select test_as('e0000000-0000-0000-0000-000000000006');
select throws_ok($$select public.reassign_sop_seat('sop_z1','dept_z_a','e0000000-0000-0000-0000-000000000001')$$,
 'P0001','The submitter cannot be assigned an approval seat','admin cannot strand an SOP by assigning its submitter');
select lives_ok($$select public.reassign_sop_seat('sop_z1','dept_z_a','e0000000-0000-0000-0000-000000000007')$$,'admin replaces unsigned reviewer during final approval');
select is((select final_approval_requested_at from public.sops where id='sop_z1'),null,'replacement returns workflow to draft review');
select test_as('e0000000-0000-0000-0000-000000000007');
select throws_ok($$select public.sign_sop('sop_z1','dept_approval',p_seat_department=>'dept_z_a')$$,null,'replacement cannot skip draft review');
select public.submit_sop_review('sop_z1',true);
select test_as('e0000000-0000-0000-0000-000000000001');
select lives_ok($$select public.request_sop_final_approval('sop_z1')$$,'author reopens signatures after replacement reviews');
select test_as('e0000000-0000-0000-0000-000000000007');
select public.sign_sop('sop_z1','dept_approval',p_seat_department=>'dept_z_a');
select test_as('e0000000-0000-0000-0000-000000000003');
select public.sign_sop('sop_z1','dept_approval',p_seat_department=>'dept_z_b');
select test_as('e0000000-0000-0000-0000-000000000005');
select public.sign_sop('sop_z1','dept_approval',p_seat_department=>'dept_z_c');
select is((select status from public.sops where id='sop_z1'),'approved','last required signature automatically routes to Quality');
select throws_ok($$select public.sign_sop('sop_z1','quality_approval')$$,null,'Quality seat holder cannot release the same SOP');
select test_as('e0000000-0000-0000-0000-000000000004');
select public.sign_sop('sop_z1','quality_approval');
select lives_ok($$update public.sops set status='effective' where id='sop_z1'$$,'independent Quality approver releases the SOP');
-- Membership revocation must also stop review submissions, not just signatures.
select test_as('e0000000-0000-0000-0000-000000000007');
select public.sign_sop('sop_z2','authorship');
update public.sops set status='in_review' where id='sop_z2';
reset role;
delete from public.workspace_members where workspace_id='ws_authz' and user_id='e0000000-0000-0000-0000-000000000002';
select test_as('e0000000-0000-0000-0000-000000000002');
select throws_ok($$select public.submit_sop_review('sop_z2',true)$$,
 'P0001','Only an active assigned reviewer can submit this review','removed workspace member cannot submit through definer RPC');
reset role;
delete from public.department_members where department_id='dept_z_b' and user_id='e0000000-0000-0000-0000-000000000003';
select test_as('e0000000-0000-0000-0000-000000000003');
select throws_ok($$select public.submit_sop_review('sop_z2',true)$$,
 'P0001','Only an assigned reviewer can submit this review','removed department member cannot submit through definer RPC');
reset role;
delete from public.workspace_members where workspace_id='ws_authz' and user_id='e0000000-0000-0000-0000-000000000007';
select test_as('e0000000-0000-0000-0000-000000000007');
select throws_ok($$select public.request_sop_final_approval('sop_z2')$$,
 'P0001','You no longer have access to this SOP','removed author cannot request final approval through definer RPC');
select * from finish();
rollback;
