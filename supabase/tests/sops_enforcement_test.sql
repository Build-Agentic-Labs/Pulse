-- pgTAP tests for the SOP document-control enforcement layer (the DB is the only gate).
-- Run with the local Supabase stack:  supabase db reset && supabase test db
--
-- These exercise the load-bearing invariants the two Fable reviews centered on:
--   * a client cannot INSERT a born-"effective" SOP (guard v2 INSERT branch)
--   * content is frozen once an SOP leaves draft, incl. on a document-only PATCH
--   * segregation of duties: the submitter cannot approve; approved_by is DB-stamped
--   * DEPT-TYPE-NNN numbering format + transactional mint
--   * one effective revision is named by sops.effective_revision_id
--
-- Auth is simulated the Supabase way: set the JWT claims GUC + role `authenticated` so
-- auth.uid() resolves and RLS applies. Fixtures are created as the owner (RLS bypassed).

begin;
select plan(9);

-- ---------------------------------------------------------------------------
-- Fixtures (owner context: RLS bypassed)
-- ---------------------------------------------------------------------------
insert into auth.users (id, aud, role, email)
values
  ('11111111-1111-1111-1111-111111111111', 'authenticated', 'authenticated', 'author@test.dev'),
  ('22222222-2222-2222-2222-222222222222', 'authenticated', 'authenticated', 'deptapprover@test.dev'),
  ('33333333-3333-3333-3333-333333333333', 'authenticated', 'authenticated', 'qa@test.dev');

insert into public.workspaces (id, name) values ('ws_test', 'Test Org');

insert into public.workspace_members (workspace_id, user_id, role) values
  ('ws_test', '11111111-1111-1111-1111-111111111111', 'editor'),
  ('ws_test', '22222222-2222-2222-2222-222222222222', 'editor'),
  ('ws_test', '33333333-3333-3333-3333-333333333333', 'editor');

insert into public.org_tool_access (user_id, level) values
  ('11111111-1111-1111-1111-111111111111', 'edit'),
  ('22222222-2222-2222-2222-222222222222', 'edit'),
  ('33333333-3333-3333-3333-333333333333', 'edit');

insert into public.departments (id, workspace_id, code, name, is_quality_gate) values
  ('dept_prd', 'ws_test', 'PRD', 'Production', false),
  ('dept_qa', 'ws_test', 'QA', 'Quality', true);

insert into public.department_members (department_id, user_id, dept_role) values
  ('dept_prd', '11111111-1111-1111-1111-111111111111', 'author'),
  ('dept_prd', '22222222-2222-2222-2222-222222222222', 'approver'),
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

-- A working draft to drive the lifecycle.
insert into public.sops (id, workspace_id, sop_number, title, document, status, created_by, department_id)
values ('sop_1', 'ws_test', 'PRD-SOP-010', 'Torque spec', '{"body":"v1"}'::jsonb, 'draft',
        '11111111-1111-1111-1111-111111111111', 'dept_prd');

-- ---------------------------------------------------------------------------
-- 3. Submit → in_review (author), then content-freeze on a non-draft PATCH.
-- ---------------------------------------------------------------------------
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
-- 4. Segregation of duties: the submitter cannot approve their own SOP.
-- ---------------------------------------------------------------------------
select test_as('11111111-1111-1111-1111-111111111111');
-- author signs dept_approval? sign_sop requires approver role — author lacks it, and even the
-- transition self-approval check would bite. Assert the transition is rejected for the submitter.
select throws_ok(
  $$ update public.sops set status = 'approved' where id = 'sop_1' $$,
  null,
  'the submitter cannot move their own SOP to approved (SoD)'
);

-- ---------------------------------------------------------------------------
-- 5. Real approval by the dept approver (different person) after signing.
-- ---------------------------------------------------------------------------
select test_as('22222222-2222-2222-2222-222222222222');
select lives_ok(
  $$ select public.sign_sop('sop_1', 'dept_approval') $$,
  'the dept approver can sign the department approval'
);
update public.sops set status = 'approved' where id = 'sop_1';
select is(
  (select approved_by from public.sops where id = 'sop_1')::text,
  '22222222-2222-2222-2222-222222222222',
  'approval stamps approved_by = the approver (DB-stamped, not client)'
);

-- ---------------------------------------------------------------------------
-- 6. Quality makes it effective → one effective revision is pointed to.
-- ---------------------------------------------------------------------------
select test_as('33333333-3333-3333-3333-333333333333');
select public.sign_sop('sop_1', 'quality_approval');
update public.sops set status = 'effective' where id = 'sop_1';
select isnt(
  (select effective_revision_id from public.sops where id = 'sop_1'),
  null,
  'becoming effective snapshots a revision and sets effective_revision_id'
);

select finish();
rollback;
