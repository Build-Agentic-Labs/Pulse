-- End-to-end walkthrough: create a REAL SOP and drive it through every gate.
--
-- Unlike the pgTAP suite (which pins invariants in isolation), this reads top to bottom as the
-- story an operator would live: Production authors an SOP, Engineering and Maintenance are the
-- responsible departments, Quality releases it. At each gate we first attempt the ILLEGAL move
-- and show it is refused, then make the legal one.
--
-- Run against the local container only:
--   docker exec -i supabase_db_pulse psql -U postgres -d postgres -v ON_ERROR_STOP=1 -f -

\set ON_ERROR_STOP on
begin;

-- ── helpers ────────────────────────────────────────────────────────────────────
create or replace function test_as(p_uid text) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
end $$;

-- Assert a statement is REFUSED. Fails loudly if it succeeds.
create or replace function must_fail(p_sql text, p_label text) returns void language plpgsql as $$
begin
  begin
    execute p_sql;
  exception when others then
    raise notice '  REFUSED (correct): % -- %', p_label, sqlerrm;
    return;
  end;
  raise exception 'GATE HOLE: "%" was ALLOWED but must be refused', p_label;
end $$;

-- Assert a statement is refused FOR A SPECIFIC REASON. A refusal that fires on the wrong check
-- proves nothing about the gate under test.
create or replace function must_fail_with(p_sql text, p_needle text, p_label text) returns void language plpgsql as $$
begin
  begin
    execute p_sql;
  exception when others then
    if position(lower(p_needle) in lower(sqlerrm)) = 0 then
      raise exception 'WRONG REASON for "%": expected a message containing "%", got "%"',
        p_label, p_needle, sqlerrm;
    end if;
    raise notice '  REFUSED (correct reason): % -- %', p_label, sqlerrm;
    return;
  end;
  raise exception 'GATE HOLE: "%" was ALLOWED but must be refused', p_label;
end $$;

create or replace function must_be(p_actual text, p_expected text, p_label text) returns void language plpgsql as $$
begin
  if p_actual is distinct from p_expected then
    raise exception 'EXPECTED % = %, got %', p_label, p_expected, coalesce(p_actual, 'NULL');
  end if;
  raise notice '  OK: % = %', p_label, p_expected;
end $$;

-- ── cast ───────────────────────────────────────────────────────────────────────
insert into public.workspaces (id, name) values ('ws_e2e', 'Anacorp');
insert into public.workspace_auto_join_domains (domain, workspace_id) values ('test.dev', 'ws_e2e');

insert into auth.users (id, aud, role, email) values
  ('a1111111-1111-1111-1111-111111111111', 'authenticated', 'authenticated', 'author@test.dev'),
  ('a2222222-2222-2222-2222-222222222222', 'authenticated', 'authenticated', 'eng@test.dev'),
  ('a3333333-3333-3333-3333-333333333333', 'authenticated', 'authenticated', 'mnt@test.dev'),
  ('a4444444-4444-4444-4444-444444444444', 'authenticated', 'authenticated', 'quality@test.dev'),
  ('a5555555-5555-5555-5555-555555555555', 'authenticated', 'authenticated', 'admin@test.dev');

insert into public.workspace_members (workspace_id, user_id, role) values
  ('ws_e2e', 'a1111111-1111-1111-1111-111111111111', 'editor'),
  ('ws_e2e', 'a2222222-2222-2222-2222-222222222222', 'editor'),
  ('ws_e2e', 'a3333333-3333-3333-3333-333333333333', 'editor'),
  ('ws_e2e', 'a4444444-4444-4444-4444-444444444444', 'editor'),
  ('ws_e2e', 'a5555555-5555-5555-5555-555555555555', 'admin');

insert into public.org_tool_access (user_id, level) values
  ('a1111111-1111-1111-1111-111111111111', 'edit'),
  ('a2222222-2222-2222-2222-222222222222', 'edit'),
  ('a3333333-3333-3333-3333-333333333333', 'edit'),
  ('a4444444-4444-4444-4444-444444444444', 'edit'),
  ('a5555555-5555-5555-5555-555555555555', 'edit');

