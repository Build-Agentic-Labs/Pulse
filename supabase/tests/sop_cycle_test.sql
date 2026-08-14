-- pgTAP: cycle binding — signatures bind to (content_hash, review_cycle), not content alone.
--
-- The replay attack this kills: release v1.0 at hash H, start a revision, edit, then revert
-- so the document is byte-identical to H. Content-only binding would make every v1.0
-- signature "valid" again and quorum satisfied before anyone reviews. Since 20260805200000
-- the system-managed changeHistory is part of the hashed document and every effective -> draft
-- edge appends a history row a draft save cannot rewrite, so the byte-identical document is
-- no longer even constructible. Pins:
--   * effective -> draft increments review_cycle (and only that edge — the within-cycle
--     behavior is pinned by the reject/resubmit case below)
--   * a revert to a prior version's body cannot reproduce that version's exact hash (the
--     appended history row blocks the replay precondition), and the prior cycle's approvals
--     still count for nothing at resubmit
--   * within one cycle, reject -> resubmit with NO edit preserves the other seats'
--     signatures: only the objector must act
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
insert into public.workspaces (id, name) values ('ws_cycle', 'Cycle Org');
insert into public.workspace_auto_join_domains (domain, workspace_id) values ('test.dev', 'ws_cycle');

insert into auth.users (id, aud, role, email)
values
  ('60000000-0000-0000-0000-000000000001', 'authenticated', 'authenticated', 'cy-author@test.dev'),
  ('60000000-0000-0000-0000-000000000002', 'authenticated', 'authenticated', 'cy-resp@test.dev'),
  ('60000000-0000-0000-0000-000000000003', 'authenticated', 'authenticated', 'cy-acct@test.dev'),
  ('60000000-0000-0000-0000-000000000004', 'authenticated', 'authenticated', 'cy-quality@test.dev'),
  ('60000000-0000-0000-0000-000000000005', 'authenticated', 'authenticated', 'cy-admin@test.dev');


insert into public.workspace_members (workspace_id, user_id, role) values
  ('ws_cycle', '60000000-0000-0000-0000-000000000001', 'editor'),
  ('ws_cycle', '60000000-0000-0000-0000-000000000002', 'editor'),
  ('ws_cycle', '60000000-0000-0000-0000-000000000003', 'editor'),
  ('ws_cycle', '60000000-0000-0000-0000-000000000004', 'editor'),
  ('ws_cycle', '60000000-0000-0000-0000-000000000005', 'admin');

insert into public.org_tool_access (workspace_id, user_id, level)
select 'ws_cycle', u.id, 'edit'::public.access_level from (values
  ('60000000-0000-0000-0000-000000000001'::uuid),
  ('60000000-0000-0000-0000-000000000002'::uuid),
  ('60000000-0000-0000-0000-000000000003'::uuid),
  ('60000000-0000-0000-0000-000000000004'::uuid)) as u(id);

insert into public.departments (id, workspace_id, code, name, is_quality_gate) values
  ('dept_cy_prd', 'ws_cycle', 'PRD', 'Production', false),
  ('dept_cy_a', 'ws_cycle', 'ENG', 'Engineering', false),
  ('dept_cy_b', 'ws_cycle', 'MNT', 'Maintenance', false),
  ('dept_cy_qa', 'ws_cycle', 'QA', 'Quality', true);

insert into public.department_members (department_id, user_id, dept_role) values
  ('dept_cy_prd', '60000000-0000-0000-0000-000000000001', 'author'),
  ('dept_cy_a', '60000000-0000-0000-0000-000000000002', 'approver'),
  ('dept_cy_b', '60000000-0000-0000-0000-000000000003', 'approver'),
  ('dept_cy_qa', '60000000-0000-0000-0000-000000000004', 'approver');

insert into public.sops (id, workspace_id, sop_number, title, document, status, created_by, department_id)
values ('sop_cy_1', 'ws_cycle', 'PRD-SOP-001', 'Replay bait', '{"body":"cycle v1"}'::jsonb, 'draft',
        '60000000-0000-0000-0000-000000000001', 'dept_cy_prd');

insert into public.sop_review_seats (sop_id, department_id, rasic, signer_id) values
  ('sop_cy_1', 'dept_cy_a', 'responsible', '60000000-0000-0000-0000-000000000002'),
  ('sop_cy_1', 'dept_cy_b', 'responsible', '60000000-0000-0000-0000-000000000003');

create temp table _ids (k text primary key, v text);
grant select on _ids to authenticated;

-- Helper: act as a given user with the authenticated role.
create or replace function test_as(p_uid text) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
end $$;

-- ---------------------------------------------------------------------------
-- 1. Release v1.0 at hash H.
-- ---------------------------------------------------------------------------
select test_as('60000000-0000-0000-0000-000000000001');
select public.sign_sop('sop_cy_1', 'authorship');
update public.sops set status = 'in_review' where id = 'sop_cy_1';
-- Preconditions added after this suite was written; see
-- test_ready_for_approval in supabase/seed.sql.
select public.test_ready_for_approval('sop_cy_1');
select test_as('60000000-0000-0000-0000-000000000002');
select public.sign_sop('sop_cy_1', 'dept_approval', p_seat_department => 'dept_cy_a');
select test_as('60000000-0000-0000-0000-000000000003');
select public.sign_sop('sop_cy_1', 'dept_approval', p_seat_department => 'dept_cy_b');
select test_as('60000000-0000-0000-0000-000000000004');
select public.sign_sop('sop_cy_1', 'quality_approval');
update public.sops set status = 'effective' where id = 'sop_cy_1';
select is(
  (select version from public.sops where id = 'sop_cy_1'),
  '1.0',
  'fixture: v1.0 is effective'
);

