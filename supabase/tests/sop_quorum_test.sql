-- pgTAP: Gate B — department approval is a quorum, and the advance lives inside sign_sop.
--
-- Pins:
--   * an incomplete blocking quorum never advances, neither via sign_sop nor via a
--     manual UPDATE (the trigger independently re-validates the edge)
--   * people outside the required-approver roster cannot sign
--   * the last blocking dept_approval auto-advances in_review -> approved, no UPDATE issued
--   * one person holding blocking seats for two departments signs once PER SEAT
--     (seat_department_id stamped), and both seats must be satisfied
--
-- sign_sop v2 contract: sign_sop(p_sop, p_meaning, p_reason, p_seat_department, p_resolves).

begin;
select plan(7);

-- ---------------------------------------------------------------------------
-- Fixtures (owner context: RLS bypassed)
-- ---------------------------------------------------------------------------
-- enforce_signup_domain() rejects emails whose domain is absent from
-- workspace_auto_join_domains, which is empty on a fresh db reset. Seed it before
-- any auth.users insert, and create the workspace it points at first.
insert into public.workspaces (id, name) values ('ws_quorum', 'Quorum Org');
insert into public.workspace_auto_join_domains (domain, workspace_id) values ('test.dev', 'ws_quorum');

insert into auth.users (id, aud, role, email)
values
  ('d0000000-0000-0000-0000-000000000001', 'authenticated', 'authenticated', 'q-author@test.dev'),
  ('d0000000-0000-0000-0000-000000000002', 'authenticated', 'authenticated', 'q-resp@test.dev'),
  ('d0000000-0000-0000-0000-000000000003', 'authenticated', 'authenticated', 'q-acct@test.dev'),
  ('d0000000-0000-0000-0000-000000000004', 'authenticated', 'authenticated', 'q-support@test.dev'),
  ('d0000000-0000-0000-0000-000000000005', 'authenticated', 'authenticated', 'q-consulted@test.dev'),
  ('d0000000-0000-0000-0000-000000000006', 'authenticated', 'authenticated', 'q-twoseats@test.dev'),
  ('d0000000-0000-0000-0000-000000000007', 'authenticated', 'authenticated', 'q-author2@test.dev'),
  ('d0000000-0000-0000-0000-000000000008', 'authenticated', 'authenticated', 'q-admin@test.dev');


insert into public.workspace_members (workspace_id, user_id, role) values
  ('ws_quorum', 'd0000000-0000-0000-0000-000000000001', 'editor'),
  ('ws_quorum', 'd0000000-0000-0000-0000-000000000002', 'editor'),
  ('ws_quorum', 'd0000000-0000-0000-0000-000000000003', 'editor'),
  ('ws_quorum', 'd0000000-0000-0000-0000-000000000004', 'editor'),
  ('ws_quorum', 'd0000000-0000-0000-0000-000000000005', 'editor'),
  ('ws_quorum', 'd0000000-0000-0000-0000-000000000006', 'editor'),
  ('ws_quorum', 'd0000000-0000-0000-0000-000000000007', 'editor'),
  ('ws_quorum', 'd0000000-0000-0000-0000-000000000008', 'admin');

insert into public.org_tool_access (user_id, level)
select u.id, 'edit'::public.access_level from (values
  ('d0000000-0000-0000-0000-000000000001'::uuid),
  ('d0000000-0000-0000-0000-000000000002'::uuid),
  ('d0000000-0000-0000-0000-000000000003'::uuid),
  ('d0000000-0000-0000-0000-000000000004'::uuid),
  ('d0000000-0000-0000-0000-000000000005'::uuid),
  ('d0000000-0000-0000-0000-000000000006'::uuid),
  ('d0000000-0000-0000-0000-000000000007'::uuid)) as u(id);

insert into public.departments (id, workspace_id, code, name, is_quality_gate) values
  ('dept_q_prd', 'ws_quorum', 'PRD', 'Production', false),
  ('dept_q_a', 'ws_quorum', 'ENG', 'Engineering', false),
  ('dept_q_b', 'ws_quorum', 'MNT', 'Maintenance', false),
  ('dept_q_c', 'ws_quorum', 'LOG', 'Logistics', false),
  ('dept_q_d', 'ws_quorum', 'SAF', 'Safety', false);

insert into public.department_members (department_id, user_id, dept_role) values
  ('dept_q_prd', 'd0000000-0000-0000-0000-000000000001', 'author'),
  ('dept_q_prd', 'd0000000-0000-0000-0000-000000000007', 'author'),
  ('dept_q_a', 'd0000000-0000-0000-0000-000000000002', 'approver'),
  ('dept_q_b', 'd0000000-0000-0000-0000-000000000003', 'approver'),
  ('dept_q_c', 'd0000000-0000-0000-0000-000000000004', 'reviewer'),
  ('dept_q_d', 'd0000000-0000-0000-0000-000000000005', 'reviewer'),
  -- u6 is genuinely the responsible party for BOTH Engineering and Maintenance.
  ('dept_q_a', 'd0000000-0000-0000-0000-000000000006', 'approver'),
  ('dept_q_b', 'd0000000-0000-0000-0000-000000000006', 'approver');

