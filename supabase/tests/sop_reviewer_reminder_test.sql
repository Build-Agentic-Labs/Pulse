-- Manual reviewer reminders: author-only, draft review only, unreturned seated
-- reviewers only, and at most once per 24 hours per reviewer.
begin;
select plan(12);

-- ---------------------------------------------------------------------------
-- Fixtures (owner context: RLS bypassed)
-- ---------------------------------------------------------------------------
insert into public.workspaces (id, name) values ('ws_remind', 'Remind Org');
insert into public.workspace_auto_join_domains (domain, workspace_id) values ('remind.dev', 'ws_remind');

insert into auth.users (id, aud, role, email) values
  ('f0000000-0000-0000-0000-000000000001', 'authenticated', 'authenticated', 'author@remind.dev'),
  ('f0000000-0000-0000-0000-000000000002', 'authenticated', 'authenticated', 'rev-a@remind.dev'),
  ('f0000000-0000-0000-0000-000000000003', 'authenticated', 'authenticated', 'rev-b@remind.dev'),
  ('f0000000-0000-0000-0000-000000000004', 'authenticated', 'authenticated', 'bystander@remind.dev');

insert into public.workspace_members (workspace_id, user_id, role) values
  ('ws_remind', 'f0000000-0000-0000-0000-000000000001', 'editor'),
  ('ws_remind', 'f0000000-0000-0000-0000-000000000002', 'editor'),
  ('ws_remind', 'f0000000-0000-0000-0000-000000000003', 'editor'),
  ('ws_remind', 'f0000000-0000-0000-0000-000000000004', 'editor');

insert into public.org_tool_access (workspace_id, user_id, level)
select 'ws_remind', u.id, 'edit'::public.access_level from (values
  ('f0000000-0000-0000-0000-000000000001'::uuid),
  ('f0000000-0000-0000-0000-000000000002'::uuid),
  ('f0000000-0000-0000-0000-000000000003'::uuid),
  ('f0000000-0000-0000-0000-000000000004'::uuid)) as u(id);

insert into public.departments (id, workspace_id, code, name, is_quality_gate) values
  ('dept_r_mfg', 'ws_remind', 'MFG', 'Manufacturing', false),
  ('dept_r_eng', 'ws_remind', 'ENG', 'Engineering', false);

insert into public.department_members (department_id, user_id, dept_role) values
  ('dept_r_mfg', 'f0000000-0000-0000-0000-000000000001', 'author'),
  ('dept_r_mfg', 'f0000000-0000-0000-0000-000000000002', 'reviewer'),
  ('dept_r_eng', 'f0000000-0000-0000-0000-000000000003', 'reviewer');

insert into public.sops (id, workspace_id, title, document, created_by, department_id) values
  ('sop_r1', 'ws_remind', 'Remind me', '{"meta":{}}'::jsonb, 'f0000000-0000-0000-0000-000000000001', 'dept_r_mfg'),
  ('sop_r2', 'ws_remind', 'Still a draft', '{"meta":{}}'::jsonb, 'f0000000-0000-0000-0000-000000000001', 'dept_r_mfg');

insert into public.sop_review_seats (sop_id, department_id, rasic, signer_id) values
  ('sop_r1', 'dept_r_mfg', 'responsible', 'f0000000-0000-0000-0000-000000000002'),
  ('sop_r1', 'dept_r_eng', 'responsible', 'f0000000-0000-0000-0000-000000000003'),
  ('sop_r2', 'dept_r_mfg', 'responsible', 'f0000000-0000-0000-0000-000000000002');

create or replace function test_as(p_uid text) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
end $$;

-- The author submits sop_r1 for review; sop_r2 stays a draft.
select test_as('f0000000-0000-0000-0000-000000000001');
select public.sign_sop('sop_r1', 'authorship');
update public.sops set status = 'in_review' where id = 'sop_r1';

-- ---------------------------------------------------------------------------
-- 1-3. Who may remind.
-- ---------------------------------------------------------------------------
select test_as('f0000000-0000-0000-0000-000000000004');
select throws_ok(
  $$ select public.remind_sop_reviewer('sop_r1', 'f0000000-0000-0000-0000-000000000002') $$,
  '42501', 'Only the author of this SOP can send reminders',
  'a bystander cannot remind'
);