-- ---------------------------------------------------------------------------
-- 2/3. Start a revision: effective -> draft increments review_cycle.
-- ---------------------------------------------------------------------------
select test_as('60000000-0000-0000-0000-000000000001');
select lives_ok(
  $$ update public.sops set status = 'draft', revision_reason = 'periodic review', change_significance = 'MINOR' where id = 'sop_cy_1' $$,
  'an owning-department member starts a revision with a reason'
);
select is(
  (select review_cycle from public.sops where id = 'sop_cy_1'),
  1,
  'starting a revision increments review_cycle'
);

-- ---------------------------------------------------------------------------
-- 4. Edit, then revert the body to the released v1.0 content. The draft still carries the
--    system-managed V1.1 history row appended at effective -> draft (20260805200000), the
--    trigger reinstates stored history on every save, and changeHistory is hashed — so the
--    reverted draft can never reproduce the released v1.0 hash. The replay precondition
--    itself is now unconstructible.
-- ---------------------------------------------------------------------------
update public.sops set document = '{"body":"cycle v2"}'::jsonb where id = 'sop_cy_1';
update public.sops set document = '{"body":"cycle v1"}'::jsonb where id = 'sop_cy_1';
select isnt(
  (select content_hash from public.sops where id = 'sop_cy_1'),
  (select r.content_hash from public.sop_revisions r
     join public.sops s on s.effective_revision_id = r.id
    where s.id = 'sop_cy_1'),
  'a reverted body cannot reproduce the v1.0 hash (system-managed history blocks the replay precondition)'
);

-- ---------------------------------------------------------------------------
-- 5/6. Resubmit in the new cycle: the v1.0 approvals must count for NOTHING.
-- ---------------------------------------------------------------------------
select public.sign_sop('sop_cy_1', 'authorship');
update public.sops set status = 'in_review' where id = 'sop_cy_1';
-- Preconditions added after this suite was written; see
-- test_ready_for_approval in supabase/seed.sql.
select public.test_ready_for_approval('sop_cy_1');
select is(
  (select status from public.sops where id = 'sop_cy_1'),
  'in_review',
  'fixture: the revision is back in review'
);
select test_as('60000000-0000-0000-0000-000000000005');
select throws_ok(
  $$ update public.sops set status = 'approved' where id = 'sop_cy_1' $$,
  null,
  'the v1.0 dept approvals do not satisfy quorum in the new cycle (cycle binding)'
);

-- 7. One fresh signature is still only one of two.
select test_as('60000000-0000-0000-0000-000000000002');
select public.sign_sop('sop_cy_1', 'dept_approval', p_seat_department => 'dept_cy_a');
select is(
  (select status from public.sops where id = 'sop_cy_1'),
  'in_review',
  'the other seat''s prior-cycle signature does not count toward the new quorum'
);

-- ---------------------------------------------------------------------------
-- 8/9/10. Within the cycle: reject -> resubmit with NO edit disturbs nobody but
-- the objector. The responsible seat's cycle-1 signature must survive.
-- ---------------------------------------------------------------------------
select test_as('60000000-0000-0000-0000-000000000003');
select public.sign_sop('sop_cy_1', 'rejection', 'hold for maintenance window', p_seat_department => 'dept_cy_b');
select is(
  (select status from public.sops where id = 'sop_cy_1'),
  'draft',
  'the rejection moved the revision back to draft inside sign_sop'
);

reset role;
insert into _ids
select 'ocy1', g.id
from public.sop_signatures g
join public.sops s on s.id = g.sop_id
where g.sop_id = 'sop_cy_1'
  and g.meaning = 'rejection'
  and g.signer_id = '60000000-0000-0000-0000-000000000003'
  and g.signed_content_hash = s.content_hash
  and g.review_cycle = s.review_cycle;

select test_as('60000000-0000-0000-0000-000000000003');
select lives_ok(
  $$ select public.sign_sop('sop_cy_1', 'objection_withdrawn',
       p_resolves => (select v from _ids where k = 'ocy1')) $$,
  'the objector withdraws their objection'
);
select test_as('60000000-0000-0000-0000-000000000001');
update public.sops set status = 'in_review' where id = 'sop_cy_1';
-- Preconditions added after this suite was written; see
-- test_ready_for_approval in supabase/seed.sql.
select public.test_ready_for_approval('sop_cy_1');
-- Only the objector signs; the responsible seat does NOT re-sign. Quorum must complete.
select test_as('60000000-0000-0000-0000-000000000003');
select public.sign_sop('sop_cy_1', 'dept_approval', p_seat_department => 'dept_cy_b');
select is(
  (select status from public.sops where id = 'sop_cy_1'),
  'approved',
  'an unedited resubmit preserved the other seat''s signature — only the objector acted'
);

select finish();
rollback;
