-- pgTAP tests for the SOP document-control enforcement layer (the DB is the only gate).
-- Run with the local Supabase stack:  supabase db reset && supabase test db
--
-- Core invariants that survive the RASIC redesign, corrected for the new contract:
--   * DEPT-TYPE-NNN numbering format + transactional mint
--   * a client cannot INSERT a born-"effective" SOP (guard INSERT branch)
--   * content is frozen once an SOP leaves draft
--   * dept approval is quorum-driven: sign_sop auto-advances in_review -> approved when
--     every blocking seat has signed; a manual UPDATE cannot jump the gate
--   * Quality release snapshots exactly one effective revision, stamped with the same
--     content_hash the SOP carries
--
-- Contract assumed for sign_sop v2 (the migrations must match):
--   public.sign_sop(p_sop text, p_meaning text, p_reason text default null,
--                   p_seat_department text default null, p_resolves text default null)
--
-- Auth is simulated the Supabase way: set the JWT claims GUC + role `authenticated` so
-- auth.uid() resolves and RLS applies. Fixtures are created as the owner (RLS bypassed).

begin;
select plan(12);

-- ---------------------------------------------------------------------------
-- Fixtures (owner context: RLS bypassed)
-- ---------------------------------------------------------------------------
-- enforce_signup_domain() rejects emails whose domain is absent from
-- workspace_auto_join_domains, which is empty on a fresh db reset. Seed it before
-- any auth.users insert, and create the workspace it points at first.
insert into public.workspaces (id, name) values ('ws_test', 'Test Org');
insert into public.workspace_auto_join_domains (domain, workspace_id) values ('test.dev', 'ws_test');

insert into auth.users (id, aud, role, email)
values
  ('11111111-1111-1111-1111-111111111111', 'authenticated', 'authenticated', 'author@test.dev'),
  ('22222222-2222-2222-2222-222222222222', 'authenticated', 'authenticated', 'respseat@test.dev'),
  ('33333333-3333-3333-3333-333333333333', 'authenticated', 'authenticated', 'qa@test.dev'),
  ('44444444-4444-4444-4444-444444444444', 'authenticated', 'authenticated', 'acctseat@test.dev');


insert into public.workspace_members (workspace_id, user_id, role) values
  ('ws_test', '11111111-1111-1111-1111-111111111111', 'editor'),
  ('ws_test', '22222222-2222-2222-2222-222222222222', 'editor'),
  ('ws_test', '33333333-3333-3333-3333-333333333333', 'editor'),
  ('ws_test', '44444444-4444-4444-4444-444444444444', 'editor');

insert into public.org_tool_access (user_id, level) values
  ('11111111-1111-1111-1111-111111111111', 'edit'),
  ('22222222-2222-2222-2222-222222222222', 'edit'),
  ('33333333-3333-3333-3333-333333333333', 'edit'),
  ('44444444-4444-4444-4444-444444444444', 'edit');

insert into public.departments (id, workspace_id, code, name, is_quality_gate) values
  ('dept_prd', 'ws_test', 'PRD', 'Production', false),
  ('dept_eng', 'ws_test', 'ENG', 'Engineering', false),
  ('dept_qa', 'ws_test', 'QA', 'Quality', true);

insert into public.department_members (department_id, user_id, dept_role) values
  ('dept_prd', '11111111-1111-1111-1111-111111111111', 'author'),
  ('dept_prd', '22222222-2222-2222-2222-222222222222', 'approver'),
  ('dept_eng', '44444444-4444-4444-4444-444444444444', 'approver'),
  ('dept_qa', '33333333-3333-3333-3333-333333333333', 'approver');

-- Helper: act as a given user with the authenticated role.
create or replace function test_as(p_uid text) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
end $$;

-- ---------------------------------------------------------------------------
-- 1. Numbering format
-- ---------------------------------------------------------------------------
select test_as('11111111-1111-1111-1111-111111111111');
select is(
  public.next_sop_number('ws_test', 'dept_prd', 'SOP'),
  'PRD-SOP-001',
  'next_sop_number formats DEPT-TYPE-NNN and starts at 001'
);
select is(
  public.next_sop_number('ws_test', 'dept_prd', 'SOP'),
  'PRD-SOP-002',
  'next_sop_number increments transactionally'
);

