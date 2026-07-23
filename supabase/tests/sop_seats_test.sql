-- pgTAP: Gate A — the roster must be complete and honest before draft -> in_review.
--
-- Pins the seat invariants:
--   * at least one required departmental approver; any number of departments may be required
--   * every seat with a signer_id names a strict member of that seat's department
--   * the submitter holds no blocking seat (first leg of the three-humans invariant)
--   * the approval roster refuses legacy Support / Consult / Inform duties
--   * an authorship signature by the submitter, bound to (content_hash, review_cycle),
--     is required to submit
--
-- sign_sop v2 contract: sign_sop(p_sop, p_meaning, p_reason, p_seat_department, p_resolves).

begin;
select plan(10);

-- ---------------------------------------------------------------------------
-- Fixtures (owner context: RLS bypassed)
-- ---------------------------------------------------------------------------
-- enforce_signup_domain() rejects emails whose domain is absent from
-- workspace_auto_join_domains, which is empty on a fresh db reset. Seed it before
-- any auth.users insert, and create the workspace it points at first.
insert into public.workspaces (id, name) values ('ws_seats', 'Seats Org');
insert into public.workspace_auto_join_domains (domain, workspace_id) values ('test.dev', 'ws_seats');

insert into auth.users (id, aud, role, email)
values
  ('c0000000-0000-0000-0000-000000000001', 'authenticated', 'authenticated', 'seat-sub@test.dev'),
  ('c0000000-0000-0000-0000-000000000002', 'authenticated', 'authenticated', 'seat-resp@test.dev'),
  ('c0000000-0000-0000-0000-000000000003', 'authenticated', 'authenticated', 'seat-acct@test.dev'),
  ('c0000000-0000-0000-0000-000000000004', 'authenticated', 'authenticated', 'seat-info@test.dev'),
  ('c0000000-0000-0000-0000-000000000005', 'authenticated', 'authenticated', 'seat-outsider@test.dev');


insert into public.workspace_members (workspace_id, user_id, role)
select 'ws_seats', u.id, 'editor' from (values
  ('c0000000-0000-0000-0000-000000000001'::uuid),
  ('c0000000-0000-0000-0000-000000000002'::uuid),
  ('c0000000-0000-0000-0000-000000000003'::uuid),
  ('c0000000-0000-0000-0000-000000000004'::uuid),
  ('c0000000-0000-0000-0000-000000000005'::uuid)) as u(id);

insert into public.org_tool_access (user_id, level)
select u.id, 'edit'::public.access_level from (values
  ('c0000000-0000-0000-0000-000000000001'::uuid),
  ('c0000000-0000-0000-0000-000000000002'::uuid),
  ('c0000000-0000-0000-0000-000000000003'::uuid),
  ('c0000000-0000-0000-0000-000000000004'::uuid),
  ('c0000000-0000-0000-0000-000000000005'::uuid)) as u(id);

insert into public.departments (id, workspace_id, code, name, is_quality_gate) values
  ('dept_st_prd', 'ws_seats', 'PRD', 'Production', false),
  ('dept_st_a', 'ws_seats', 'ENG', 'Engineering', false),
  ('dept_st_b', 'ws_seats', 'MNT', 'Maintenance', false),
  ('dept_st_c', 'ws_seats', 'LOG', 'Logistics', false),
  ('dept_st_d', 'ws_seats', 'SAF', 'Safety', false);

-- The submitter is a member of the owning department AND of ENG (so the
-- submitter-holds-a-seat case is a real membership, not a membership failure).
insert into public.department_members (department_id, user_id, dept_role) values
  ('dept_st_prd', 'c0000000-0000-0000-0000-000000000001', 'author'),
  ('dept_st_a', 'c0000000-0000-0000-0000-000000000001', 'reviewer'),
  ('dept_st_a', 'c0000000-0000-0000-0000-000000000002', 'approver'),
  ('dept_st_b', 'c0000000-0000-0000-0000-000000000003', 'approver'),
  ('dept_st_c', 'c0000000-0000-0000-0000-000000000004', 'reviewer');
-- u5 (outsider) belongs to no department.

insert into public.sops (id, workspace_id, sop_number, title, document, status, created_by, department_id)
select s.id, 'ws_seats', s.num, s.title, '{"body":"v1"}'::jsonb, 'draft',
       'c0000000-0000-0000-0000-000000000001', 'dept_st_prd'
from (values
  ('sop_seat_1', 'PRD-SOP-001', 'No required approver'),
  ('sop_seat_2', 'PRD-SOP-002', 'One required approver'),
  ('sop_seat_3', 'PRD-SOP-003', 'Multiple required approvers'),
  ('sop_seat_4', 'PRD-SOP-004', 'Ghost signer'),
  ('sop_seat_5', 'PRD-SOP-005', 'Submitter seated'),
  ('sop_seat_6', 'PRD-SOP-006', 'Valid roster')) as s(id, num, title);

