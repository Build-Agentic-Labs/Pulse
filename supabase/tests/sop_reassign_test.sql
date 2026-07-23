-- pgTAP: seat reassignment — admins move people; admins never sign.
--
-- reassign_sop_seat(p_sop, p_department, p_new_signer) is the only path for changing a
-- seat's signer once review has started. Pins:
--   * only a workspace owner/admin may call it
--   * the admin cannot reassign a seat to themselves (self-approval path)
--   * the new signer must be a strict member of the seat's department
--   * a seat holding a valid signature for the current (content_hash, review_cycle) is
--     closed — it cannot be reassigned
--   * an unsigned seat is reassignable in draft AND in_review
--   * every reassignment writes an audit_log row (target_type = 'sop_review_seat')
--
-- sign_sop v2 contract: sign_sop(p_sop, p_meaning, p_reason, p_seat_department, p_resolves).

begin;
select plan(9);

-- ---------------------------------------------------------------------------
-- Fixtures (owner context: RLS bypassed)
-- ---------------------------------------------------------------------------
-- enforce_signup_domain() rejects emails whose domain is absent from
-- workspace_auto_join_domains, which is empty on a fresh db reset. Seed it before
-- any auth.users insert, and create the workspace it points at first.
insert into public.workspaces (id, name) values ('ws_reassign', 'Reassign Org');
insert into public.workspace_auto_join_domains (domain, workspace_id) values ('test.dev', 'ws_reassign');

insert into auth.users (id, aud, role, email)
values
  ('80000000-0000-0000-0000-000000000001', 'authenticated', 'authenticated', 'r-admin@test.dev'),
  ('80000000-0000-0000-0000-000000000002', 'authenticated', 'authenticated', 'r-author@test.dev'),
  ('80000000-0000-0000-0000-000000000003', 'authenticated', 'authenticated', 'r-resp@test.dev'),
  ('80000000-0000-0000-0000-000000000004', 'authenticated', 'authenticated', 'r-resp-new@test.dev'),
  ('80000000-0000-0000-0000-000000000005', 'authenticated', 'authenticated', 'r-acct@test.dev'),
  ('80000000-0000-0000-0000-000000000006', 'authenticated', 'authenticated', 'r-acct-new@test.dev');


insert into public.workspace_members (workspace_id, user_id, role) values
  ('ws_reassign', '80000000-0000-0000-0000-000000000001', 'admin'),
  ('ws_reassign', '80000000-0000-0000-0000-000000000002', 'editor'),
  ('ws_reassign', '80000000-0000-0000-0000-000000000003', 'editor'),
  ('ws_reassign', '80000000-0000-0000-0000-000000000004', 'editor'),
  ('ws_reassign', '80000000-0000-0000-0000-000000000005', 'editor'),
  ('ws_reassign', '80000000-0000-0000-0000-000000000006', 'editor');

insert into public.org_tool_access (user_id, level)
select u.id, 'edit'::public.access_level from (values
  ('80000000-0000-0000-0000-000000000002'::uuid),
  ('80000000-0000-0000-0000-000000000003'::uuid),
  ('80000000-0000-0000-0000-000000000004'::uuid),
  ('80000000-0000-0000-0000-000000000005'::uuid),
  ('80000000-0000-0000-0000-000000000006'::uuid)) as u(id);

insert into public.departments (id, workspace_id, code, name, is_quality_gate) values
  ('dept_r_prd', 'ws_reassign', 'PRD', 'Production', false),
  ('dept_r_a', 'ws_reassign', 'ENG', 'Engineering', false),
  ('dept_r_b', 'ws_reassign', 'MNT', 'Maintenance', false);

-- The admin is a legitimate member of Engineering, so the self-reassignment refusal
-- below is the self rule and not a membership failure.
insert into public.department_members (department_id, user_id, dept_role) values
  ('dept_r_prd', '80000000-0000-0000-0000-000000000002', 'author'),
  ('dept_r_a', '80000000-0000-0000-0000-000000000001', 'reviewer'),
  ('dept_r_a', '80000000-0000-0000-0000-000000000003', 'approver'),
  ('dept_r_a', '80000000-0000-0000-0000-000000000004', 'approver'),
  ('dept_r_b', '80000000-0000-0000-0000-000000000005', 'approver'),
  ('dept_r_b', '80000000-0000-0000-0000-000000000006', 'approver');

