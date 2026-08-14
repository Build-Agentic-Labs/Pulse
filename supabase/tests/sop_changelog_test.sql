-- pgTAP: change log + Gate D + the D2 INSERT strip.
--
-- Requirement 8: a change log entry is written ONLY when an already-effective version is
-- revised — v1.0 carries none. Pins:
--   * first release writes zero sop_change_log rows
--   * the next release writes exactly one: from_version = the previously effective
--     revision's version_label, to_version = the newly stamped version, reason carried
--     from revision_reason, revision_id = the snapshot just taken; revision_reason is
--     cleared afterward
--   * Gate D refuses a missing or blank revision_reason on effective -> draft
--   * D2 regression: a raw INSERT carrying lifecycle/version/change-control columns is
--     stripped to a clean draft (else a forged major_version would fake a v1 release and
--     emit a change log entry for a first release)
--
-- sign_sop v2 contract: sign_sop(p_sop, p_meaning, p_reason, p_seat_department, p_resolves).

begin;
select plan(26);

-- ---------------------------------------------------------------------------
-- Fixtures (owner context: RLS bypassed)
-- ---------------------------------------------------------------------------
-- enforce_signup_domain() rejects emails whose domain is absent from
-- workspace_auto_join_domains, which is empty on a fresh db reset. Seed it before
-- any auth.users insert, and create the workspace it points at first.
insert into public.workspaces (id, name) values ('ws_cl', 'Changelog Org');
insert into public.workspace_auto_join_domains (domain, workspace_id) values ('test.dev', 'ws_cl');

insert into auth.users (id, aud, role, email)
values
  ('70000000-0000-0000-0000-000000000001', 'authenticated', 'authenticated', 'cl-author@test.dev'),
  ('70000000-0000-0000-0000-000000000002', 'authenticated', 'authenticated', 'cl-resp@test.dev'),
  ('70000000-0000-0000-0000-000000000003', 'authenticated', 'authenticated', 'cl-acct@test.dev'),
  ('70000000-0000-0000-0000-000000000004', 'authenticated', 'authenticated', 'cl-quality@test.dev');


insert into public.workspace_members (workspace_id, user_id, role) values
  ('ws_cl', '70000000-0000-0000-0000-000000000001', 'editor'),
  ('ws_cl', '70000000-0000-0000-0000-000000000002', 'editor'),
  ('ws_cl', '70000000-0000-0000-0000-000000000003', 'editor'),
  ('ws_cl', '70000000-0000-0000-0000-000000000004', 'editor');

insert into public.org_tool_access (workspace_id, user_id, level)
select 'ws_cl', u.id, 'edit'::public.access_level from (values
  ('70000000-0000-0000-0000-000000000001'::uuid),
  ('70000000-0000-0000-0000-000000000002'::uuid),
  ('70000000-0000-0000-0000-000000000003'::uuid),
  ('70000000-0000-0000-0000-000000000004'::uuid)) as u(id);

insert into public.departments (id, workspace_id, code, name, is_quality_gate) values
  ('dept_cl_prd', 'ws_cl', 'PRD', 'Production', false),
  ('dept_cl_a', 'ws_cl', 'ENG', 'Engineering', false),
  ('dept_cl_b', 'ws_cl', 'MNT', 'Maintenance', false),
  ('dept_cl_qa', 'ws_cl', 'QA', 'Quality', true);

insert into public.department_members (department_id, user_id, dept_role) values
  ('dept_cl_prd', '70000000-0000-0000-0000-000000000001', 'author'),
  ('dept_cl_a', '70000000-0000-0000-0000-000000000002', 'approver'),
  ('dept_cl_b', '70000000-0000-0000-0000-000000000003', 'approver'),
  ('dept_cl_qa', '70000000-0000-0000-0000-000000000004', 'approver');

insert into public.sops (id, workspace_id, sop_number, title, document, status, created_by, department_id)
values ('sop_cl_1', 'ws_cl', 'PRD-SOP-001', 'Torque spec', '{"step":"torque to 40 Nm"}'::jsonb, 'draft',
        '70000000-0000-0000-0000-000000000001', 'dept_cl_prd');

