-- Department-scoped SOP visibility (spec §5), rolled out NON-BREAKINGLY:
--   * Effective SOPs are the org-wide read-only library — readable by any workspace member,
--     independent of org_tool_access.
--   * Everything else needs org_tool_access(view) AND belongs to a department the user is in
--     (has_department_role folds in managers/superadmin) — EXCEPT a department with no members
--     yet (or a null department) stays open to org-tool users. That grandfathers all existing
--     "Unassigned" / legacy SOPs: a department only becomes access-scoped once it has members,
--     so nobody loses access on deploy.
--   * Writes mirror the same rule at org_tool_access(edit).
--   * The owner/admin-only hard-delete policy (20260702120000) is left untouched.

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
      or not exists (
        select 1 from public.department_members m where m.department_id = public.sops.department_id
      )
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
    or not exists (
      select 1 from public.department_members m where m.department_id = public.sops.department_id
    )
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
    or not exists (
      select 1 from public.department_members m where m.department_id = public.sops.department_id
    )
  )
)
with check (
  public.has_org_tool_access(workspace_id, 'edit'::public.access_level)
  and (
    department_id is null
    or public.has_department_role(
         department_id, array['author', 'reviewer', 'approver']::public.department_sop_role[])
    or not exists (
      select 1 from public.department_members m where m.department_id = public.sops.department_id
    )
  )
);
