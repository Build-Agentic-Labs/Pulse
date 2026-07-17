-- Workspace SOP users may browse every department's documents, while draft content remains
-- editable only by explicit members of the owning department. Lifecycle actions performed by
-- authorized managers remain possible because they do not alter draft content.

create or replace function public.can_read_sop(p_sop text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.sops s
    where s.id = p_sop
      and (
        public.has_org_tool_access(s.workspace_id, 'view'::public.access_level)
        or (
          s.status = 'effective'
          and public.has_workspace_role(
            s.workspace_id,
            array['owner', 'admin', 'editor', 'viewer']::public.workspace_role[]
          )
        )
        or public.holds_sop_seat(s.id)
      )
  );
$$;

drop policy if exists "sops workspace read" on public.sops;
create policy "sops workspace read" on public.sops
for select to authenticated
using (
  public.has_org_tool_access(workspace_id, 'view'::public.access_level)
  or (
    status = 'effective'
    and public.has_workspace_role(
      workspace_id,
      array['owner', 'admin', 'editor', 'viewer']::public.workspace_role[]
    )
  )
  or public.holds_sop_seat(id)
);

create or replace function public.can_edit_sop_roster(p_sop text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.sops s
    where s.id = p_sop
      and s.status = 'draft'
      and s.deleted_at is null
      and public.has_org_tool_access(s.workspace_id, 'edit'::public.access_level)
      and (
        s.department_id is null
        or public.is_department_member(s.department_id)
        or not public.department_has_members(s.department_id)
      )
  );
$$;

-- The broad UPDATE policy still lets managers perform lifecycle-only transitions. This trigger
-- prevents an authenticated caller from changing another department's draft content or deleting
-- that draft, even when their workspace role would otherwise fold into has_department_role().
create or replace function public.enforce_sop_department_content_edit()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if current_user = 'authenticated'
     and old.status = 'draft'
     and old.department_id is not null
     and not public.is_department_member(old.department_id)
     and (
       new.document is distinct from old.document
       or new.title is distinct from old.title
       or new.sop_number is distinct from old.sop_number
       or new.department_id is distinct from old.department_id
       or new.doc_type is distinct from old.doc_type
       or new.version is distinct from old.version
       or new.change_significance is distinct from old.change_significance
       or new.requires_retraining is distinct from old.requires_retraining
       or new.review_interval_months is distinct from old.review_interval_months
       or new.deleted_at is distinct from old.deleted_at
     ) then
    raise exception 'This draft belongs to another department and is view-only';
  end if;
  return new;
end $$;

drop trigger if exists sops_ab_department_content_edit on public.sops;
create trigger sops_ab_department_content_edit
before update on public.sops
for each row execute function public.enforce_sop_department_content_edit();