insert into public.sop_review_seats (sop_id, department_id, rasic, signer_id) values
  ('sop_cl_1', 'dept_cl_a', 'responsible', '70000000-0000-0000-0000-000000000002'),
  ('sop_cl_1', 'dept_cl_b', 'responsible', '70000000-0000-0000-0000-000000000003');

-- Helper: act as a given user with the authenticated role.
create or replace function test_as(p_uid text) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
end $$;

-- Helper: drive sop_cl_1 through authorship/quorum/quality to effective.
create or replace function release_sop_cl_1() returns void language plpgsql as $$
begin
  perform test_as('70000000-0000-0000-0000-000000000001');
  perform public.sign_sop('sop_cl_1', 'authorship');
  update public.sops set status = 'in_review' where id = 'sop_cl_1';
  -- Preconditions added after this suite was written; see
  -- test_ready_for_approval in supabase/seed.sql.
  perform public.test_ready_for_approval('sop_cl_1');
  perform test_as('70000000-0000-0000-0000-000000000002');
  perform public.sign_sop('sop_cl_1', 'dept_approval', p_seat_department => 'dept_cl_a');
  perform test_as('70000000-0000-0000-0000-000000000003');
  perform public.sign_sop('sop_cl_1', 'dept_approval', p_seat_department => 'dept_cl_b');
  perform test_as('70000000-0000-0000-0000-000000000004');
  perform public.sign_sop('sop_cl_1', 'quality_approval');
  update public.sops set status = 'effective' where id = 'sop_cl_1';
end $$;

-- ---------------------------------------------------------------------------
-- 1/2. First release: v1.0, and NO change log entry.
-- ---------------------------------------------------------------------------
select release_sop_cl_1();
select is(
  (select version from public.sops where id = 'sop_cl_1'),
  '1.0',
  'first release stamps v1.0'
);
reset role;
select is(
  (select count(*) from public.sop_change_log where sop_id = 'sop_cl_1'),
  0::bigint,
  'a first release writes zero sop_change_log rows'
);
select is(
  (select document->'changeHistory'->0->>'version' from public.sops where id = 'sop_cl_1'),
  'V1',
  'the system creates the immutable V1 initial-release history row'
);

-- ---------------------------------------------------------------------------
-- 3/4/5. Gate D: a revision needs a non-blank reason.
-- ---------------------------------------------------------------------------
select test_as('70000000-0000-0000-0000-000000000002');
-- The reviewer sits outside the owning department, so the sops UPDATE policy filters the row:
-- the statement touches zero rows rather than raising (same pattern as sop_rls_test.sql).
-- Assert the document did not reopen -- a raise would equally satisfy a naive throws_ok.
update public.sops set status = 'draft', revision_reason = 'Unauthorized edit', change_significance = 'MINOR' where id = 'sop_cl_1';
select is(
  (select status from public.sops where id = 'sop_cl_1'),
  'effective',
  'a department reviewer cannot reopen the author''s effective SOP'
);
select test_as('70000000-0000-0000-0000-000000000001');
select throws_ok(
  $$ update public.sops set status = 'draft', change_significance = 'MINOR' where id = 'sop_cl_1' $$,
  null,
  'starting a revision without a revision_reason is refused (Gate D)'
);
select throws_ok(
  $$ update public.sops set status = 'draft', revision_reason = '   ', change_significance = 'MINOR' where id = 'sop_cl_1' $$,
  null,
  'a whitespace-only revision_reason is refused (Gate D)'
);
select lives_ok(
  $$ update public.sops set status = 'draft', revision_reason = 'Updated torque values', change_significance = 'MINOR' where id = 'sop_cl_1' $$,
  'a real revision_reason opens the revision'
);
select is(
  (select (document->'changeHistory'->-1->>'version') || ':' || (document->'changeHistory'->-1->>'changes')
     from public.sops where id = 'sop_cl_1'),
  'V1.1:Updated torque values',
  'an amendment appends the system-managed V1.1 history row and reason'
);
update public.sops
   set document = jsonb_set(document, '{changeHistory,0,changes}', '"tampered"'::jsonb)
 where id = 'sop_cl_1';
