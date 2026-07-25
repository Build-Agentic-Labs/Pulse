-- pgTAP tests for the SOP document-control enforcement layer (the DB is the only gate).
-- Run with the local Supabase stack:  supabase db reset && supabase test db
--
-- Core invariants that survive the RASIC redesign, corrected for the new contract:
--   * TYPE-DEPT-NNN numbering, EARNED AT RELEASE: unnumbered through draft/review/approval,
--     minted inside approved -> effective, unwritable by any client, kept across a revision
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
select plan(26);

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

-- Since 20260715190000 a signer must have a saved handwritten signature; sign_sop snapshots it
-- onto the signature row. Seed one per user so the lifecycle below can be driven.
insert into public.user_signature_profiles (user_id, signature_strokes) values
  ('11111111-1111-1111-1111-111111111111', '[[{"x":0,"y":0},{"x":1,"y":1}]]'::jsonb),
  ('22222222-2222-2222-2222-222222222222', '[[{"x":0,"y":0},{"x":1,"y":1}]]'::jsonb),
  ('33333333-3333-3333-3333-333333333333', '[[{"x":0,"y":0},{"x":1,"y":1}]]'::jsonb),
  ('44444444-4444-4444-4444-444444444444', '[[{"x":0,"y":0},{"x":1,"y":1}]]'::jsonb);

-- Helper: act as a given user with the authenticated role.
create or replace function test_as(p_uid text) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
end $$;

-- ---------------------------------------------------------------------------
-- 1. Numbering is not a client operation. A number is earned at release, so no client may
--    mint one on demand -- that is what used to let a discarded draft burn a sequence slot.
-- ---------------------------------------------------------------------------
select test_as('11111111-1111-1111-1111-111111111111');
select throws_ok(
  $$ select public.next_sop_number('ws_test', 'dept_prd', 'SOP') $$,
  null,
  'a client cannot mint a number directly (execute revoked)'
);
select throws_ok(
  $$ select public.mint_sop_number_internal('ws_test', 'dept_prd', 'SOP') $$,
  null,
  'a client cannot reach the internal mint either'
);

-- ---------------------------------------------------------------------------
-- 1b. The number is not signed content. This is what lets the release edge stamp a number
--     into the document without stranding the signature that authorized the release.
-- ---------------------------------------------------------------------------
select is(
  public.sop_doc_hash('{"body":"x","meta":{"title":"t"}}'::jsonb),
  public.sop_doc_hash('{"body":"x","meta":{"title":"t","sopNumber":"SOP-PRD-001"}}'::jsonb),
  'sop_doc_hash ignores meta.sopNumber, so stamping the number moves no hash'
);
select isnt(
  public.sop_doc_hash('{"body":"x","meta":{"title":"t"}}'::jsonb),
  public.sop_doc_hash('{"body":"y","meta":{"title":"t"}}'::jsonb),
  'sop_doc_hash still tracks real content'
);

-- ---------------------------------------------------------------------------
-- 2. A client cannot INSERT a born-"effective" SOP — the guard forces draft.
-- ---------------------------------------------------------------------------
insert into public.sops (id, workspace_id, sop_number, title, document, status, created_by, department_id)
values ('sop_born', 'ws_test', 'SOP-PRD-050', 'Sneaky', '{}'::jsonb, 'effective',
        '11111111-1111-1111-1111-111111111111', 'dept_prd');
select is(
  (select status from public.sops where id = 'sop_born'),
  'draft',
  'INSERT with status=effective is forced back to draft'
);
-- A squatted number would be skipped by the mint's collision loop, reopening the very gap
-- deferred numbering closes. The guard clamps it rather than trusting the client.
select is(
  (select sop_number from public.sops where id = 'sop_born'),
  null,
  'INSERT carrying a sop_number has it clamped to null'
);

-- A working draft to drive the lifecycle. Seats: one responsible (owning dept) and the
-- mandatory accountable seat (another dept). The submitter (u1) holds no seat.
insert into public.sops (id, workspace_id, sop_number, title, document, status, created_by, department_id)
values ('sop_1', 'ws_test', 'SOP-PRD-010', 'Torque spec', '{"body":"v1","meta":{"title":"Torque spec"}}'::jsonb, 'draft',
        '11111111-1111-1111-1111-111111111111', 'dept_prd');

insert into public.sop_review_seats (sop_id, department_id, rasic, signer_id) values
  ('sop_1', 'dept_prd', 'responsible', '22222222-2222-2222-2222-222222222222'),
  ('sop_1', 'dept_eng', 'responsible', '44444444-4444-4444-4444-444444444444');

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
-- 4b. Draft review, then the final-approval request. Since 20260715172000 a seat cannot sign
--     its department approval until the author has asked for final approval, and the author
--     cannot ask until every required approver has returned the draft with no changes against
--     the CURRENT content hash and review cycle.
-- ---------------------------------------------------------------------------
reset role;
insert into public.sop_review_submissions
  (sop_id, review_cycle, reviewer_id, reviewer_name, no_changes, content_hash)
select 'sop_1', s.review_cycle, seat.signer_id, 'Reviewer', true, s.content_hash
  from public.sops s
  join public.sop_review_seats seat on seat.sop_id = s.id
 where s.id = 'sop_1';

