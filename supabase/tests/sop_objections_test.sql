-- pgTAP: Objections — raised only by blocking seats, closed exactly one of three ways.
--
-- Pins:
--   * a rejection by a blocking seat holder transitions to draft INSIDE sign_sop
--   * the submitter holds no seat, so they cannot reject — but they can recall (no
--     signature, no reason)
--   * people outside the required-approver roster cannot reject
--   * resubmission with an open objection is refused; after objection_withdrawn it passes
--   * an edit that removes the objected-to content auto-closes the objection at resubmit,
--     writing an objection_sustained row that references it
--   * only a Quality final approver can overrule a departmental objection, and a
--     written justification is required
--   * one person overruling two objections at the same content hash produces two
--     resolving rows (resolves_signature_id is part of the idempotency key)
--
-- sign_sop v2 contract: sign_sop(p_sop, p_meaning, p_reason, p_seat_department, p_resolves).

begin;
select plan(25);

-- ---------------------------------------------------------------------------
-- Fixtures (owner context: RLS bypassed)
-- ---------------------------------------------------------------------------
-- enforce_signup_domain() rejects emails whose domain is absent from
-- workspace_auto_join_domains, which is empty on a fresh db reset. Seed it before
-- any auth.users insert, and create the workspace it points at first.
insert into public.workspaces (id, name) values ('ws_obj', 'Objections Org');
insert into public.workspace_auto_join_domains (domain, workspace_id) values ('test.dev', 'ws_obj');

insert into auth.users (id, aud, role, email)
values
  ('f0000000-0000-0000-0000-000000000001', 'authenticated', 'authenticated', 'o-author@test.dev'),
  ('f0000000-0000-0000-0000-000000000002', 'authenticated', 'authenticated', 'o-resp-a@test.dev'),
  ('f0000000-0000-0000-0000-000000000003', 'authenticated', 'authenticated', 'o-resp-d@test.dev'),
  ('f0000000-0000-0000-0000-000000000004', 'authenticated', 'authenticated', 'o-acct@test.dev'),
  ('f0000000-0000-0000-0000-000000000005', 'authenticated', 'authenticated', 'o-support@test.dev'),
  ('f0000000-0000-0000-0000-000000000006', 'authenticated', 'authenticated', 'o-quality@test.dev'),
  ('f0000000-0000-0000-0000-000000000007', 'authenticated', 'authenticated', 'o-consulted@test.dev');


insert into public.workspace_members (workspace_id, user_id, role) values
  ('ws_obj', 'f0000000-0000-0000-0000-000000000001', 'editor'),
  ('ws_obj', 'f0000000-0000-0000-0000-000000000002', 'editor'),
  ('ws_obj', 'f0000000-0000-0000-0000-000000000003', 'editor'),
  ('ws_obj', 'f0000000-0000-0000-0000-000000000004', 'editor'),
  ('ws_obj', 'f0000000-0000-0000-0000-000000000005', 'editor'),
  ('ws_obj', 'f0000000-0000-0000-0000-000000000006', 'editor'),
  ('ws_obj', 'f0000000-0000-0000-0000-000000000007', 'editor');

insert into public.org_tool_access (workspace_id, user_id, level)
select 'ws_obj', u.id, 'edit'::public.access_level from (values
  ('f0000000-0000-0000-0000-000000000001'::uuid),
  ('f0000000-0000-0000-0000-000000000002'::uuid),
  ('f0000000-0000-0000-0000-000000000003'::uuid),
  ('f0000000-0000-0000-0000-000000000004'::uuid),
  ('f0000000-0000-0000-0000-000000000005'::uuid),
  ('f0000000-0000-0000-0000-000000000006'::uuid),
  ('f0000000-0000-0000-0000-000000000007'::uuid)) as u(id);

insert into public.departments (id, workspace_id, code, name, is_quality_gate) values
  ('dept_o_prd', 'ws_obj', 'PRD', 'Production', false),
  ('dept_o_a', 'ws_obj', 'ENG', 'Engineering', false),
  ('dept_o_b', 'ws_obj', 'MNT', 'Maintenance', false),
  ('dept_o_c', 'ws_obj', 'LOG', 'Logistics', false),
  ('dept_o_d', 'ws_obj', 'SAF', 'Safety', false),
  ('dept_o_e', 'ws_obj', 'FAC', 'Facilities', false),
  ('dept_o_qa', 'ws_obj', 'QA', 'Quality', true);

