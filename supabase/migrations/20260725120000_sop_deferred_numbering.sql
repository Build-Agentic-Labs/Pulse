-- Deferred SOP numbering: a number is earned at release, not at creation.
-- Owner-approved 2026-07-25, docs/superpowers/specs/2026-07-25-sop-deferred-numbering-design.md.
--
-- The rule, in one sentence: a number belongs to a document if and only if that document has
-- been released. Before release the document reads SOP-PRO-###; the `approved -> effective`
-- transition mints the next number for the owning department and stamps it in. Counters stay
-- keyed by (workspace, department, doc_type), so per-department sequences are unchanged --
-- only the moment of assignment moves.
--
-- Previously the number was minted on the first save from the client. Discarding a draft
-- orphaned its number and opened a gap. Minting at release makes each department's sequence
-- gapless by construction, because a release is irreversible and a released number is never
-- reclaimed.
--
-- Bundled lifecycle change (same trigger, so one rewrite instead of two): an effective SOP is
-- terminal. `effective -> obsolete` is removed -- a released document is retired only by being
-- superseded, which retires the old VERSION, not the SOP -- and an effective row can no longer
-- be soft-deleted, manager included. `effective -> draft` (revision) is untouched.

-- ---------------------------------------------------------------------------------------------
-- 1. sop_doc_hash v2 -- the document number stops being signed content.
--
-- content_hash is sha256 over the document jsonb, and meta.sopNumber lives inside it. Stamping
-- a number at release would otherwise void the quality-approval signature that authorized that
-- very release. Excluding the number makes the stamp hash-invisible.
--
-- This also resolves a trigger-ordering hazard: sops_aa_set_content_hash fires BEFORE
-- sops_enforce_transition (same timing, name order), so content_hash is computed from the
-- document as the client sent it -- before the guard stamps the number in. With the number
-- excluded, hash(unstamped) = hash(stamped) and the stored hash matches the stored document.
-- Were the number still hashed, every released row would carry a hash of a document that no
-- longer existed.
--
-- Safe to redefine: sop_doc_hash is called only from function bodies, never from an index or a
-- generated column.
create or replace function public.sop_doc_hash(doc jsonb)
returns text
language sql
immutable
set search_path = ''
as $$
  select encode(sha256(convert_to((doc #- '{meta,sopNumber}')::text, 'UTF8')), 'hex');
$$;

-- ---------------------------------------------------------------------------------------------
-- 2. snapshot_sop_revision v3 -- accept the document to freeze.
--
-- It reads the row with `select * from public.sops`, and it is called from inside a BEFORE
-- UPDATE trigger, so that SELECT returns the OLD row. A number stamped into new.document in the
-- same UPDATE would be absent from the frozen snapshot, leaving the archived controlled copy
-- reading SOP-PRO-###. The release edge now hands in the stamped document explicitly.
--
-- Dropped rather than overloaded: `create or replace` alone with an added defaulted parameter
-- would leave the 1-arg version in place, and a 1-arg call would then be ambiguous. The DROP
-- handles that; OR REPLACE on the 2-arg form is so a re-run after a failed apply succeeds
-- (the data migration below asserts post-conditions and is designed to abort on bad data).
drop function if exists public.snapshot_sop_revision(text);

create or replace function public.snapshot_sop_revision(p_sop text, p_document jsonb default null)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare s record; v_id text; v_label text; v_roster jsonb; v_doc jsonb;
begin
  select * into s from public.sops where id = p_sop;
  if s is null then raise exception 'SOP % not found', p_sop; end if;

  v_doc   := coalesce(p_document, s.document);
  v_label := coalesce(s.major_version, 1)::text || '.' || coalesce(s.minor_version, 0)::text;
  v_id    := gen_random_uuid()::text;

  select coalesce(jsonb_agg(jsonb_build_object(
           'department_id', st.department_id,
           'rasic',         st.rasic,
           'signer_id',     st.signer_id) order by st.rasic, st.department_id), '[]'::jsonb)
    into v_roster
    from public.sop_review_seats st
   where st.sop_id = p_sop;

  insert into public.sop_revisions
    (id, sop_id, workspace_id, version_label, document, content_hash, created_by, roster)
  values (v_id, p_sop, s.workspace_id, v_label, v_doc,
          public.sop_doc_hash(v_doc), auth.uid(), v_roster);
  return v_id;
end $$;

revoke execute on function public.snapshot_sop_revision(text, jsonb) from public, anon, authenticated;

-- ---------------------------------------------------------------------------------------------
-- 3. mint_sop_number_internal -- the counter bump, without the department-role check.
--
-- next_sop_number authorizes the caller with has_department_role(owning_department). At release
-- the caller is the Quality approver, who by Gate C holds no seat on the SOP and differs from
-- its author -- they generally hold no role in the owning department at all, so that check would
-- reject a legitimate release. The trigger has already authorized the transition before calling
-- this, and the function is unreachable from any client.
--
-- The collision-skip loop deliberately considers soft-deleted rows too (next_sop_number ignores
-- them). A soft-deleted released document keeps its number, and the counter reset below counts
-- it, so honouring it here keeps a later hard-undelete from colliding.
create or replace function public.mint_sop_number_internal(
  p_workspace text,
  p_department text,
  p_doc_type text
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_code text;
  v_seq  int;
  v_candidate text;
begin
  select code into v_code from public.departments
    where id = p_department and workspace_id = p_workspace;
  if v_code is null then
    raise exception 'Department % not in workspace %', p_department, p_workspace;
  end if;

  loop
    insert into public.doc_number_counter (workspace_id, department_id, doc_type, next_seq)
      values (p_workspace, p_department, p_doc_type, 2)
    on conflict (workspace_id, department_id, doc_type)
      do update set next_seq = public.doc_number_counter.next_seq + 1
    returning next_seq - 1 into v_seq;

    v_candidate := upper(p_doc_type) || '-' || upper(v_code) || '-' || lpad(v_seq::text, 3, '0');

    exit when not exists (
      select 1 from public.sops
      where workspace_id = p_workspace
        and lower(btrim(sop_number)) = lower(v_candidate)
    );
  end loop;

  return v_candidate;
end $$;

revoke execute on function public.mint_sop_number_internal(text, text, text)
  from public, anon, authenticated;

-- Nothing may burn a number outside a release. The function stays defined -- it is the reference
-- the internal variant mirrors -- but no client can reach it.
revoke execute on function public.next_sop_number(text, text, text) from public, anon, authenticated;

-- ---------------------------------------------------------------------------------------------
-- 4. Transition-guard deltas, applied IN PLACE to the live function.
--
-- Not a full `create or replace`: enforce_sop_transition has been patched three times since
-- 20260710123000_sop_transition_guard_v3.sql, and only the first of those
-- (20260710124500_sop_guard_v3_hardening) is a checked-in full body. The other two
-- (20260715143000_sop_solo_self_review_test_mode, 20260723133000_required_department_approvers)
-- rewrite the LIVE definition via pg_get_functiondef + replace, so no file in this repo contains
-- the current function text. Authoring a fresh body from the v3 file would silently revert:
--   * the removal of the "exactly one Accountable" gate -- and since 20260723133000 also added
--     `check (rasic = 'responsible')` to sop_review_seats, a reinstated gate can never be
--     satisfied: every draft -> in_review would raise, taking the whole review workflow down;
--   * the `is_quality_approver(old.workspace_id)` re-check, whose absence lets someone removed
--     from Quality release a document on a stale signature;
--   * the `test_self` self-review-test bypass machinery;
--   * the corrected sop_change_log from_version formula.
--
-- So this follows the same guarded-replace pattern those two migrations use: every edit asserts
-- its anchor is present first, which turns a drifted base into a loud failure instead of a
-- silent revert. Anchors were chosen from text that neither later patch touches.
--
-- Deltas:
--   * INSERT clamps sop_number to null. Without this a client can POST a row squatting a FUTURE
--     number; the mint's collision-skip loop would step over it and reopen the very gap this
--     migration closes.
--   * sop_number is pinned to OLD on every UPDATE edge, so it is client-unwritable everywhere
--     and the release edge is its sole writer. (v3's `new.sop_number is distinct from
--     old.sop_number` clause in the content-freeze list is left in place: pinning makes it
--     unreachable, and removing it would be one more anchor to drift against.)
--   * approved -> effective mints and stamps the number, then freezes the stamped document.
--   * effective -> obsolete is refused: supersede the document instead.
--   * an effective row can never be soft-deleted, manager included.
do $migration$
declare v_definition text;
begin
  select pg_get_functiondef('public.enforce_sop_transition()'::regprocedure) into v_definition;

  -- (a) A local for the minted number.
  if position($from$  v_objection record;$from$ in v_definition) = 0 then
    raise exception 'Transition guard declaration block changed';
  end if;
  v_definition := replace(
    v_definition,
    $from$  v_objection record;$from$,
    $to$  v_objection record;
  v_number text;$to$
  );

  -- (b) INSERT: a number is earned at release, so an insert may not carry one -- not even a
  -- legacy number off a converted document.
  if position($from$    new.requires_retraining := false;
    return new;$from$ in v_definition) = 0 then
    raise exception 'Transition guard INSERT branch changed';
  end if;
  v_definition := replace(
    v_definition,
    $from$    new.requires_retraining := false;
    return new;$from$,
    $to$    new.requires_retraining := false;
    new.sop_number := null;
    return new;$to$
  );

  -- (c) UPDATE: pin the number. The release edge below is the only thing that may set it.
  if position($from$  new.revision_reason := old.revision_reason;$from$ in v_definition) = 0 then
    raise exception 'Transition guard pinning block changed';
  end if;
  v_definition := replace(
    v_definition,
    $from$  new.revision_reason := old.revision_reason;$from$,
    $to$  new.revision_reason := old.revision_reason;
  -- Minted by the release edge and by nothing else, on any status.
  new.sop_number := old.sop_number;$to$
  );

  -- (d) An effective document is in force. Deleting it would retire it without superseding it,
  -- which is the back door the lifecycle change closes; is_manager is no exemption.
  if position($from$    if not (old.status in ('draft', 'obsolete') or is_manager) then$from$ in v_definition) = 0 then
    raise exception 'Transition guard soft-delete guard changed';
  end if;
  v_definition := replace(
    v_definition,
    $from$    if not (old.status in ('draft', 'obsolete') or is_manager) then$from$,
    $to$    if old.status = 'effective' then
      raise exception 'An effective SOP cannot be deleted; release a new version to supersede it';
    end if;
    if not (old.status in ('draft', 'obsolete') or is_manager) then$to$
  );

  -- (e) The number is earned HERE. A revision of an already-numbered document keeps its number:
  -- the number identifies the document, the version identifies the release.
  if position($from$      if old.major_version is null then
        new.major_version := 1;$from$ in v_definition) = 0 then
    raise exception 'Transition guard release version stamping changed';
  end if;
  v_definition := replace(
    v_definition,
    $from$      if old.major_version is null then
        new.major_version := 1;$from$,
    $to$      if coalesce(btrim(old.sop_number), '') = '' then
        if old.department_id is null then
          raise exception 'Assign an owning department before releasing this SOP';
        end if;
        v_number := public.mint_sop_number_internal(
          old.workspace_id, old.department_id, coalesce(old.doc_type, 'SOP'));
        new.sop_number := v_number;
        -- Stamp the jsonb copy too, so the frozen revision is self-describing. jsonb_set with
        -- create_missing only creates the LEAF -- a document with no meta object would be
        -- returned unchanged, silently -- so ensure the parent exists first.
        new.document := jsonb_set(
          case
            when coalesce(new.document, '{}'::jsonb) ? 'meta' then new.document
            else coalesce(new.document, '{}'::jsonb) || jsonb_build_object('meta', '{}'::jsonb)
          end,
          '{meta,sopNumber}', to_jsonb(v_number), true);
      end if;

      if old.major_version is null then
        new.major_version := 1;$to$
  );

  -- (f) Hand the stamped document to the snapshot: snapshot_sop_revision's own SELECT reads the
  -- OLD row (it runs inside this BEFORE UPDATE), so the frozen controlled copy would otherwise
  -- archive the SOP-PRO-### placeholder.
  if position($from$public.snapshot_sop_revision(old.id);$from$ in v_definition) = 0 then
    raise exception 'Transition guard snapshot call changed';
  end if;
  v_definition := replace(
    v_definition,
    $from$public.snapshot_sop_revision(old.id);$from$,
    $to$public.snapshot_sop_revision(old.id, new.document);$to$
  );

  -- (g) Retiring an in-force document is superseding it: release a new version, which retires the
  -- previous VERSION and leaves the document itself in force. draft/approved -> obsolete stay.
  if position($from$    when 'effective->obsolete', 'approved->obsolete', 'draft->obsolete' then$from$ in v_definition) = 0 then
    raise exception 'Transition guard obsolete branch changed';
  end if;
  v_definition := replace(
    v_definition,
    $from$    when 'effective->obsolete', 'approved->obsolete', 'draft->obsolete' then$from$,
    $to$    when 'effective->obsolete' then
      raise exception 'An effective SOP is retired by releasing a new version, not by retiring the document';

    when 'approved->obsolete', 'draft->obsolete' then$to$
  );

  execute v_definition;
end $migration$;

-- The trigger itself is unchanged (same function, same timing), but reassert it so the ordering
-- contract with sops_aa_set_content_hash stays documented in one place: same-timing triggers fire
-- in NAME order, and `aa_` sorting first is what lets the guard read the freshly computed hash.
drop trigger if exists sops_enforce_transition on public.sops;
create trigger sops_enforce_transition
before insert or update on public.sops
for each row execute function public.enforce_sop_transition();

-- ---------------------------------------------------------------------------------------------
-- 5. Data migration: preserve the signature chain across the hash change, then reclaim every
--    number that was never earned.
do $$
declare
  v_rows int;
begin
  -- The guard would refuse most of what follows (it pins sop_number on every edge now). This
  -- migration is the sanctioned exception; an exception anywhere below rolls the disable back
  -- with everything else.
  alter table public.sops disable trigger sops_enforce_transition;

  -- (a) Signature chain. Signatures store the hash they were signed against, so redefining
  -- sop_doc_hash would strand every one of them. Map old -> new for every document on file.
  -- The OLD expression is inlined (it no longer exists as a function), so this block does not
  -- depend on the redefinition order above.
  --
  -- The mapping is a function: identical documents share an old hash AND a new hash. Two
  -- documents differing only in meta.sopNumber collapse onto one new hash, which is the point.
  create temp table _hash_remap on commit drop as
    select distinct
           encode(sha256(convert_to(d.document::text, 'UTF8')), 'hex') as old_hash,
           public.sop_doc_hash(d.document)                             as new_hash
      from (select document from public.sops
            union all
            select document from public.sop_revisions) d
     where d.document is not null;

  update public.sop_signatures s
     set signed_content_hash = m.new_hash
    from _hash_remap m
   where s.signed_content_hash = m.old_hash
     and m.old_hash <> m.new_hash;
  get diagnostics v_rows = row_count;
  raise notice 'Rebound % signature(s) to number-independent hashes', v_rows;

  update public.sop_revisions
     set content_hash = public.sop_doc_hash(document)
   where content_hash is distinct from public.sop_doc_hash(document);
  get diagnostics v_rows = row_count;
  raise notice 'Rehashed % frozen revision(s)', v_rows;

  update public.sops
     set content_hash = public.sop_doc_hash(document)
   where content_hash is distinct from public.sop_doc_hash(document);
  get diagnostics v_rows = row_count;
  raise notice 'Rehashed % SOP row(s)', v_rows;

  -- (b) Reclaim. major_version is null <=> never released: the guard nulls it on INSERT, pins it
  -- to OLD on every UPDATE, and sets it in exactly one place (approved -> effective). So this
  -- covers drafts, in-review, approved, AND obsolete rows retired straight from draft or
  -- approved -- those never earned a number, so they must not hold a position in the sequence.
  -- Soft-deleted rows are included for the same reason.
  --
  -- Blanking meta.sopNumber re-fires sops_aa_set_content_hash, but the number is no longer part
  -- of the hash, so the rows keep the hashes just rebound in (a) and signatures stay valid.
  update public.sops
     set sop_number = null,
         document = case
           when document #>> '{meta,sopNumber}' is not null
             then jsonb_set(document, '{meta,sopNumber}', '""'::jsonb, true)
           else document
         end
   where major_version is null
     and (coalesce(btrim(sop_number), '') <> ''
          or coalesce(document #>> '{meta,sopNumber}', '') <> '');
  get diagnostics v_rows = row_count;
  raise notice 'Reclaimed numbers from % unreleased SOP(s)', v_rows;

  -- (c) Counters. A scope whose numbers were all reclaimed restarts at 1; every other scope
  -- resumes one past the highest number it actually issued. max() spans soft-deleted rows too:
  -- the partial unique index ignores them, so a later hard-undelete would otherwise collide
  -- with a freshly minted number.
  update public.doc_number_counter c
     set next_seq = 1
   where not exists (
     select 1 from public.sops s
      where s.workspace_id = c.workspace_id
        and s.department_id = c.department_id
        and s.doc_type = c.doc_type
        and coalesce(btrim(s.sop_number), '') <> '');

  -- INSERT ... ON CONFLICT rather than a bare UPDATE: a scope can hold numbers without having a
  -- counter row at all (any number written by something other than the mint -- seeded legacy
  -- data, say). A bare UPDATE would skip it silently, the "gapless from max+1" guarantee would
  -- quietly not hold there, and the post-condition below could not see it either because it
  -- INNER JOINs this table. Creating the row puts every numbered scope under the assertion.
  insert into public.doc_number_counter (workspace_id, department_id, doc_type, next_seq)
  select s.workspace_id, s.department_id, coalesce(s.doc_type, 'SOP'), max(m.seq) + 1
    from public.sops s
    cross join lateral (
      select ((regexp_match(upper(btrim(s.sop_number)),
               '^[A-Z0-9]+-[A-Z0-9]+-([0-9]+)$'))[1])::int as seq
    ) m
   where coalesce(btrim(s.sop_number), '') <> ''
     and m.seq is not null
     -- The counter's department_id is NOT NULL and FK-bound; an SOP with no department cannot
     -- have a scope, and cannot be released either (the release edge refuses it).
     and s.department_id is not null
   group by s.workspace_id, s.department_id, coalesce(s.doc_type, 'SOP')
  on conflict (workspace_id, department_id, doc_type)
    do update set next_seq = excluded.next_seq;

  -- (d) Post-conditions. Assert inside the transaction so a bad reclaim aborts rather than ships.
  if exists (
    select 1 from public.sops
     where major_version is null
       and (coalesce(btrim(sop_number), '') <> ''
            or coalesce(document #>> '{meta,sopNumber}', '') <> '')
  ) then
    raise exception 'Reclaim incomplete: an unreleased SOP still holds a number';
  end if;

  if exists (
    select 1
      from public.sops s
      cross join lateral (
        select ((regexp_match(upper(btrim(s.sop_number)),
                 '^[A-Z0-9]+-[A-Z0-9]+-([0-9]+)$'))[1])::int as seq
      ) m
     where m.seq is not null
       and s.department_id is not null
       and not exists (
         select 1 from public.doc_number_counter c
          where c.workspace_id = s.workspace_id
            and c.department_id = s.department_id
            and c.doc_type = coalesce(s.doc_type, 'SOP'))
  ) then
    raise exception 'Counter reset incomplete: a numbered scope has no counter row';
  end if;

  if exists (
    select 1
      from public.doc_number_counter c
      join public.sops s
        on s.workspace_id = c.workspace_id
       and s.department_id = c.department_id
       and s.doc_type = c.doc_type
      cross join lateral (
        select ((regexp_match(upper(btrim(s.sop_number)),
                 '^[A-Z0-9]+-[A-Z0-9]+-([0-9]+)$'))[1])::int as seq
      ) m
     where m.seq is not null
       and c.next_seq <= m.seq
  ) then
    raise exception 'Counter reset incomplete: a counter would re-mint an existing number';
  end if;

  alter table public.sops enable trigger sops_enforce_transition;
end $$;
