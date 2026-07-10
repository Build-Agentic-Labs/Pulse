-- D1 (security): department-scoped SOP visibility granted access instead of denying it.
--
-- 20260708120000 grandfathered memberless departments with an INLINE subquery:
--
--   or not exists (select 1 from public.department_members m
--                  where m.department_id = public.sops.department_id)
--
-- A policy expression is evaluated under the CALLER's own RLS, and department_members_read
-- exposes only rows where user_id = auth.uid(). So to any non-member every department looks
-- memberless, the `not exists` returns true, and the branch grants read (and, on the update
-- policy, write) on every other department's drafts. has_department_role escaped this only
-- because it is security definer.
--
-- Rule going forward: NO inline cross-table subqueries in RLS policies. Every cross-table
-- predicate goes through a security definer helper, which runs as the table owner and is not
-- itself filtered.

create or replace function public.department_has_members(dept_id text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select dept_id is not null
     and exists (select 1 from public.department_members m where m.department_id = dept_id);
$$;

revoke execute on function public.department_has_members(text) from public, anon;
grant execute on function public.department_has_members(text) to authenticated;

drop policy if exists "sops workspace read" on public.sops;
create policy "sops workspace read" on public.sops
for select to authenticated
using (
  (
    status = 'effective'
    and exists (
      select 1 from public.workspace_members wm
      where wm.workspace_id = public.sops.workspace_id and wm.user_id = auth.uid()
    )
  )
  or (
    public.has_org_tool_access(workspace_id, 'view'::public.access_level)
    and (
      department_id is null
      or public.has_department_role(
           department_id, array['author', 'reviewer', 'approver']::public.department_sop_role[])
      or not public.department_has_members(department_id)
    )
  )
);

drop policy if exists "sops workspace insert" on public.sops;
create policy "sops workspace insert" on public.sops
for insert to authenticated
with check (
  public.has_org_tool_access(workspace_id, 'edit'::public.access_level)
  and (
    department_id is null
    or public.has_department_role(
         department_id, array['author', 'reviewer', 'approver']::public.department_sop_role[])
    or not public.department_has_members(department_id)
  )
);

drop policy if exists "sops workspace update" on public.sops;
create policy "sops workspace update" on public.sops
for update to authenticated
using (
  public.has_org_tool_access(workspace_id, 'edit'::public.access_level)
  and (
    department_id is null
    or public.has_department_role(
         department_id, array['author', 'reviewer', 'approver']::public.department_sop_role[])
    or not public.department_has_members(department_id)
  )
)
with check (
  public.has_org_tool_access(workspace_id, 'edit'::public.access_level)
  and (
    department_id is null
    or public.has_department_role(
         department_id, array['author', 'reviewer', 'approver']::public.department_sop_role[])
    or not public.department_has_members(department_id)
  )
);