select test_as('f0000000-0000-0000-0000-000000000003');
select throws_ok(
  $$ select public.remind_sop_reviewer('sop_r1', 'f0000000-0000-0000-0000-000000000002') $$,
  '42501', 'Only the author of this SOP can send reminders',
  'a fellow reviewer cannot remind'
);

select test_as('f0000000-0000-0000-0000-000000000001');
select lives_ok(
  $$ select public.remind_sop_reviewer('sop_r1', 'f0000000-0000-0000-0000-000000000002') $$,
  'the author can remind an unreturned reviewer'
);

-- ---------------------------------------------------------------------------
-- 4-6. The reminder is an event, and the cooldown holds.
-- ---------------------------------------------------------------------------
select is(
  (select count(*)::int from public.sop_event_log
    where sop_id = 'sop_r1' and event_type = 'reviewer_reminded'
      and details ->> 'reviewer_id' = 'f0000000-0000-0000-0000-000000000002'
      and actor_id = 'f0000000-0000-0000-0000-000000000001'),
  1,
  'the reminder is recorded as a reviewer_reminded event by the author'
);

select throws_ok(
  $$ select public.remind_sop_reviewer('sop_r1', 'f0000000-0000-0000-0000-000000000002') $$,
  'P0001', 'reminder_cooldown',
  'a second reminder to the same reviewer within 24 hours is refused'
);

select lives_ok(
  $$ select public.remind_sop_reviewer('sop_r1', 'f0000000-0000-0000-0000-000000000003') $$,
  'the cooldown is per reviewer, not per SOP'
);

-- ---------------------------------------------------------------------------
-- 7-8. The cooldown expires after 24 hours.
-- ---------------------------------------------------------------------------
reset role;
update public.sop_event_log set created_at = now() - interval '25 hours'
 where sop_id = 'sop_r1' and event_type = 'reviewer_reminded'
   and details ->> 'reviewer_id' = 'f0000000-0000-0000-0000-000000000002';

select test_as('f0000000-0000-0000-0000-000000000001');
select lives_ok(
  $$ select public.remind_sop_reviewer('sop_r1', 'f0000000-0000-0000-0000-000000000002') $$,
  'after 24 hours the author may remind again'
);
select is(
  (select count(*)::int from public.sop_event_log
    where sop_id = 'sop_r1' and event_type = 'reviewer_reminded'
      and details ->> 'reviewer_id' = 'f0000000-0000-0000-0000-000000000002'),
  2,
  'the second reminder is recorded alongside the first'
);

-- ---------------------------------------------------------------------------
-- 9-11. Only seated, unreturned reviewers of an SOP in draft review.
-- ---------------------------------------------------------------------------
select throws_ok(
  $$ select public.remind_sop_reviewer('sop_r1', 'f0000000-0000-0000-0000-000000000004') $$,
  'P0001', 'This person is not a reviewer on this SOP',
  'someone without a seat cannot be reminded'
);

select throws_ok(
  $$ select public.remind_sop_reviewer('sop_r2', 'f0000000-0000-0000-0000-000000000002') $$,
  'P0001', 'Reminders are only for SOPs in draft review',
  'a draft SOP has no one to remind'
);

reset role;
insert into public.sop_review_submissions
  (sop_id, review_cycle, reviewer_id, reviewer_name, no_changes, content_hash)
select 'sop_r1', s.review_cycle, 'f0000000-0000-0000-0000-000000000003', 'Reviewer B', true, s.content_hash
  from public.sops s where s.id = 'sop_r1';
update public.sop_event_log set created_at = now() - interval '25 hours'
 where sop_id = 'sop_r1' and event_type = 'reviewer_reminded';

select test_as('f0000000-0000-0000-0000-000000000001');
select throws_ok(
  $$ select public.remind_sop_reviewer('sop_r1', 'f0000000-0000-0000-0000-000000000003') $$,
  'P0001', 'This reviewer has already returned their review',
  'a reviewer who returned their review cannot be reminded'
);

-- ---------------------------------------------------------------------------
-- 12. The ledger admits the new kind.
-- ---------------------------------------------------------------------------
reset role;
select lives_ok(
  $$ insert into public.sop_notifications (sop_id, recipient_id, kind, reminder_index, review_cycle)
     values ('sop_r1', 'f0000000-0000-0000-0000-000000000002', 'reviewer_reminded', 0, 1) $$,
  'reviewer_reminded is an accepted sop_notifications kind'
);

select * from finish();
rollback;
