-- Organizational positions are distinct from SOP permissions. A person can be a
-- "VP Quality" while holding the cumulative SOP access role "approver".
alter table public.department_members
  add column if not exists position_title text not null default '';

alter table public.department_members
  drop constraint if exists department_members_position_title_length;
alter table public.department_members
  add constraint department_members_position_title_length
  check (char_length(position_title) <= 120);

-- Department rosters are organization directory data. Workspace SOP users need
-- to see them so an author can route a review to the correct named person.
drop policy if exists department_members_read on public.department_members;
create policy department_members_read on public.department_members
for select to authenticated
using (
  exists (
    select 1
    from public.departments d
    where d.id = department_id
      and public.has_org_tool_access(d.workspace_id, 'view'::public.access_level)
  )
);
