-- pgTAP: the two authorization holes found by adversarial review of the shipped code.
-- Both were reproducible against a live database, and neither had a test.
--
--   * TENANCY — a seat naming a department in ANOTHER workspace let an outside-tenant user read
--     the SOP (holds_sop_seat → can_read_sop) and sign a blocking approval (sign_sop authorizes
--     on seat identity alone). Now refused by the seat trigger, which fires for definer callers
--     and raw PostgREST writes alike.
--   * MEMBERSHIP AT SIGN TIME — Gate A checks that each seat's reviewer belongs to that seat's
--     department, but people leave departments mid-review. Nothing re-checked it when the
--     signature was made, so an ex-member could still complete the quorum.

begin;
select plan(5);

-- ---------------------------------------------------------------------------
-- Fixtures: two separate workspaces (owner context: RLS bypassed)
-- ---------------------------------------------------------------------------
insert into public.workspaces (id, name) values ('ws_ta', 'Tenant A'), ('ws_tb', 'Tenant B');
insert into public.workspace_auto_join_domains (domain, workspace_id) values ('test.dev', 'ws_ta');

insert into auth.users (id, aud, role, email) values
  ('e0000000-0000-0000-0000-000000000001', 'authenticated', 'authenticated', 'ta-author@test.dev'),
  ('e0000000-0000-0000-0000-000000000002', 'authenticated', 'authenticated', 'ta-resp@test.dev'),
  ('e0000000-0000-0000-0000-000000000003', 'authenticated', 'authenticated', 'ta-acct@test.dev'),
  ('e0000000-0000-0000-0000-000000000009', 'authenticated', 'authenticated', 'tb-outsider@test.dev');

insert into public.workspace_members (workspace_id, user_id, role) values
  ('ws_ta', 'e0000000-0000-0000-0000-000000000001', 'editor'),
  ('ws_ta', 'e0000000-0000-0000-0000-000000000002', 'editor'),
  ('ws_ta', 'e0000000-0000-0000-0000-000000000003', 'editor'),
  ('ws_tb', 'e0000000-0000-0000-0000-000000000009', 'editor');

insert into public.org_tool_access (user_id, level) values
  ('e0000000-0000-0000-0000-000000000001', 'edit'),
  ('e0000000-0000-0000-0000-000000000002', 'edit'),
  ('e0000000-0000-0000-0000-000000000003', 'edit'),
  ('e0000000-0000-0000-0000-000000000009', 'edit');

insert into public.departments (id, workspace_id, code, name, is_quality_gate) values
  ('d_ta_prd', 'ws_ta', 'PRD', 'Production',  false),
  ('d_ta_eng', 'ws_ta', 'ENG', 'Engineering', false),
  ('d_ta_mnt', 'ws_ta', 'MNT', 'Maintenance', false),
  ('d_tb_eng', 'ws_tb', 'ENG', 'Foreign Eng', false);

insert into public.department_members (department_id, user_id, dept_role) values
  ('d_ta_prd', 'e0000000-0000-0000-0000-000000000001', 'author'),
  ('d_ta_eng', 'e0000000-0000-0000-0000-000000000002', 'approver'),
  ('d_ta_mnt', 'e0000000-0000-0000-0000-000000000003', 'approver'),
  ('d_tb_eng', 'e0000000-0000-0000-0000-000000000009', 'approver');

insert into public.sops (id, workspace_id, sop_number, title, document, status, created_by, department_id)
values ('sop_ta', 'ws_ta', 'PRD-SOP-001', 'Tenant A procedure', '{"body":"a"}'::jsonb, 'draft',
        'e0000000-0000-0000-0000-000000000001', 'd_ta_prd');

create or replace function test_as(p_uid text) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
end $$;

-- ---------------------------------------------------------------------------
-- 1/2. A seat may not name a department from another workspace — even as the
--      table owner, because the check lives in the trigger, not in RLS.
-- ---------------------------------------------------------------------------
select throws_ok(
  $$ insert into public.sop_review_seats (sop_id, department_id, rasic, signer_id)
     values ('sop_ta', 'd_tb_eng', 'responsible', 'e0000000-0000-0000-0000-000000000009') $$,
  null,
  'a seat naming a foreign-workspace department is refused (tenancy)'
);

select lives_ok(
  $$ insert into public.sop_review_seats (sop_id, department_id, rasic, signer_id)
     values ('sop_ta', 'd_ta_eng', 'responsible', 'e0000000-0000-0000-0000-000000000002'),
            ('sop_ta', 'd_ta_mnt', 'responsible', 'e0000000-0000-0000-0000-000000000003') $$,
  'same-workspace seats are accepted'
);

-- ---------------------------------------------------------------------------
-- 3. The outsider cannot read the SOP: they hold no seat and no org access.
-- ---------------------------------------------------------------------------
select test_as('e0000000-0000-0000-0000-000000000009');
select is(
  (select count(*) from public.sops where id = 'sop_ta'),
  0::bigint,
  'a user from another workspace cannot read the SOP'
);

-- ---------------------------------------------------------------------------
-- 4. Submit normally.
-- ---------------------------------------------------------------------------
select test_as('e0000000-0000-0000-0000-000000000001');
select public.sign_sop('sop_ta', 'authorship');
update public.sops set status = 'in_review' where id = 'sop_ta';
-- Preconditions added after this suite was written; see
-- test_ready_for_approval in supabase/seed.sql.
select public.test_ready_for_approval('sop_ta');
-- ---------------------------------------------------------------------------
-- 5/6. A seat holder removed from their department mid-review cannot sign, and
--      the quorum does not count them.
-- ---------------------------------------------------------------------------
reset role;
delete from public.department_members
 where department_id = 'd_ta_eng' and user_id = 'e0000000-0000-0000-0000-000000000002';

select test_as('e0000000-0000-0000-0000-000000000002');
select throws_ok(
  $$ select public.sign_sop('sop_ta', 'dept_approval', p_seat_department => 'd_ta_eng') $$,
  null,
  'a signer removed from their department cannot sign that seat'
);

-- The accountable seat signs; the quorum must still be short, because the responsible seat's
-- holder is no longer a member of the department they speak for.
select test_as('e0000000-0000-0000-0000-000000000003');
select public.sign_sop('sop_ta', 'dept_approval', p_seat_department => 'd_ta_mnt');
select is(
  (select status from public.sops where id = 'sop_ta'),
  'in_review',
  'the quorum does not count a seat whose holder left the department'
);

select finish();
rollback;