insert into public.department_members (department_id, user_id, dept_role) values
  ('dept_o_prd', 'f0000000-0000-0000-0000-000000000001', 'author'),
  ('dept_o_a', 'f0000000-0000-0000-0000-000000000002', 'approver'),
  ('dept_o_d', 'f0000000-0000-0000-0000-000000000003', 'approver'),
  ('dept_o_b', 'f0000000-0000-0000-0000-000000000004', 'approver'),
  ('dept_o_c', 'f0000000-0000-0000-0000-000000000005', 'reviewer'),
  ('dept_o_e', 'f0000000-0000-0000-0000-000000000007', 'reviewer'),
  ('dept_o_qa', 'f0000000-0000-0000-0000-000000000006', 'approver');

insert into public.sops (id, workspace_id, sop_number, title, document, status, created_by, department_id)
values ('sop_obj_1', 'ws_obj', 'PRD-SOP-001', 'Contested', '{"body":"h1"}'::jsonb, 'draft',
        'f0000000-0000-0000-0000-000000000001', 'dept_o_prd');

-- Required departmental approvers. Procedure Support / Consult / Inform roles
-- intentionally do not appear in this document-control roster.
insert into public.sop_review_seats (sop_id, department_id, rasic, signer_id) values
  ('sop_obj_1', 'dept_o_a', 'responsible', 'f0000000-0000-0000-0000-000000000002'),
  ('sop_obj_1', 'dept_o_d', 'responsible', 'f0000000-0000-0000-0000-000000000003'),
  ('sop_obj_1', 'dept_o_b', 'responsible', 'f0000000-0000-0000-0000-000000000004');

-- Captured signature ids (owner context writes, keyed lookups below — readable by the
-- authenticated role because the lookups run inside user-context sign_sop calls).
create temp table _ids (k text primary key, v text);
grant select on _ids to authenticated;

-- Helper: act as a given user with the authenticated role.
create or replace function test_as(p_uid text) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
end $$;

-- Helper: capture the id of a rejection at the SOP's CURRENT hash for a signer+seat.
-- (signed_at is useless inside one transaction — now() is constant — but the widened
-- idempotency key makes signer+meaning+seat+hash+cycle unique.)
create or replace function capture_rejection(p_key text, p_signer uuid, p_seat text) returns void
language sql as $$
  insert into _ids
  select p_key, g.id
  from public.sop_signatures g
  join public.sops s on s.id = g.sop_id
  where g.sop_id = 'sop_obj_1'
    and g.meaning = 'rejection'
    and g.signer_id = p_signer
    and g.seat_department_id = p_seat
    and g.signed_content_hash = s.content_hash
    and g.review_cycle = s.review_cycle;
$$;

-- ---------------------------------------------------------------------------
-- Into review.
-- ---------------------------------------------------------------------------
select test_as('f0000000-0000-0000-0000-000000000001');
select public.sign_sop('sop_obj_1', 'authorship');
update public.sops set status = 'in_review' where id = 'sop_obj_1';
select is(
  (select status from public.sops where id = 'sop_obj_1'),
  'in_review',
  'fixture: the SOP is in review'
);

-- 2. The submitter holds no seat: no seat_department_id to stamp, no rejection.
select throws_ok(
  $$ select public.sign_sop('sop_obj_1', 'rejection', 'I changed my mind', p_seat_department => 'dept_o_a') $$,
  null,
  'the submitter cannot sign a rejection (they hold no seat; author objection = recall)'
);

-- 3/4. Procedure-only participants are not approval-seat holders and cannot reject.
select test_as('f0000000-0000-0000-0000-000000000005');
select throws_ok(
  $$ select public.sign_sop('sop_obj_1', 'rejection', 'not my call', p_seat_department => 'dept_o_c') $$,
  null,
  'a person outside the required-approver roster cannot sign a rejection'
);
select test_as('f0000000-0000-0000-0000-000000000007');
select throws_ok(
  $$ select public.sign_sop('sop_obj_1', 'rejection', 'not my call either', p_seat_department => 'dept_o_e') $$,
  null,
  'another person outside the required-approver roster cannot sign a rejection'
);

-- 5. Recall: the submitter withdraws their own submission — no signature, no reason.
select test_as('f0000000-0000-0000-0000-000000000001');
select lives_ok(
  $$ update public.sops set status = 'draft' where id = 'sop_obj_1' $$,
  'the submitter can recall their submission without a reason'
);
update public.sops set status = 'in_review' where id = 'sop_obj_1';