insert into public.sop_review_seats (sop_id, department_id, rasic, signer_id) values
  -- sop_seat_1 intentionally has no approval rows.
  -- sop_seat_2: one required approver is sufficient.
  ('sop_seat_2', 'dept_st_a', 'responsible', 'c0000000-0000-0000-0000-000000000002'),
  -- sop_seat_3: multiple required departments are allowed.
  ('sop_seat_3', 'dept_st_a', 'responsible', 'c0000000-0000-0000-0000-000000000002'),
  ('sop_seat_3', 'dept_st_b', 'responsible', 'c0000000-0000-0000-0000-000000000003'),
  -- sop_seat_4: one signer is NOT a member of dept_st_b.
  ('sop_seat_4', 'dept_st_a', 'responsible', 'c0000000-0000-0000-0000-000000000002'),
  ('sop_seat_4', 'dept_st_b', 'responsible', 'c0000000-0000-0000-0000-000000000005'),
  -- sop_seat_5: the submitter (u1) holds the responsible seat.
  ('sop_seat_5', 'dept_st_a', 'responsible', 'c0000000-0000-0000-0000-000000000001'),
  ('sop_seat_5', 'dept_st_b', 'responsible', 'c0000000-0000-0000-0000-000000000003'),
  -- sop_seat_6: fully valid blocking roster.
  ('sop_seat_6', 'dept_st_a', 'responsible', 'c0000000-0000-0000-0000-000000000002'),
  ('sop_seat_6', 'dept_st_b', 'responsible', 'c0000000-0000-0000-0000-000000000003');

-- Helper: act as a given user with the authenticated role.
create or replace function test_as(p_uid text) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
end $$;

-- ---------------------------------------------------------------------------
-- 1/2. At least one required approver is necessary, and one is sufficient.
-- ---------------------------------------------------------------------------
select test_as('c0000000-0000-0000-0000-000000000001');
select public.sign_sop('sop_seat_1', 'authorship');
select throws_ok(
  $$ update public.sops set status = 'in_review' where id = 'sop_seat_1' $$,
  null,
  'submitting without a required departmental approver is refused (Gate A)'
);

select public.sign_sop('sop_seat_2', 'authorship');
select lives_ok(
  $$ update public.sops set status = 'in_review' where id = 'sop_seat_2' $$,
  'one required departmental approver is sufficient'
);

-- ---------------------------------------------------------------------------
-- 3. Any number of departments may be required approvers.
-- ---------------------------------------------------------------------------
reset role;
select lives_ok(
  $$ insert into public.sop_review_seats (sop_id, department_id, rasic, signer_id)
     values ('sop_seat_3', 'dept_st_c', 'responsible', 'c0000000-0000-0000-0000-000000000004') $$,
  'a third required departmental approver is allowed'
);

-- ---------------------------------------------------------------------------
-- 4. A seat whose signer is not a member of that department cannot pass Gate A.
-- ---------------------------------------------------------------------------
select test_as('c0000000-0000-0000-0000-000000000001');
select public.sign_sop('sop_seat_4', 'authorship');
select throws_ok(
  $$ update public.sops set status = 'in_review' where id = 'sop_seat_4' $$,
  null,
  'a seat signer who is not a strict member of the seat department blocks submission (Gate A)'
);

-- ---------------------------------------------------------------------------
-- 5. The submitter must hold no blocking seat.
-- ---------------------------------------------------------------------------
select public.sign_sop('sop_seat_5', 'authorship');
select throws_ok(
  $$ update public.sops set status = 'in_review' where id = 'sop_seat_5' $$,
  null,
  'the submitter holding a blocking seat is refused (Gate A / three-humans invariant)'
);

-- ---------------------------------------------------------------------------
-- 6/7. Legacy non-approval duties are refused; required approvers need a signer.
-- ---------------------------------------------------------------------------
select throws_ok(
  $$ insert into public.sop_review_seats (sop_id, department_id, rasic, signer_id)
     values ('sop_seat_6', 'dept_st_c', 'informed', null) $$,
  null,
  'Inform belongs in procedure RASIC, not the approval roster'
);
select throws_ok(
  $$ insert into public.sop_review_seats (sop_id, department_id, rasic, signer_id)
     values ('sop_seat_6', 'dept_st_d', 'responsible', null) $$,
  null,
  'a required approver with a null signer_id is refused'
);

-- ---------------------------------------------------------------------------
-- 8/9/10. Authorship is the last missing piece: refuse without it, pass with it.
-- ---------------------------------------------------------------------------
select throws_ok(
  $$ update public.sops set status = 'in_review' where id = 'sop_seat_6' $$,
  null,
  'submitting without an authorship signature is refused (Gate A)'
);
select public.sign_sop('sop_seat_6', 'authorship');
select lives_ok(
  $$ update public.sops set status = 'in_review' where id = 'sop_seat_6' $$,
  'a valid required-approver roster + authorship signature submits cleanly'
);
select is(
  (select status from public.sops where id = 'sop_seat_6'),
  'in_review',
  'the valid submission landed in in_review'
);

select finish();
rollback;
