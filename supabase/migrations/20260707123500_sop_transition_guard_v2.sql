-- SOP transition guard v2 — supersedes v1. The database is the ONLY enforcement layer, so this
-- must survive a raw PostgREST INSERT/PATCH from any org-tool editor:
--   * INSERT: SOPs are born as drafts; strip any client-sent lifecycle state.
--   * Trigger-managed columns (submitted_by/approved_by/approved_at/effective_revision_id/version/
--     effective_date/next_review_date/rejected_by/workspace_id/created_by) are pinned to OLD so a
--     PATCH can't forge the segregation-of-duties anchors or the in-force pointer.
--   * Content freeze applies on EVERY edge out of a non-draft state (not only status-unchanged),
--     so a transition can't smuggle a document change past a signature.
--   * Approve/effective require a valid content-bound signature; version is stamped/bumped here.
create or replace function public.enforce_sop_transition()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  is_manager boolean;
  v_reason text;
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
    return new;
  end if;

  is_manager := public.has_workspace_role(
    old.workspace_id, array['owner', 'admin']::public.workspace_role[]);

  -- Capture the client's intended rejection reason before pinning it away.
  v_reason := new.rejected_reason;

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

  -- Content/settings freeze: only a draft is editable, on every edge (including status changes).
  if old.status <> 'draft' then
    if new.document is distinct from old.document
       or new.title is distinct from old.title
       or new.sop_number is distinct from old.sop_number
       or new.department_id is distinct from old.department_id
       or new.doc_type is distinct from old.doc_type
       or new.version is distinct from old.version
       or new.review_interval_months is distinct from old.review_interval_months then
      raise exception 'This SOP is %; start a revision before editing its content', old.status;
    end if;
  end if;

  -- Soft-delete guard.
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
      if not (is_manager
              or auth.uid() is not distinct from old.submitted_by
              or public.has_department_role(
                   old.department_id, array['reviewer', 'approver']::public.department_sop_role[])) then
        raise exception 'Only a reviewer, approver, or the submitter can send this SOP back';
      end if;
      if v_reason is null or btrim(v_reason) = '' then
        raise exception 'A rejection needs a reason';
      end if;
      new.rejected_reason := v_reason;
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
      -- First time effective → version 1.0; later effectives keep the revision's bumped version.
      if old.major_version is null then
        new.major_version := 1;
        new.minor_version := 0;
      end if;
      new.version := new.major_version::text || '.' || new.minor_version::text;
      new.effective_date := current_date;
      new.next_review_date := (current_date
        + (coalesce(old.review_interval_months, 24) || ' months')::interval)::date;
      new.effective_revision_id := public.snapshot_sop_revision(old.id);

    when 'effective->draft' then  -- start a revision (bump minor)
      if not (is_manager or public.has_department_role(
                old.department_id, array['author', 'reviewer', 'approver']::public.department_sop_role[])) then
        raise exception 'Only a member of the owning department can start a revision';
      end if;
      new.minor_version := coalesce(old.minor_version, 0) + 1;
      new.version := coalesce(old.major_version, 1)::text || '.' || new.minor_version::text;

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

-- Fire on INSERT too (the v1 trigger was UPDATE-only, which let a client INSERT a born-effective row).
drop trigger if exists sops_enforce_transition on public.sops;
create trigger sops_enforce_transition
before insert or update on public.sops
for each row execute function public.enforce_sop_transition();
