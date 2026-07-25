-- pgTAP: D3 regression — signing authority is seat identity, never a role fold-in.
--
-- has_department_role folds workspace owners/admins AND Quality-gate approvers into every
-- department's approver check; signing must not use it. Pins:
--   * a workspace admin holding no seat cannot sign dept_approval, review, or rejection
--   * a Quality-gate approver cannot sign a department approval for another department
--   * a Quality signer who also holds a seat cannot release (Gate C: not any seat's signer)
--   * an author who is also a Quality approver cannot release their own SOP
--     (Gate C: not created_by / submitted_by — the three-humans invariant)
--   * a clean Quality approver still releases fine (the gate refuses people, not the path)
--
-- sign_sop v2 contract: sign_sop(p_sop, p_meaning, p_reason, p_seat_department, p_resolves).

begin;
select plan(11);

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

insert into public.org_tool_access (user_id, level)
select u.id, 'edit'::public.access_level from (values
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

-- ---------------------------------------------------------------------------
-- sop_z1 into review.
-- ---------------------------------------------------------------------------
select test_as('e0000000-0000-0000-0000-000000000001');
select public.sign_sop('sop_z1', 'authorship');
update public.sops set status = 'in_review' where id = 'sop_z1';
-- Preconditions added after this suite was written; see
-- test_ready_for_approval in supabase/seed.sql.
select public.test_ready_for_approval('sop_z1');
select is(
  (select status from public.sops where id = 'sop_z1'),
  'in_review',
  'fixture: sop_z1 is in review'
);

-- 2/3/4. The workspace admin holds no seat: nothing to satisfy, nothing to sign.
select test_as('e0000000-0000-0000-0000-000000000006');
select throws_ok(
  $$ select public.sign_sop('sop_z1', 'dept_approval', p_seat_department => 'dept_z_a') $$,
  null,
  'a workspace admin holding no seat cannot sign a department approval (D3)'
);
select throws_ok(
  $$ select public.sign_sop('sop_z1', 'review', p_seat_department => 'dept_z_c') $$,
  null,
  'a workspace admin holding no seat cannot sign a review (D3)'
);
select throws_ok(
  $$ select public.sign_sop('sop_z1', 'rejection', 'admin says no', p_seat_department => 'dept_z_a') $$,
  null,
  'a workspace admin holding no seat cannot sign a rejection (D3)'
);

-- 5. A Quality-gate approver is not every department''s approver.
select test_as('e0000000-0000-0000-0000-000000000004');
select throws_ok(
  $$ select public.sign_sop('sop_z1', 'dept_approval', p_seat_department => 'dept_z_a') $$,
  null,
  'a Quality approver cannot sign a department approval for a seat they do not hold (D3)'
);

-- 6. The real seat holders complete the quorum.
select test_as('e0000000-0000-0000-0000-000000000002');
select public.sign_sop('sop_z1', 'dept_approval', p_seat_department => 'dept_z_a');
select test_as('e0000000-0000-0000-0000-000000000003');
select public.sign_sop('sop_z1', 'dept_approval', p_seat_department => 'dept_z_b');
select test_as('e0000000-0000-0000-0000-000000000005');
select public.sign_sop('sop_z1', 'dept_approval', p_seat_department => 'dept_z_c');
select is(
  (select status from public.sops where id = 'sop_z1'),
  'approved',
  'fixture: sop_z1 is department-approved'
);

-- 7. A Quality approver who also holds a seat on this SOP cannot release it.
select test_as('e0000000-0000-0000-0000-000000000005');
select throws_ok(
  $sql$
    do $blk$
    begin
      perform public.sign_sop('sop_z1', 'quality_approval');
      update public.sops set status = 'effective' where id = 'sop_z1';
    end
    $blk$
  $sql$,
  null,
  'a Quality approver who is also a seat signer cannot release the SOP (Gate C)'
);

-- 8/9. A clean Quality approver releases it fine.
select test_as('e0000000-0000-0000-0000-000000000004');
select lives_ok(
  $$ select public.sign_sop('sop_z1', 'quality_approval') $$,
  'an independent Quality approver can sign the quality approval'
);
update public.sops set status = 'effective' where id = 'sop_z1';
select is(
  (select status from public.sops where id = 'sop_z1'),
  'effective',
  'the independent Quality approver releases the SOP'
);

-- ---------------------------------------------------------------------------
-- sop_z2: the author IS a Quality approver — they still cannot release their own SOP.
-- ---------------------------------------------------------------------------
select test_as('e0000000-0000-0000-0000-000000000007');
select public.sign_sop('sop_z2', 'authorship');
update public.sops set status = 'in_review' where id = 'sop_z2';
-- Preconditions added after this suite was written; see
-- test_ready_for_approval in supabase/seed.sql.
select public.test_ready_for_approval('sop_z2');
select test_as('e0000000-0000-0000-0000-000000000002');
select public.sign_sop('sop_z2', 'dept_approval', p_seat_department => 'dept_z_a');
select test_as('e0000000-0000-0000-0000-000000000003');
select public.sign_sop('sop_z2', 'dept_approval', p_seat_department => 'dept_z_b');
select is(
  (select status from public.sops where id = 'sop_z2'),
  'approved',
  'fixture: sop_z2 is department-approved'
);

select test_as('e0000000-0000-0000-0000-000000000007');
select throws_ok(
  $sql$
    do $blk$
    begin
      perform public.sign_sop('sop_z2', 'quality_approval');
      update public.sops set status = 'effective' where id = 'sop_z2';
    end
    $blk$
  $sql$,
  null,
  'an author who is also a Quality approver cannot release their own SOP (Gate C / three humans)'
);

select finish();
rollback;