-- 6/7. Rejection by a blocking seat holder transitions inside sign_sop — no UPDATE issued.
select test_as('f0000000-0000-0000-0000-000000000002');
select lives_ok(
  $$ select public.sign_sop('sop_obj_1', 'rejection', 'too vague', p_seat_department => 'dept_o_a') $$,
  'a responsible seat holder can sign a rejection'
);
select is(
  (select status from public.sops where id = 'sop_obj_1'),
  'draft',
  'the rejection transitioned in_review -> draft inside sign_sop'
);

reset role;
select capture_rejection('o1', 'f0000000-0000-0000-0000-000000000002', 'dept_o_a');

-- 8. The objection is open: resubmission is refused.
select test_as('f0000000-0000-0000-0000-000000000001');
select throws_ok(
  $$ update public.sops set status = 'in_review' where id = 'sop_obj_1' $$,
  null,
  'resubmitting with an open objection is refused (Gate A)'
);

-- 9/10. Withdrawal by the objector reopens the path.
select test_as('f0000000-0000-0000-0000-000000000002');
select lives_ok(
  $$ select public.sign_sop('sop_obj_1', 'objection_withdrawn',
       p_resolves => (select v from _ids where k = 'o1')) $$,
  'the objector can withdraw their own objection'
);
select test_as('f0000000-0000-0000-0000-000000000001');
select lives_ok(
  $$ update public.sops set status = 'in_review' where id = 'sop_obj_1' $$,
  'after withdrawal the unchanged document resubmits cleanly'
);

-- ---------------------------------------------------------------------------
-- Departmental objection: only Quality may overrule, and only with a justification.
-- ---------------------------------------------------------------------------
select test_as('f0000000-0000-0000-0000-000000000004');
select public.sign_sop('sop_obj_1', 'rejection', 'missing safety review', p_seat_department => 'dept_o_b');
reset role;
select capture_rejection('o2', 'f0000000-0000-0000-0000-000000000004', 'dept_o_b');
select isnt((select v from _ids where k = 'o2'), null, 'fixture: captured the departmental objection');

select test_as('f0000000-0000-0000-0000-000000000002');
select throws_ok(
  $$ select public.sign_sop('sop_obj_1', 'objection_overruled', 'overruled anyway',
       p_resolves => (select v from _ids where k = 'o2')) $$,
  null,
  'a peer departmental approver cannot overrule an objection (Quality only)'
);
select test_as('f0000000-0000-0000-0000-000000000006');
select throws_ok(
  $$ select public.sign_sop('sop_obj_1', 'objection_overruled',
       p_resolves => (select v from _ids where k = 'o2')) $$,
  null,
  'an overrule without a written justification is refused'
);
select lives_ok(
  $$ select public.sign_sop('sop_obj_1', 'objection_overruled', 'risk assessed separately per QP-7',
       p_resolves => (select v from _ids where k = 'o2')) $$,
  'a Quality final approver overrules a departmental objection with a justification'
);
select test_as('f0000000-0000-0000-0000-000000000001');
select lives_ok(
  $$ update public.sops set status = 'in_review' where id = 'sop_obj_1' $$,
  'the overruled objection no longer blocks resubmission'
);

-- ---------------------------------------------------------------------------
-- Another departmental objection follows the same Quality-only escalation.
-- ---------------------------------------------------------------------------
select test_as('f0000000-0000-0000-0000-000000000003');
select public.sign_sop('sop_obj_1', 'rejection', 'unclear scope', p_seat_department => 'dept_o_d');
reset role;
select capture_rejection('o3', 'f0000000-0000-0000-0000-000000000003', 'dept_o_d');
select isnt((select v from _ids where k = 'o3'), null, 'fixture: captured the responsible objection');

select test_as('f0000000-0000-0000-0000-000000000004');
select throws_ok(
  $$ select public.sign_sop('sop_obj_1', 'objection_overruled', 'peer says fine',
       p_resolves => (select v from _ids where k = 'o3')) $$,
  null,
  'a second departmental approver cannot overrule the objection'
);
select test_as('f0000000-0000-0000-0000-000000000006');
select lives_ok(
  $$ select public.sign_sop('sop_obj_1', 'objection_overruled', 'scope defined in section 1',
       p_resolves => (select v from _ids where k = 'o3')) $$,
  'the Quality final approver overrules the departmental objection'
);