select is(
  (select document->'changeHistory'->0->>'changes' from public.sops where id = 'sop_cl_1'),
  'Initial release',
  'a direct draft update cannot rewrite a system-managed history row'
);

-- ---------------------------------------------------------------------------
-- 6..12. Revise, re-approve, release: exactly one change log row, correctly derived.
-- ---------------------------------------------------------------------------
update public.sops set document = '{"step":"torque to 45 Nm"}'::jsonb where id = 'sop_cl_1';
select release_sop_cl_1();
select is(
  (select status from public.sops where id = 'sop_cl_1'),
  'effective',
  'fixture: the revision released'
);
reset role;
select is(
  (select count(*) from public.sop_change_log where sop_id = 'sop_cl_1'),
  1::bigint,
  'revising an already-effective SOP writes exactly one change log row'
);
select is(
  (select from_version from public.sop_change_log where sop_id = 'sop_cl_1'),
  '1.0',
  'from_version is the previously effective revision''s version_label'
);
select is(
  (select to_version from public.sop_change_log where sop_id = 'sop_cl_1'),
  '1.1',
  'to_version is the newly stamped version'
);
select is(
  (select reason from public.sop_change_log where sop_id = 'sop_cl_1'),
  'Updated torque values',
  'the reason is carried from revision_reason'
);
select is(
  (select revision_id from public.sop_change_log where sop_id = 'sop_cl_1'),
  (select effective_revision_id from public.sops where id = 'sop_cl_1'),
  'the change log row references the snapshot just taken'
);
select is(
  (select revision_reason from public.sops where id = 'sop_cl_1'),
  null::text,
  'revision_reason is cleared after the release consumes it'
);

-- ---------------------------------------------------------------------------
-- 13..21. D2 regression: a raw PostgREST-shaped INSERT cannot forge lifecycle,
-- version, hash/cycle, or change-control columns.
-- ---------------------------------------------------------------------------
select test_as('70000000-0000-0000-0000-000000000001');
insert into public.sops
  (id, workspace_id, sop_number, title, document, status, created_by, department_id,
   major_version, minor_version, version, content_hash, review_cycle, revision_reason,
   change_significance, requires_retraining)
values
  ('sop_cl_2', 'ws_cl', 'PRD-SOP-666', 'Forged', '{"body":"raw"}'::jsonb, 'effective',
   '70000000-0000-0000-0000-000000000001', 'dept_cl_prd',
   1, 5, '9.9', 'forged-hash', 7, 'sneaky reason', 'major', true);

select is((select status from public.sops where id = 'sop_cl_2'), 'draft',
  'raw INSERT: status is forced to draft (D2)');
-- A number is earned at release. A forged one would also be SKIPPED by the mint's collision
-- loop when the sequence reached it, reopening the gap deferred numbering closes.
select is((select sop_number from public.sops where id = 'sop_cl_2'), null::text,
  'raw INSERT: sop_number is stripped (deferred numbering)');
select is((select major_version from public.sops where id = 'sop_cl_2'), null::smallint,
  'raw INSERT: major_version is stripped (D2)');
select is((select minor_version from public.sops where id = 'sop_cl_2'), null::smallint,
  'raw INSERT: minor_version is stripped (D2)');
select is((select version from public.sops where id = 'sop_cl_2'), null::text,
  'raw INSERT: version is stripped (D2)');
select is((select review_cycle from public.sops where id = 'sop_cl_2'), 0,
  'raw INSERT: review_cycle starts at 0 (D2)');
select is((select revision_reason from public.sops where id = 'sop_cl_2'), null::text,
  'raw INSERT: revision_reason is stripped (D2)');
select is((select change_significance from public.sops where id = 'sop_cl_2'), null::text,
  'raw INSERT: change_significance is stripped (D2)');
select is((select requires_retraining from public.sops where id = 'sop_cl_2'), false,
  'raw INSERT: requires_retraining is stripped (D2)');
select is(
  (select content_hash from public.sops where id = 'sop_cl_2'),
  (select public.sop_doc_hash(document) from public.sops where id = 'sop_cl_2'),
  'raw INSERT: content_hash is computed by the trigger, not taken from the client'
);

select finish();
rollback;
