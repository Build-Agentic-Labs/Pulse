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
-- Dropped rather than overloaded: `create or replace` with an added defaulted parameter would
-- leave the 1-arg version in place, and a 1-arg call would then be ambiguous.
drop function if exists public.snapshot_sop_revision(text);

create function public.snapshot_sop_revision(p_sop text, p_document jsonb default null)
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
-- 4. enforce_sop_transition v4 -- supersedes v3. Deltas from v3:
--   * INSERT also clamps sop_number to null. Without this a client can POST a row squatting a
--     FUTURE number; the collision-skip loop would step over it and open exactly the gap this
--     migration removes.
--   * sop_number is pinned to OLD on every UPDATE edge (v3 froze it only when the row was not a
--     draft), so it is client-unwritable everywhere. The release edge below is the sole writer.
--   * approved -> effective mints and stamps the number, then freezes the stamped document.
--   * effective -> obsolete is refused: supersede the document instead.
--   * an effective row can never be soft-deleted, manager included.
create or replace function public.enforce_sop_transition()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  is_manager boolean;
  v_reason text;
  v_revision_reason text;
  v_prev_label text;
  v_objection record;
  v_number text;
begin
  -- INSERT: force a clean draft regardless of what the client sent.
  if tg_op = 'INSERT' then
    new.status := 'draft';
    new.submitted_by := null;
    new.approved_by := null;
    new.approved_at := null;
    new.effective_revision_id := null;
    new.effective_date := null;
    new.next_review_date := null;
    new.rejected_by := null;
    new.rejected_reason := null;
    -- v2 left these client-writable: a forged major_version made the first release behave as a
    -- revision, stamping a bogus version and emitting a change-log entry for v1.0.
    new.version := null;
    new.major_version := null;
    new.minor_version := null;
    new.review_cycle := 0;
    new.revision_reason := null;
    new.change_significance := null;
    new.requires_retraining := false;
    -- A number is earned at release. An insert may not carry one, not even a legacy number
    -- from a converted document -- a squatted number becomes a skipped number.
    new.sop_number := null;
    return new;
  end if;

  is_manager := public.has_workspace_role(
    old.workspace_id, array['owner', 'admin']::public.workspace_role[]);

  -- Capture client intent before pinning it away.
  v_reason := new.rejected_reason;
  v_revision_reason := new.revision_reason;

  -- Pin trigger-managed columns to OLD. Only the edge logic below may change them.
  new.submitted_by := old.submitted_by;
  new.approved_by := old.approved_by;
  new.approved_at := old.approved_at;
  new.effective_revision_id := old.effective_revision_id;
  new.next_review_date := old.next_review_date;
  new.effective_date := old.effective_date;
  new.rejected_by := old.rejected_by;
  new.rejected_reason := old.rejected_reason;
  new.workspace_id := old.workspace_id;
  new.created_by := old.created_by;
  new.major_version := old.major_version;
  new.minor_version := old.minor_version;
  new.review_cycle := old.review_cycle;
  new.revision_reason := old.revision_reason;
  -- The number is minted by the release edge and by nothing else, on any status.
  new.sop_number := old.sop_number;

  -- Content/settings freeze: only a draft is editable, on every edge (including status changes).
  -- sop_number is absent from this list by design -- it is already pinned above, so a client
  -- change to it is silently discarded rather than raised, on a draft as much as on a release.
  if old.status <> 'draft' then
    if new.document is distinct from old.document
       or new.title is distinct from old.title
       or new.department_id is distinct from old.department_id
       or new.doc_type is distinct from old.doc_type
       or new.version is distinct from old.version
       or new.change_significance is distinct from old.change_significance
       or new.requires_retraining is distinct from old.requires_retraining
       or new.review_interval_months is distinct from old.review_interval_months then
      raise exception 'This SOP is %; start a revision before editing its content', old.status;
    end if;
  end if;

  -- Soft-delete guard.
  if new.deleted_at is not null and old.deleted_at is null then
    -- An effective document is in force. Deleting it would retire it without superseding it,
    -- which is the back door the lifecycle change closes; is_manager is no exemption.
    if old.status = 'effective' then
      raise exception 'An effective SOP cannot be deleted; release a new version to supersede it';
    end if;
    if not (old.status in ('draft', 'obsolete') or is_manager) then
      raise exception 'Retire this SOP before deleting it (only draft or obsolete SOPs can be deleted)';
    end if;
  end if;

  if new.status = old.status then
    return new;
  end if;

  case old.status || '->' || new.status
    when 'draft->in_review' then
      if new.department_id is null then
        raise exception 'Assign an owning department before submitting for review';
      end if;
      if not (is_manager or public.is_department_member(new.department_id)) then
        raise exception 'Only a member of the owning department can submit this SOP';
      end if;

      -- Gate A: the roster.
      if not exists (select 1 from public.sop_review_seats st
                     where st.sop_id = old.id and st.rasic = 'responsible') then
        raise exception 'Name at least one Responsible department before submitting';
      end if;
      if (select count(*) from public.sop_review_seats st
          where st.sop_id = old.id and st.rasic = 'accountable') <> 1 then
        raise exception 'Name exactly one Accountable department before submitting';
      end if;
      if exists (select 1 from public.sop_review_seats st
                 where st.sop_id = old.id and st.signer_id is not null
                   and not public.is_department_member(st.department_id, st.signer_id)) then
        raise exception 'Every seat''s reviewer must belong to that seat''s department';
      end if;
      -- The three-humans invariant: the author never approves their own document.
      if exists (select 1 from public.sop_review_seats st
                 where st.sop_id = old.id
                   and st.rasic in ('responsible', 'accountable')
                   and st.signer_id = auth.uid()) then
        raise exception 'You hold a blocking seat on this SOP; someone else must submit it';
      end if;

      if not exists (select 1 from public.sop_signatures g
                     where g.sop_id = old.id and g.meaning = 'authorship'
                       and g.signer_id = auth.uid()
                       and g.signed_content_hash = new.content_hash
                       and g.review_cycle = old.review_cycle) then
        raise exception 'Sign the authorship declaration before submitting this SOP';
      end if;

      -- An edit moots an objection; record that closure explicitly before checking.
      perform public.close_moot_objections(old.id);
      if public.sop_has_open_objection(old.id) then
        raise exception 'Resolve the open objection before resubmitting this SOP';
      end if;

      new.submitted_by := auth.uid();
      new.rejected_reason := null;
      new.rejected_by := null;

    when 'in_review->approved' then
      if old.submitted_by is null then
        raise exception 'This SOP has no recorded submitter; resubmit it for review before approval';
      end if;
      if auth.uid() is not distinct from old.submitted_by then
        raise exception 'You cannot approve an SOP you submitted for review';
      end if;
      if not public.sop_quorum_met(old.id) then
        raise exception 'Every Responsible and Accountable department must sign before Quality review';
      end if;
      if public.sop_has_open_objection(old.id) then
        raise exception 'Resolve the open objection before this SOP can be approved';
      end if;
      new.approved_by := auth.uid();
      new.approved_at := now();

    when 'in_review->draft' then
      -- Reject: driven from inside sign_sop, which has just written the rejection signature.
      select * into v_objection from public.sop_signatures g
        where g.sop_id = old.id and g.meaning = 'rejection'
          and g.signer_id = auth.uid()
          and g.signed_content_hash = old.content_hash
          and g.review_cycle = old.review_cycle
          and not exists (select 1 from public.sop_signatures r where r.resolves_signature_id = g.id)
        limit 1;

      if v_objection.id is not null then
        new.rejected_by := auth.uid();
        new.rejected_reason := v_objection.rejected_reason;
        new.submitted_by := null;
      elsif auth.uid() is not distinct from old.submitted_by then
        -- Recall: the submitter withdrawing their own submission. Not an objection.
        new.rejected_by := null;
        new.rejected_reason := null;
        new.submitted_by := null;
      else
        raise exception 'Only a Responsible or Accountable reviewer can reject this SOP, or its submitter can recall it';
      end if;

    when 'approved->effective' then
      if not exists (
        select 1 from public.sop_signatures sg
        where sg.sop_id = old.id and sg.meaning = 'quality_approval'
          and sg.signer_id = auth.uid()
          and sg.signed_content_hash = old.content_hash
          and sg.review_cycle = old.review_cycle) then
        raise exception 'Sign the quality approval before making this SOP effective';
      end if;
      if exists (select 1 from public.sop_review_seats st
                 where st.sop_id = old.id and st.signer_id = auth.uid()) then
        raise exception 'The Quality approver must not hold a review seat on this SOP';
      end if;
      if auth.uid() is not distinct from old.created_by
         or auth.uid() is not distinct from old.submitted_by then
        raise exception 'The Quality approver must differ from the author';
      end if;
      if exists (select 1 from public.sop_signatures sg
                 where sg.sop_id = old.id and sg.meaning = 'objection_overruled'
                   and sg.signer_id = auth.uid() and sg.review_cycle = old.review_cycle) then
        raise exception 'The Quality approver who overruled an objection cannot also release this SOP';
      end if;

      -- The number is earned HERE. A revision of an already-numbered document keeps its number:
      -- the number identifies the document, the version identifies the release.
      if coalesce(btrim(old.sop_number), '') = '' then
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

      -- First time effective → 1.0; later effectives keep the revision's bumped version.
      if old.major_version is null then
        new.major_version := 1;
        new.minor_version := 0;
      end if;
      new.version := new.major_version::text || '.' || new.minor_version::text;
      new.effective_date := current_date;
      new.next_review_date := (current_date
        + (coalesce(old.review_interval_months, 24) || ' months')::interval)::date;

      select version_label into v_prev_label from public.sop_revisions
        where id = old.effective_revision_id;

      -- Hand in the stamped document: snapshot_sop_revision's own SELECT would read the OLD row.
      new.effective_revision_id := public.snapshot_sop_revision(old.id, new.document);

      -- A change log is issued ONLY when an already-effective version is revised. v1.0 has none.
      if old.major_version is not null then
        insert into public.sop_change_log
          (sop_id, revision_id, from_version, to_version, reason, significance,
           requires_retraining, created_by)
        values (old.id, new.effective_revision_id, coalesce(v_prev_label, old.version), new.version,
                coalesce(nullif(btrim(old.revision_reason), ''), 'Revision'),
                old.change_significance, old.requires_retraining, auth.uid());
        new.revision_reason := null;
      end if;

    when 'effective->draft' then  -- start a revision
      if not (is_manager or public.has_department_role(
                old.department_id, array['author', 'reviewer', 'approver']::public.department_sop_role[])) then
        raise exception 'Only a member of the owning department can start a revision';
      end if;
      if v_revision_reason is null or btrim(v_revision_reason) = '' then
        raise exception 'A revision needs a reason: what is changing, and why';
      end if;
      new.revision_reason := v_revision_reason;
      -- The cycle bumps HERE and nowhere else. Prior-cycle signatures can never be replayed,
      -- even against a document reverted to their exact content hash.
      new.review_cycle := old.review_cycle + 1;
      new.minor_version := coalesce(old.minor_version, 0) + 1;
      new.version := coalesce(old.major_version, 1)::text || '.' || new.minor_version::text;
      new.submitted_by := null;
      new.approved_by := null;
      new.approved_at := null;

    when 'effective->obsolete' then
      -- Removed in v4. Retiring an in-force document is superseding it: release a new version,
      -- which retires the previous VERSION and leaves the document itself in force.
      raise exception 'An effective SOP is retired by releasing a new version, not by retiring the document';

    when 'approved->obsolete', 'draft->obsolete' then
      if not (is_manager or public.has_department_role(
                old.department_id, array['approver']::public.department_sop_role[])) then
        raise exception 'Only a department approver can retire an SOP';
      end if;

    else
      raise exception 'Invalid SOP status transition from % to %', old.status, new.status;
  end case;

  return new;
end $$;

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

  update public.doc_number_counter c
     set next_seq = sub.next_seq
    from (
      select s.workspace_id, s.department_id, s.doc_type, max(m.seq) + 1 as next_seq
        from public.sops s
        cross join lateral (
          select ((regexp_match(upper(btrim(s.sop_number)),
                   '^[A-Z0-9]+-[A-Z0-9]+-([0-9]+)$'))[1])::int as seq
        ) m
       where coalesce(btrim(s.sop_number), '') <> ''
         and m.seq is not null
       group by s.workspace_id, s.department_id, s.doc_type
    ) sub
   where c.workspace_id = sub.workspace_id
     and c.department_id = sub.department_id
     and c.doc_type = sub.doc_type;

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