-- ---------------------------------------------------------------------------
-- Sustained: the author edits the objected-to content away; resubmission auto-closes
-- the stale-hash objection with an objection_sustained record.
-- ---------------------------------------------------------------------------
-- Move to a fresh hash first (every blocking seat has already rejected at h1, and the
-- idempotency key would hand back those resolved rows).
select test_as('f0000000-0000-0000-0000-000000000001');
update public.sops set document = '{"body":"h2"}'::jsonb where id = 'sop_obj_1';
select public.sign_sop('sop_obj_1', 'authorship');
update public.sops set status = 'in_review' where id = 'sop_obj_1';

select test_as('f0000000-0000-0000-0000-000000000002');
select public.sign_sop('sop_obj_1', 'rejection', 'still vague', p_seat_department => 'dept_o_a');
reset role;
select capture_rejection('o4', 'f0000000-0000-0000-0000-000000000002', 'dept_o_a');

select test_as('f0000000-0000-0000-0000-000000000001');
update public.sops set document = '{"body":"h3"}'::jsonb where id = 'sop_obj_1';
select public.sign_sop('sop_obj_1', 'authorship');
select lives_ok(
  $$ update public.sops set status = 'in_review' where id = 'sop_obj_1' $$,
  'after an edit, resubmission passes: the stale-hash objection is auto-closed'
);
reset role;
select is(
  (select count(*) from public.sop_signatures
    where sop_id = 'sop_obj_1'
      and meaning = 'objection_sustained'
      and resolves_signature_id = (select v from _ids where k = 'o4')),
  1::bigint,
  'the edit-and-resubmit wrote an objection_sustained row referencing the objection'
);
select is(
  (select signer_id::text from public.sop_signatures
    where sop_id = 'sop_obj_1'
      and meaning = 'objection_sustained'
      and resolves_signature_id = (select v from _ids where k = 'o4')),
  'f0000000-0000-0000-0000-000000000001',
  'the sustained record names the person whose edit closed the objection'
);

-- ---------------------------------------------------------------------------
-- Idempotency: the same Quality final approver overrules two objections at ONE hash.
-- Both resolving rows must exist — resolves_signature_id is part of the key.
-- ---------------------------------------------------------------------------
select test_as('f0000000-0000-0000-0000-000000000003');
select public.sign_sop('sop_obj_1', 'rejection', 'safety impact unassessed', p_seat_department => 'dept_o_d');
reset role;
select capture_rejection('o5', 'f0000000-0000-0000-0000-000000000003', 'dept_o_d');

select test_as('f0000000-0000-0000-0000-000000000006');
select lives_ok(
  $$ select public.sign_sop('sop_obj_1', 'objection_overruled', 'assessed in HA-12',
       p_resolves => (select v from _ids where k = 'o5')) $$,
  'the Quality final approver overrules the first objection at this hash'
);
select test_as('f0000000-0000-0000-0000-000000000001');
update public.sops set status = 'in_review' where id = 'sop_obj_1';

select test_as('f0000000-0000-0000-0000-000000000002');
select public.sign_sop('sop_obj_1', 'rejection', 'training plan missing', p_seat_department => 'dept_o_a');
reset role;
select capture_rejection('o6', 'f0000000-0000-0000-0000-000000000002', 'dept_o_a');

select test_as('f0000000-0000-0000-0000-000000000006');
select lives_ok(
  $$ select public.sign_sop('sop_obj_1', 'objection_overruled', 'training handled by HR-4',
       p_resolves => (select v from _ids where k = 'o6')) $$,
  'the same signer overrules a second objection at the same hash'
);
reset role;
select is(
  (select count(*) from public.sop_signatures
    where sop_id = 'sop_obj_1'
      and meaning = 'objection_overruled'
      and signer_id = 'f0000000-0000-0000-0000-000000000006'
      and resolves_signature_id in (select v from _ids where k in ('o5', 'o6'))),
  2::bigint,
  'two overrules at one hash produced two resolving rows (key includes resolves_signature_id)'
);

select test_as('f0000000-0000-0000-0000-000000000001');
select lives_ok(
  $$ update public.sops set status = 'in_review' where id = 'sop_obj_1' $$,
  'with both objections resolved the SOP resubmits'
);

select finish();
rollback;
