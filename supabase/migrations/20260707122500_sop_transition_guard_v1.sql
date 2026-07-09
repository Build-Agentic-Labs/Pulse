-- SOP transition guard v1 — the DB-side mirror of canTransitionSop (src/domain/sop/lifecycle.ts).
-- A PLAIN `before update` trigger (NOT `of status`): a raw PostgREST PATCH that changes only
-- `document` or `deleted_at` must still be caught, because the database is the only enforcement
-- layer. v2 (later migration) adds the signature preconditions and the effective-revision snapshot.
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

  -- Content freeze: once an SOP leaves draft, its body/header is immutable. Edits are only
  -- allowed by first starting a revision (effective -> draft), which is a status change and
  -- therefore not blocked here.
  if old.status <> 'draft' and new.status = old.status then
    if new.document is distinct from old.document
       or new.title is distinct from old.title
       or new.sop_number is distinct from old.sop_number
       or new.department_id is distinct from old.department_id
       or new.version is distinct from old.version then
      raise exception 'This SOP is %; start a revision before editing its content', old.status;
    end if;
  end if;

  -- Soft-delete guard: only a draft/obsolete SOP (or a manager) may be soft-deleted, so an
  -- in-force controlled document can't be quietly removed by a raw PATCH of deleted_at.
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
      if not (is_manager or public.has_department_role(
                old.department_id, array['approver']::public.department_sop_role[])) then
        raise exception 'Only a department approver can approve this SOP';
      end if;
      if old.submitted_by is null then
        raise exception 'This SOP has no recorded submitter; resubmit it for review before approval';
      end if;
      if auth.uid() is not distinct from coalesce(old.submitted_by, old.created_by) then
        raise exception 'You cannot approve an SOP you submitted for review';
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
      -- Independent Quality gate: an approver in the workspace's is_quality_gate department,
      -- and NOT the same person who approved (distinct-signer). Snapshot is added in v2.
      if not (is_manager or exists (
                select 1 from public.department_members m
                join public.departments q on q.id = m.department_id
                where m.user_id = auth.uid() and m.dept_role = 'approver'
                  and q.is_quality_gate and q.workspace_id = old.workspace_id)) then
        raise exception 'Only a Quality approver can make an SOP effective';
      end if;
      if auth.uid() is not distinct from old.approved_by then
        raise exception 'The Quality approver must differ from the department approver';
      end if;
      if new.effective_date is null then
        new.effective_date := current_date;
      end if;
      new.next_review_date := (new.effective_date
        + (coalesce(new.review_interval_months, 24) || ' months')::interval)::date;

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

drop trigger if exists sops_enforce_transition on public.sops;
create trigger sops_enforce_transition
before update on public.sops
for each row execute function public.enforce_sop_transition();

-- Immutable, minimal status-change audit trail (Part 11 §11.10(e)) — NOT the generic
-- audit_access_change (which would copy the whole document jsonb on every autosave).
create or replace function public.audit_sop_status()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.status is distinct from old.status then
    insert into public.audit_log (workspace_id, actor_id, actor_email, action, target_type, target_id, details)
    values (
      new.workspace_id,
      auth.uid(),
      (select email from public.profiles where id = auth.uid()),
      'sop.status',
      'sop',
      new.id,
      jsonb_build_object('from', old.status, 'to', new.status)
    );
  end if;
  return new;
end $$;

drop trigger if exists sops_audit_status on public.sops;
create trigger sops_audit_status
after update of status on public.sops
for each row execute function public.audit_sop_status();
