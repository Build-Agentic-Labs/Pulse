-- `can_read_sop(id)` reads the SOP back through a separate self-query. During
-- INSERT ... RETURNING, that lookup cannot see the row being inserted yet, so PostgreSQL
-- rejects an otherwise-authorized insert with an RLS violation. Evaluate the same rules
-- directly against the candidate row in the SELECT policy; dependent-table policies can
-- continue using can_read_sop(id) for already-persisted rows.
drop policy if exists "sops workspace read" on public.sops;
create policy "sops workspace read" on public.sops
for select to authenticated
using (
  (
    status = 'effective'
    and public.has_workspace_role(
      workspace_id,
      array['owner', 'admin', 'editor', 'viewer']::public.workspace_role[]
    )
  )
  or (
    public.has_org_tool_access(workspace_id, 'view'::public.access_level)
    and (
      department_id is null
      or public.has_department_role(
        department_id,
        array['author', 'reviewer', 'approver']::public.department_sop_role[]
      )
      or not public.department_has_members(department_id)
    )
  )
  or public.holds_sop_seat(id)
);
