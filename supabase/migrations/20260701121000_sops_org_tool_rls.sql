-- Audit 2026-07-01 remediation (#4): enforce org_tool_access at the database, not just
-- in the UI. Until now any workspace member (including domain-auto-joined viewers) could
-- read every SOP via PostgREST, and any editor could write/delete them, regardless of
-- their org-tools level — the same UI-only-enforcement gap class 20260601124000 closed
-- for the planner tables.
--
-- has_org_tool_access mirrors has_project_access: workspace owners/admins (and
-- superadmins, folded into has_workspace_role) manage unconditionally; everyone else
-- needs workspace membership AND an org_tool_access row at or above the required level.

create or replace function public.has_org_tool_access(target_workspace_id text, min_level public.access_level)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select
    target_workspace_id is not null
    and (
      public.has_workspace_role(target_workspace_id, array['owner', 'admin']::public.workspace_role[])
      or (
        public.has_workspace_role(
          target_workspace_id,
          array['owner', 'admin', 'editor', 'viewer']::public.workspace_role[]
        )
        and exists (
          select 1
          from public.org_tool_access ota
          where ota.user_id = auth.uid()
            and ota.level >= min_level
        )
      )
    );
$$;

drop policy if exists "sops workspace read" on public.sops;
create policy "sops workspace read" on public.sops
for select to authenticated
using (public.has_org_tool_access(workspace_id, 'view'::access_level));

drop policy if exists "sops workspace insert" on public.sops;
create policy "sops workspace insert" on public.sops
for insert to authenticated
with check (public.has_org_tool_access(workspace_id, 'edit'::access_level));

drop policy if exists "sops workspace update" on public.sops;
create policy "sops workspace update" on public.sops
for update to authenticated
using (public.has_org_tool_access(workspace_id, 'edit'::access_level))
with check (public.has_org_tool_access(workspace_id, 'edit'::access_level));

drop policy if exists "sops workspace delete" on public.sops;
create policy "sops workspace delete" on public.sops
for delete to authenticated
using (public.has_org_tool_access(workspace_id, 'edit'::access_level));
