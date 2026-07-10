-- Guard v3 hardening, from the adversarial review:
--   * Gate C trusted a stored quality_approval signature without re-checking that its signer is
--     STILL a Quality approver. Someone removed from Quality could release the document.
--   * The change log's from_version fell back to old.version, which at approved->effective
--     already carries the BUMPED label — so a missing prior-revision row would record
--     from_version == to_version. Derive the previous label instead.
--
-- Everything else is byte-for-byte guard v3.

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
begin
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
    new.version := null;
    new.major_version := null;
    new.minor_version := null;
    new.review_cycle := 0;
    new.revision_reason := null;
    new.change_significance := null;
    new.requires_retraining := false;
    return new;
  end if;

  is_manager := public.has_workspace_role(
    old.workspace_id, array['owner', 'admin']::public.workspace_role[]);

  v_reason := new.rejected_reason;
  v_revision_reason := new.revision_reason;

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

  if old.status <> 'draft' then
    if new.document is distinct from old.document
       or new.title is distinct from old.title
       or new.sop_number is distinct from old.sop_number
       or new.department_id is distinct from old.department_id
       or new.doc_type is distinct from old.doc_type
       or new.version is distinct from old.version
       or new.change_significance is distinct from old.change_significance
       or new.requires_retraining is distinct from old.requires_retraining
       or new.review_interval_months is distinct from old.review_interval_months then
      raise exception 'This SOP is %; start a revision before editing its content', old.status;
    end if;
  end if;

  if new.deleted_at is not null and old.deleted_at is null then
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
      -- A stored signature is not standing authority: re-check the signer is still in Quality.
      if not public.is_quality_approver(old.workspace_id) then
        raise exception 'Only a Quality approver can make this SOP effective';
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

      new.effective_revision_id := public.snapshot_sop_revision(old.id);

      if old.major_version is not null then
        insert into public.sop_change_log
          (sop_id, revision_id, from_version, to_version, reason, significance,
           requires_retraining, created_by)
        values (old.id, new.effective_revision_id,
                -- old.version already carries the bumped label, so it is never the FROM version.
                coalesce(v_prev_label,
                         coalesce(old.major_version, 1)::text || '.'
                           || greatest(coalesce(old.minor_version, 1) - 1, 0)::text),
                new.version,
                coalesce(nullif(btrim(old.revision_reason), ''), 'Revision'),
                old.change_significance, old.requires_retraining, auth.uid());
        new.revision_reason := null;
      end if;

    when 'effective->draft' then
      if not (is_manager or public.has_department_role(
                old.department_id, array['author', 'reviewer', 'approver']::public.department_sop_role[])) then
        raise exception 'Only a member of the owning department can start a revision';
      end if;
      if v_revision_reason is null or btrim(v_revision_reason) = '' then
        raise exception 'A revision needs a reason: what is changing, and why';
      end if;
      new.revision_reason := v_revision_reason;
      new.review_cycle := old.review_cycle + 1;
      new.minor_version := coalesce(old.minor_version, 0) + 1;
      new.version := coalesce(old.major_version, 1)::text || '.' || new.minor_version::text;
      new.submitted_by := null;
      new.approved_by := null;
      new.approved_at := null;

    when 'effective->obsolete', 'approved->obsolete', 'draft->obsolete' then
      if not (is_manager or public.has_department_role(
                old.department_id, array['approver']::public.department_sop_role[])) then
        raise exception 'Only a department approver can retire an SOP';
      end if;

    else
      raise exception 'Invalid SOP status transition from % to %', old.status, new.status;
  end case;

  return new;
end $$;
