-- Audit 2026-07-01 remediation (#13): role ceiling on workspace_members writes.
-- The insert/update policies (20260525234000 / 20260518231500) let any admin write
-- role = 'owner' — self-promotion or minting a crony owner, who could then delete
-- members or the workspace. Now only an existing owner (or superadmin, folded into
-- has_workspace_role) may create an owner row or modify an existing owner's row.
--
-- In USING, `role` is the target row's current role (admins cannot touch owner rows);
-- in WITH CHECK it is the written value (admins cannot write role = 'owner').

drop policy if exists "workspace_members admin insert" on workspace_members;
create policy "workspace_members admin insert" on workspace_members
for insert to authenticated
with check (
  public.has_workspace_role(workspace_id, array['owner', 'admin']::workspace_role[])
  and (
    role <> 'owner'
    or public.has_workspace_role(workspace_id, array['owner']::workspace_role[])
  )
);

drop policy if exists "workspace_members admin update" on workspace_members;
create policy "workspace_members admin update" on workspace_members
for update to authenticated
using (
  public.has_workspace_role(workspace_id, array['owner', 'admin']::workspace_role[])
  and (
    role <> 'owner'
    or public.has_workspace_role(workspace_id, array['owner']::workspace_role[])
  )
)
with check (
  public.has_workspace_role(workspace_id, array['owner', 'admin']::workspace_role[])
  and (
    role <> 'owner'
    or public.has_workspace_role(workspace_id, array['owner']::workspace_role[])
  )
);