insert into public.sops (id, workspace_id, sop_number, title, document, status, created_by, department_id)
values ('sop_r_1', 'ws_reassign', 'PRD-SOP-001', 'Reassignable', '{"body":"r1"}'::jsonb, 'draft',
        '80000000-0000-0000-0000-000000000002', 'dept_r_prd');

insert into public.sop_review_seats (sop_id, department_id, rasic, signer_id) values
  ('sop_r_1', 'dept_r_a', 'responsible', '80000000-0000-0000-0000-000000000003'),
  ('sop_r_1', 'dept_r_b', 'responsible', '80000000-0000-0000-0000-000000000005');

-- Helper: act as a given user with the authenticated role.
create or replace function test_as(p_uid text) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
end $$;

-- ---------------------------------------------------------------------------
-- 1. Only a workspace owner/admin may reassign.
-- ---------------------------------------------------------------------------
select test_as('80000000-0000-0000-0000-000000000003');
select throws_ok(
  $$ select public.reassign_sop_seat('sop_r_1', 'dept_r_a',
       '80000000-0000-0000-0000-000000000004'::uuid) $$,
  null,
  'a non-admin cannot reassign a seat'
);

-- ---------------------------------------------------------------------------
-- 2/3/4. The admin reassigns an unsigned seat; the change lands and is audited.
-- ---------------------------------------------------------------------------
select test_as('80000000-0000-0000-0000-000000000001');
select lives_ok(
  $$ select public.reassign_sop_seat('sop_r_1', 'dept_r_a',
       '80000000-0000-0000-0000-000000000004'::uuid) $$,
  'an admin reassigns an unsigned seat'
);
reset role;
select is(
  (select signer_id::text from public.sop_review_seats
    where sop_id = 'sop_r_1' and department_id = 'dept_r_a'),
  '80000000-0000-0000-0000-000000000004',
  'the seat now names the new signer'
);
select is(
  (select count(*) from public.audit_log where target_type = 'sop_review_seat'),
  1::bigint,
  'the reassignment wrote an audit_log row'
);

-- ---------------------------------------------------------------------------
-- 5. The admin cannot reassign a seat to themselves (they are a dept_r_a member,
--    so the only thing refusing this is the self rule).
-- ---------------------------------------------------------------------------
select test_as('80000000-0000-0000-0000-000000000001');
select throws_ok(
  $$ select public.reassign_sop_seat('sop_r_1', 'dept_r_a',
       '80000000-0000-0000-0000-000000000001'::uuid) $$,
  null,
  'an admin cannot reassign a seat to themselves (admins never sign)'
);

-- ---------------------------------------------------------------------------
-- 6. The new signer must be a strict member of the seat department.
-- ---------------------------------------------------------------------------
select throws_ok(
  $$ select public.reassign_sop_seat('sop_r_1', 'dept_r_a',
       '80000000-0000-0000-0000-000000000006'::uuid) $$,
  null,
  'reassigning to a non-member of the seat department is refused'
);

-- ---------------------------------------------------------------------------
-- 7/8. Mid-review: a signed seat is closed; an unsigned seat is still movable.
-- ---------------------------------------------------------------------------
select test_as('80000000-0000-0000-0000-000000000002');
select public.sign_sop('sop_r_1', 'authorship');
update public.sops set status = 'in_review' where id = 'sop_r_1';
select test_as('80000000-0000-0000-0000-000000000004');
select public.sign_sop('sop_r_1', 'dept_approval', p_seat_department => 'dept_r_a');

select test_as('80000000-0000-0000-0000-000000000001');
select throws_ok(
  $$ select public.reassign_sop_seat('sop_r_1', 'dept_r_a',
       '80000000-0000-0000-0000-000000000003'::uuid) $$,
  null,
  'a seat holding a valid signature for the current hash and cycle cannot be reassigned'
);
select lives_ok(
  $$ select public.reassign_sop_seat('sop_r_1', 'dept_r_b',
       '80000000-0000-0000-0000-000000000006'::uuid) $$,
  'an unsigned seat is reassignable while the SOP is in review'
);

-- ---------------------------------------------------------------------------
-- 9. Every successful reassignment is audited; the refused ones are not.
-- ---------------------------------------------------------------------------
reset role;
select is(
  (select count(*) from public.audit_log where target_type = 'sop_review_seat'),
  2::bigint,
  'exactly the two successful reassignments were audited'
);

select finish();
rollback;