select test_as('11111111-1111-1111-1111-111111111111');
select lives_ok(
  $$ select public.request_sop_final_approval('sop_1') $$,
  'the author can request final approval once every required approver returned no changes'
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
select is(
  (select sop_number from public.sops where id = 'sop_1'),
  null,
  'an approved SOP is still unnumbered: the number comes at release, not at approval'
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

-- ---------------------------------------------------------------------------
-- 7. The number is earned here, and nowhere else.
-- ---------------------------------------------------------------------------
select is(
  (select sop_number from public.sops where id = 'sop_1'),
  'SOP-PRD-001',
  'release mints the first number in the department sequence'
);
-- The frozen snapshot must be self-describing: snapshot_sop_revision reads the OLD row, so the
-- release edge hands it the stamped document explicitly. Without that the archived controlled
-- copy would read SOP-PRD-###.
select is(
  (select r.document #>> '{meta,sopNumber}' from public.sop_revisions r
     join public.sops s on s.effective_revision_id = r.id
    where s.id = 'sop_1'),
  'SOP-PRD-001',
  'the frozen revision carries the number it was released under'
);
-- Signatures bind to content_hash, and the number is excluded from that hash, so the
-- quality_approval signed before the stamp is still bound to the released document.
select is(
  (select count(*)::int from public.sop_signatures g
    where g.sop_id = 'sop_1' and g.meaning = 'quality_approval'
      and g.signed_content_hash = (select content_hash from public.sops where id = 'sop_1')),
  1,
  'stamping the number does not strand the signature that authorized the release'
);
update public.sops set sop_number = 'SOP-PRD-999' where id = 'sop_1';
select is(
  (select sop_number from public.sops where id = 'sop_1'),
  'SOP-PRD-001',
  'a client UPDATE of sop_number is silently pinned to the minted value, not honoured'
);

-- ---------------------------------------------------------------------------
-- 8. Effective is terminal: retired only by supersession, never by deletion.
-- ---------------------------------------------------------------------------
select throws_like(
  $$ update public.sops set status = 'obsolete' where id = 'sop_1' $$,
  '%retired by releasing a new version%',
  'effective -> obsolete is refused, with the supersede guidance'
);

-- is_manager must be no exemption for deletion, so this has to be attempted BY a manager --
-- as a plain editor it would be refused by the pre-existing guard regardless. Elevated for
-- this one assertion and put back immediately so nothing downstream sees a manager.
reset role;
update public.workspace_members set role = 'admin'
 where workspace_id = 'ws_test' and user_id = '11111111-1111-1111-1111-111111111111';
select test_as('11111111-1111-1111-1111-111111111111');
select throws_like(
  $$ update public.sops set deleted_at = now() where id = 'sop_1' $$,
  '%cannot be deleted; release a new version%',
  'an effective SOP cannot be soft-deleted, workspace admin included'
);
reset role;
update public.workspace_members set role = 'editor'
 where workspace_id = 'ws_test' and user_id = '11111111-1111-1111-1111-111111111111';
select test_as('11111111-1111-1111-1111-111111111111');

-- ---------------------------------------------------------------------------
-- 9. A revision keeps the document's number and only moves the version. The number names
--    the document; the version names the release.
-- ---------------------------------------------------------------------------
update public.sops set status = 'draft', revision_reason = 'Torque value corrected'
 where id = 'sop_1';
update public.sops set document = '{"body":"v2","meta":{"title":"Torque spec"}}'::jsonb where id = 'sop_1';
select is(
  (select sop_number from public.sops where id = 'sop_1'),
  'SOP-PRD-001',
  'opening a revision keeps the number'
);

select public.sign_sop('sop_1', 'authorship');
update public.sops set status = 'in_review' where id = 'sop_1';

-- The revision bumped review_cycle and the edit changed content_hash, so the draft-review
-- submissions must be made again for this cycle before final approval can be requested.
reset role;
insert into public.sop_review_submissions
  (sop_id, review_cycle, reviewer_id, reviewer_name, no_changes, content_hash)
select 'sop_1', s.review_cycle, seat.signer_id, 'Reviewer', true, s.content_hash
  from public.sops s
  join public.sop_review_seats seat on seat.sop_id = s.id
 where s.id = 'sop_1';
select test_as('11111111-1111-1111-1111-111111111111');
select public.request_sop_final_approval('sop_1');

select test_as('22222222-2222-2222-2222-222222222222');
select public.sign_sop('sop_1', 'dept_approval', p_seat_department => 'dept_prd');
select test_as('44444444-4444-4444-4444-444444444444');
select public.sign_sop('sop_1', 'dept_approval', p_seat_department => 'dept_eng');
select test_as('33333333-3333-3333-3333-333333333333');
select public.sign_sop('sop_1', 'quality_approval');
update public.sops set status = 'effective' where id = 'sop_1';
select is(
  (select sop_number || ' @ ' || version from public.sops where id = 'sop_1'),
  'SOP-PRD-001 @ 1.1',
  'a second release keeps the number and advances only the version'
);
-- The counter must not have moved for the revision: only first releases consume a slot.
reset role;
select is(
  (select next_seq from public.doc_number_counter
    where workspace_id = 'ws_test' and department_id = 'dept_prd' and doc_type = 'SOP'),
  2,
  'a revision consumes no sequence slot -- the counter still points at 002'
);

select finish();
rollback;