-- ---------------------------------------------------------------------------
-- 2. A client cannot INSERT a born-"effective" SOP — the guard forces draft.
-- ---------------------------------------------------------------------------
insert into public.sops (id, workspace_id, sop_number, title, document, status, created_by, department_id)
values ('sop_born', 'ws_test', 'PRD-SOP-050', 'Sneaky', '{}'::jsonb, 'effective',
        '11111111-1111-1111-1111-111111111111', 'dept_prd');
select is(
  (select status from public.sops where id = 'sop_born'),
  'draft',
  'INSERT with status=effective is forced back to draft'
);

-- A working draft to drive the lifecycle. Seats: one responsible (owning dept) and the
-- mandatory accountable seat (another dept). The submitter (u1) holds no seat.
insert into public.sops (id, workspace_id, sop_number, title, document, status, created_by, department_id)
values ('sop_1', 'ws_test', 'PRD-SOP-010', 'Torque spec', '{"body":"v1"}'::jsonb, 'draft',
        '11111111-1111-1111-1111-111111111111', 'dept_prd');

insert into public.sop_review_seats (sop_id, department_id, rasic, signer_id) values
  ('sop_1', 'dept_prd', 'responsible', '22222222-2222-2222-2222-222222222222'),
  ('sop_1', 'dept_eng', 'accountable', '44444444-4444-4444-4444-444444444444');

-- ---------------------------------------------------------------------------
-- 3. Authorship + submit -> in_review, then content-freeze on a non-draft PATCH.
-- ---------------------------------------------------------------------------
select public.sign_sop('sop_1', 'authorship');
update public.sops set status = 'in_review' where id = 'sop_1';
select is(
  (select submitted_by from public.sops where id = 'sop_1')::text,
  '11111111-1111-1111-1111-111111111111',
  'submitting stamps submitted_by = the submitter'
);

select throws_ok(
  $$ update public.sops set document = '{"body":"tampered"}'::jsonb where id = 'sop_1' $$,
  null,
  'editing the document of an in_review SOP is rejected (content freeze)'
);

-- ---------------------------------------------------------------------------
-- 4. Gate B is not a button: a manual UPDATE cannot advance past an unmet quorum,
--    and the submitter cannot push their own SOP through (SoD).
-- ---------------------------------------------------------------------------
select throws_ok(
  $$ update public.sops set status = 'approved' where id = 'sop_1' $$,
  null,
  'a manual in_review->approved by the submitter with an unmet quorum is refused'
);

-- ---------------------------------------------------------------------------
-- 5. Quorum: each blocking seat signs for its own department; the last blocking
--    signature auto-advances the status inside sign_sop — no explicit UPDATE.
-- ---------------------------------------------------------------------------
select test_as('22222222-2222-2222-2222-222222222222');
select lives_ok(
  $$ select public.sign_sop('sop_1', 'dept_approval', p_seat_department => 'dept_prd') $$,
  'the responsible seat signer can sign the department approval for their seat'
);
select test_as('44444444-4444-4444-4444-444444444444');
select public.sign_sop('sop_1', 'dept_approval', p_seat_department => 'dept_eng');
select is(
  (select status from public.sops where id = 'sop_1'),
  'approved',
  'the last blocking signature auto-advances in_review -> approved inside sign_sop'
);
select isnt(
  (select approved_by from public.sops where id = 'sop_1'),
  null,
  'the auto-advance stamps approved_by server-side'
);

-- ---------------------------------------------------------------------------
-- 6. Quality makes it effective -> one effective revision is pointed to, version
--    stamped 1.0, and the snapshot carries the SOP content_hash.
-- ---------------------------------------------------------------------------
select test_as('33333333-3333-3333-3333-333333333333');
select public.sign_sop('sop_1', 'quality_approval');
update public.sops set status = 'effective' where id = 'sop_1';
select isnt(
  (select effective_revision_id from public.sops where id = 'sop_1'),
  null,
  'becoming effective snapshots a revision and sets effective_revision_id'
);
select is(
  (select version from public.sops where id = 'sop_1'),
  '1.0',
  'first release stamps version 1.0'
);
select is(
  (select r.content_hash from public.sop_revisions r
     join public.sops s on s.effective_revision_id = r.id
    where s.id = 'sop_1'),
  (select content_hash from public.sops where id = 'sop_1'),
  'the effective revision carries the same content_hash the SOP holds'
);

select finish();
rollback;