insert into public.sops (id, workspace_id, sop_number, title, document, status, created_by, department_id)
values
  ('sop_q1', 'ws_quorum', 'PRD-SOP-001', 'Four seats', '{"body":"q1"}'::jsonb, 'draft',
   'd0000000-0000-0000-0000-000000000001', 'dept_q_prd'),
  ('sop_q2', 'ws_quorum', 'PRD-SOP-002', 'One person two seats', '{"body":"q2"}'::jsonb, 'draft',
   'd0000000-0000-0000-0000-000000000007', 'dept_q_prd');

insert into public.sop_review_seats (sop_id, department_id, rasic, signer_id) values
  ('sop_q1', 'dept_q_a', 'responsible', 'd0000000-0000-0000-0000-000000000002'),
  ('sop_q1', 'dept_q_b', 'responsible', 'd0000000-0000-0000-0000-000000000003'),
  ('sop_q2', 'dept_q_a', 'responsible', 'd0000000-0000-0000-0000-000000000006'),
  ('sop_q2', 'dept_q_b', 'responsible', 'd0000000-0000-0000-0000-000000000006');

-- Helper: act as a given user with the authenticated role.
create or replace function test_as(p_uid text) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
end $$;

-- ---------------------------------------------------------------------------
-- sop_q1: authorship + submit, then sign seat by seat.
-- ---------------------------------------------------------------------------
select test_as('d0000000-0000-0000-0000-000000000001');
select public.sign_sop('sop_q1', 'authorship');
update public.sops set status = 'in_review' where id = 'sop_q1';

-- 1. A person outside the required-approver roster cannot sign.
select test_as('d0000000-0000-0000-0000-000000000004');
select throws_ok(
  $$ select public.sign_sop('sop_q1', 'review', p_seat_department => 'dept_q_c') $$,
  null,
  'a person outside the required-approver roster cannot sign a review'
);

-- 2. One of two blocking seats signed -> no advance.
select test_as('d0000000-0000-0000-0000-000000000002');
select public.sign_sop('sop_q1', 'dept_approval', p_seat_department => 'dept_q_a');
select is(
  (select status from public.sops where id = 'sop_q1'),
  'in_review',
  'an incomplete blocking quorum does not advance the status'
);

-- 3. Nor can anyone push it through by hand — the trigger re-validates the edge.
select test_as('d0000000-0000-0000-0000-000000000008');
select throws_ok(
  $$ update public.sops set status = 'approved' where id = 'sop_q1' $$,
  null,
  'a manual in_review->approved with an unmet quorum is refused even for an admin (Gate B)'
);

-- 4. The last required departmental signature advances by itself.
select test_as('d0000000-0000-0000-0000-000000000003');
select public.sign_sop('sop_q1', 'dept_approval', p_seat_department => 'dept_q_b');
select is(
  (select status from public.sops where id = 'sop_q1'),
  'approved',
  'all required departmental approvers signed -> sign_sop auto-advances to approved'
);

-- ---------------------------------------------------------------------------
-- sop_q2: one person, two blocking seats — one signature per seat.
-- ---------------------------------------------------------------------------
select test_as('d0000000-0000-0000-0000-000000000007');
select public.sign_sop('sop_q2', 'authorship');
update public.sops set status = 'in_review' where id = 'sop_q2';

-- 5. Signing for the first seat satisfies only that seat.
select test_as('d0000000-0000-0000-0000-000000000006');
select public.sign_sop('sop_q2', 'dept_approval', p_seat_department => 'dept_q_a');
select is(
  (select status from public.sops where id = 'sop_q2'),
  'in_review',
  'one signature satisfies one seat, not every seat the person holds'
);

-- 6. Signing for the second seat completes the quorum.
select public.sign_sop('sop_q2', 'dept_approval', p_seat_department => 'dept_q_b');
select is(
  (select status from public.sops where id = 'sop_q2'),
  'approved',
  'the same person signing their second seat completes the quorum'
);

-- 7. Two distinct signature rows, each stamped with the department it was made for.
reset role;
select is(
  (select count(distinct seat_department_id) from public.sop_signatures
    where sop_id = 'sop_q2'
      and meaning = 'dept_approval'
      and signer_id = 'd0000000-0000-0000-0000-000000000006'),
  2::bigint,
  'each seat produced its own dept_approval row stamped with seat_department_id'
);

select finish();
rollback;