insert into public.departments (id, workspace_id, code, name, is_quality_gate) values
  ('d_prd', 'ws_e2e', 'PRD', 'Production',  false),
  ('d_eng', 'ws_e2e', 'ENG', 'Engineering', false),
  ('d_mnt', 'ws_e2e', 'MNT', 'Maintenance', false),
  ('d_qa',  'ws_e2e', 'QA',  'Quality',     true);

insert into public.department_members (department_id, user_id, dept_role) values
  ('d_prd', 'a1111111-1111-1111-1111-111111111111', 'author'),
  ('d_eng', 'a2222222-2222-2222-2222-222222222222', 'approver'),
  ('d_mnt', 'a3333333-3333-3333-3333-333333333333', 'approver'),
  ('d_qa',  'a4444444-4444-4444-4444-444444444444', 'approver');

\echo ''
\echo '════════ 1. Production authors an SOP ════════'
select test_as('a1111111-1111-1111-1111-111111111111');

insert into public.sops (id, workspace_id, sop_number, title, document, created_by, department_id)
values ('sop_e2e', 'ws_e2e', 'PRD-SOP-001', 'Torque spec for EBOSS trailer bolts',
        '{"body":"Torque to 90 Nm."}'::jsonb, 'a1111111-1111-1111-1111-111111111111', 'd_prd');

select must_be((select status from public.sops where id='sop_e2e'), 'draft', 'status after create');
select must_be((select review_cycle from public.sops where id='sop_e2e')::text, '0', 'review_cycle');

\echo ''
\echo '════════ 2. Gate A — the roster must be complete before submit ════════'
-- No seats yet: submitting must be refused.
select must_fail($$ update public.sops set status='in_review' where id='sop_e2e' $$,
                 'submit with no responsible/accountable seats');

reset role;
insert into public.sop_review_seats (sop_id, department_id, rasic, signer_id) values
  ('sop_e2e', 'd_eng', 'responsible',  'a2222222-2222-2222-2222-222222222222'),
  ('sop_e2e', 'd_mnt', 'accountable',  'a3333333-3333-3333-3333-333333333333');
select test_as('a1111111-1111-1111-1111-111111111111');

-- Still refused: the author has not signed authorship.
select must_fail($$ update public.sops set status='in_review' where id='sop_e2e' $$,
                 'submit without an authorship signature');

select public.sign_sop('sop_e2e', 'authorship');
update public.sops set status='in_review' where id='sop_e2e';
select must_be((select status from public.sops where id='sop_e2e'), 'in_review', 'status after submit');

\echo ''
\echo '════════ 3. Gate B — only seat holders sign, and quorum is one per blocking seat ════════'
-- The author holds no seat.
select must_fail($$ select public.sign_sop('sop_e2e','dept_approval', p_seat_department => 'd_eng') $$,
                 'author signing a seat they do not hold');

-- Quality may not sign a department approval.
select test_as('a4444444-4444-4444-4444-444444444444');
select must_fail($$ select public.sign_sop('sop_e2e','dept_approval', p_seat_department => 'd_eng') $$,
                 'Quality signing a department approval');

-- An admin holds no seat either.
select test_as('a5555555-5555-5555-5555-555555555555');
select must_fail($$ select public.sign_sop('sop_e2e','dept_approval', p_seat_department => 'd_eng') $$,
                 'workspace admin signing a seat they do not hold');

-- Engineering signs. Quorum is still short of Maintenance.
select test_as('a2222222-2222-2222-2222-222222222222');
select public.sign_sop('sop_e2e', 'dept_approval', p_seat_department => 'd_eng');
select must_be((select status from public.sops where id='sop_e2e'), 'in_review',
               'status with one of two blocking seats signed');

-- Nobody can shove it through by hand.
select test_as('a5555555-5555-5555-5555-555555555555');
select must_fail($$ update public.sops set status='approved' where id='sop_e2e' $$,
                 'admin forcing approval with an unmet quorum');

