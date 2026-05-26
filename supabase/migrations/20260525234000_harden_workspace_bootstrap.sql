-- Make workspace creation invite/admin controlled. Existing workspaces and members are unchanged.

drop policy if exists "workspaces authenticated insert" on workspaces;
create policy "workspaces admin controlled insert" on workspaces
for insert to authenticated
with check (false);

drop policy if exists "workspace_members bootstrap or admin insert" on workspace_members;
create policy "workspace_members admin insert" on workspace_members
for insert to authenticated
with check (public.has_workspace_role(workspace_id, array['owner', 'admin']::workspace_role[]));
