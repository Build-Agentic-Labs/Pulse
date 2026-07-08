-- SOP transition guard v2 — supersedes v1. Adds the signature preconditions (a valid, content-
-- bound e-signature must exist before approve/effective) and, on becoming effective, snapshots a
-- frozen revision and points sops.effective_revision_id at it. Freeze/soft-delete/other edges are
-- unchanged from v1.
create or replace function public.enforce_sop_transition()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  is_manager boolean;
begin
  is_manager := public.has_workspace_role(
    old.workspace_id, array['owner', 'admin']::public.workspace_role[]);

  if old.status <> 'draft' and new.status = old.status then
    if new.document is distinct from old.document
       or new.title is distinct from old.title
       or new.sop_number is distinct from old.sop_number
       or new.department_id is distinct from old.department_id
       or new.version is distinct from old.version then
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
        raise exception 'Assign a department before submitting for review';
      end if;
      if not (is_manager or public.has_department_role(
                new.department_id, array['author', 'reviewer', 'approver']::public.department_sop_role[])) then
        raise exception 'Only a member of the owning department can submit this SOP';
      end if;
      new.submitted_by := auth.uid();
      new.rejected_reason := null;
      new.rejected_by := null;

    when 'in_review->approved' then
      if old.submitted_by is null then
        raise exception 'This SOP has no recorded submitter; resubmit it for review before approval';
      end if;
      if auth.uid() is not distinct from coalesce(old.submitted_by, old.created_by) then
        raise exception 'You cannot approve an SOP you submitted for review';
      end if;
      if not exists (
        select 1 from public.sop_signatures sg
        where sg.sop_id = old.id and sg.meaning = 'dept_approval'
          and sg.signer_id = auth.uid()
          and sg.signed_content_hash = public.sop_doc_hash(old.document)) then
        raise exception 'Sign the department approval before approving this SOP';
      end if;
      new.approved_by := auth.uid();
      new.approved_at := now();

    when 'in_review->draft' then  -- reject / rework
      if new.rejected_reason is null or btrim(new.rejected_reason) = '' then
        raise exception 'A rejection needs a reason';
      end if;
      new.submitted_by := null;
      new.rejected_by := auth.uid();

    when 'approved->effective' then
      if not exists (
        select 1 from public.sop_signatures sg
        where sg.sop_id = old.id and sg.meaning = 'quality_approval'
          and sg.signer_id = auth.uid()
          and sg.signed_content_hash = public.sop_doc_hash(old.document)) then
        raise exception 'Sign the quality approval before making this SOP effective';
      end if;
      if auth.uid() is not distinct from old.approved_by then
        raise exception 'The Quality approver must differ from the department approver';
      end if;
      if new.effective_date is null then
        new.effective_date := current_date;
      end if;
      new.next_review_date := (new.effective_date
        + (coalesce(new.review_interval_months, 24) || ' months')::interval)::date;
      new.effective_revision_id := public.snapshot_sop_revision(old.id);

    when 'effective->draft' then  -- start a revision
      if not (is_manager or public.has_department_role(
                old.department_id, array['author', 'reviewer', 'approver']::public.department_sop_role[])) then
        raise exception 'Only a member of the owning department can start a revision';
      end if;

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