-- Maintenance signs: the last blocking seat auto-advances the SOP. No button pressed.
select test_as('a3333333-3333-3333-3333-333333333333');
select public.sign_sop('sop_e2e', 'dept_approval', p_seat_department => 'd_mnt');
select must_be((select status from public.sops where id='sop_e2e'), 'approved',
               'status once every blocking seat has signed (auto-advance)');

\echo ''
\echo '════════ 4. Gate C — Quality signs alone, and must be independent ════════'
-- A department seat signer cannot also be the Quality approver.
select test_as('a2222222-2222-2222-2222-222222222222');
select must_fail($$ select public.sign_sop('sop_e2e','quality_approval') $$,
                 'a seat signer signing the quality approval');

-- The author cannot release their own SOP.
select test_as('a1111111-1111-1111-1111-111111111111');
select must_fail($$ select public.sign_sop('sop_e2e','quality_approval') $$,
                 'the author signing the quality approval');

select test_as('a4444444-4444-4444-4444-444444444444');
select public.sign_sop('sop_e2e', 'quality_approval');
update public.sops set status='effective' where id='sop_e2e';

select must_be((select status  from public.sops where id='sop_e2e'), 'effective', 'status after release');
select must_be((select version from public.sops where id='sop_e2e'), '1.0',       'first release version');
select must_be((select case when effective_revision_id is null then 'NULL' else 'SET' end
                  from public.sops where id='sop_e2e'), 'SET', 'effective_revision_id');
select must_be((select count(*) from public.sop_change_log where sop_id='sop_e2e')::text, '0',
               'change-log rows after the FIRST release');

\echo ''
\echo '════════ 5. The released document is frozen ════════'
select must_fail($$ update public.sops set document='{"body":"tampered"}'::jsonb where id='sop_e2e' $$,
                 'editing an effective document');

\echo ''
\echo '════════ 6. Gate D — a revision needs a reason, and bumps the cycle ════════'
select test_as('a1111111-1111-1111-1111-111111111111');
select must_fail($$ update public.sops set status='draft', change_significance='MINOR' where id='sop_e2e' $$,
                 'starting a revision with no revision_reason');

update public.sops set status='draft', revision_reason='Torque value corrected to 95 Nm', change_significance='MINOR' where id='sop_e2e';
select must_be((select review_cycle from public.sops where id='sop_e2e')::text, '1', 'review_cycle after revision');
select must_be((select version      from public.sops where id='sop_e2e'), '1.1',     'version after revision');

\echo ''
\echo '════════ 7. Prior-cycle signatures cannot be replayed ════════'
-- Revert the document to the EXACT bytes that were signed in cycle 0.
update public.sops set document='{"body":"Torque to 90 Nm."}'::jsonb where id='sop_e2e';
select public.sign_sop('sop_e2e', 'authorship');
update public.sops set status='in_review' where id='sop_e2e';

-- The document is byte-identical to v1.0, so every cycle-0 signature still matches the content
-- hash. Only the review_cycle stops them counting. Attempt the replay as the ADMIN — not the
-- submitter — so the refusal cannot come from the segregation-of-duties check, and assert on the
-- message: it must be the quorum that refuses.
select must_be((select content_hash from public.sops where id='sop_e2e'),
               (select signed_content_hash from public.sop_signatures
                 where sop_id='sop_e2e' and meaning='dept_approval' and review_cycle=0 limit 1),
               'the reverted document hashes identically to the one cycle-0 signed');

select test_as('a5555555-5555-5555-5555-555555555555');
select must_fail_with($$ update public.sops set status='approved' where id='sop_e2e' $$,
                      'must sign before Quality review',
                      'replaying cycle-0 signatures to approve cycle 1');

\echo ''
\echo '════════ 8. An objection routes back to the author and blocks resubmission ════════'
select test_as('a2222222-2222-2222-2222-222222222222');
select public.sign_sop('sop_e2e', 'rejection', p_reason => '95 Nm exceeds the bolt spec',
                       p_seat_department => 'd_eng');
select must_be((select status from public.sops where id='sop_e2e'), 'draft', 'status after a rejection');
select must_be((select rejected_reason from public.sops where id='sop_e2e'),
               '95 Nm exceeds the bolt spec', 'rejection reason mirrored onto the SOP');

-- The author cannot simply resubmit over an open objection.
select test_as('a1111111-1111-1111-1111-111111111111');
select public.sign_sop('sop_e2e', 'authorship');
select must_fail($$ update public.sops set status='in_review' where id='sop_e2e' $$,
                 'resubmitting while an objection is open');

-- The objector withdraws it. Nothing changed, so nobody else is disturbed.
select test_as('a2222222-2222-2222-2222-222222222222');
select public.sign_sop('sop_e2e', 'objection_withdrawn',
                       p_resolves => (select id from public.sop_signatures
                                       where sop_id='sop_e2e' and meaning='rejection'
                                       order by signed_at desc limit 1));

select test_as('a1111111-1111-1111-1111-111111111111');
update public.sops set status='in_review' where id='sop_e2e';
select must_be((select status from public.sops where id='sop_e2e'), 'in_review', 'status after withdrawal');

\echo ''
\echo '════════ 9. Re-approve, release, and issue the change log ════════'
select test_as('a2222222-2222-2222-2222-222222222222');
select public.sign_sop('sop_e2e', 'dept_approval', p_seat_department => 'd_eng');
select test_as('a3333333-3333-3333-3333-333333333333');
select public.sign_sop('sop_e2e', 'dept_approval', p_seat_department => 'd_mnt');
select must_be((select status from public.sops where id='sop_e2e'), 'approved', 'status after re-quorum');

select test_as('a4444444-4444-4444-4444-444444444444');
select public.sign_sop('sop_e2e', 'quality_approval');
update public.sops set status='effective' where id='sop_e2e';

select must_be((select status  from public.sops where id='sop_e2e'), 'effective', 'status after re-release');
select must_be((select count(*) from public.sop_change_log where sop_id='sop_e2e')::text, '1',
               'change-log rows after the SECOND release');
select must_be((select from_version from public.sop_change_log where sop_id='sop_e2e'), '1.0', 'change log from_version');
select must_be((select to_version   from public.sop_change_log where sop_id='sop_e2e'), '1.1', 'change log to_version');
select must_be((select reason       from public.sop_change_log where sop_id='sop_e2e'),
               'Torque value corrected to 95 Nm', 'change log reason');

\echo ''
\echo '════════ 10. Transparency — the whole roster and its signatures are visible ════════'
reset role;
\echo ''
select d.code as dept, s.rasic, u.email as signer,
       case when exists (
         select 1 from public.sop_signatures g
         where g.sop_id = s.sop_id and g.signer_id = s.signer_id
           and g.seat_department_id = s.department_id and g.meaning='dept_approval'
           and g.signed_content_hash = (select content_hash from public.sops where id='sop_e2e')
           and g.review_cycle = (select review_cycle from public.sops where id='sop_e2e')
       ) then 'SIGNED' else 'pending' end as state
from public.sop_review_seats s
join public.departments d on d.id = s.department_id
left join auth.users u on u.id = s.signer_id
where s.sop_id = 'sop_e2e' order by s.rasic;

\echo ''
\echo '════════ SIGNATURE LEDGER (write-once) ════════'
select meaning, coalesce(sd.code,'—') as seat, u.email as signer, sg.review_cycle as cycle,
       case when sg.resolves_signature_id is null then '' else 'resolves an objection' end as note
from public.sop_signatures sg
left join auth.users u on u.id = sg.signer_id
left join public.departments sd on sd.id = sg.seat_department_id
where sg.sop_id='sop_e2e' order by sg.signed_at, sg.meaning;

\echo ''
\echo '════════ ALL GATES HELD — walkthrough complete ════════'
rollback;
