-- Per-user access model (UI-enforced, v1).
-- Two independent axes a manager/superadmin assigns per user:
--   * project_access: access to each "workspace" (project) — none / view / edit
--   * org_tool_access: access to the Org tools area (SOP builder) — none / view / edit
-- These tables drive UI gating (which workspaces show, view vs edit). The existing
-- workspace-role RLS on the data tables stays as the security backstop, so this migration
-- does NOT touch any data-table policies. Additive only.

do $$
begin
  if not exists (select 1 from pg_type where typname = 'access_level') then
    create type access_level as enum ('none', 'view', 'edit');
  end if;
end $$;

-- Per-user access to a specific project ("workspace" in the UI).
create table if not exists project_access (
  project_id text not null references projects(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  level access_level not null default 'none',
  granted_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (project_id, user_id)
);

create index if not exists project_access_user_id_idx on project_access(user_id);

drop trigger if exists project_access_set_updated_at on project_access;
create trigger project_access_set_updated_at
before update on project_access
for each row execute function set_updated_at();

-- Per-user access to the Org tools area.
create table if not exists org_tool_access (
  user_id uuid primary key references auth.users(id) on delete cascade,
  level access_level not null default 'none',
  granted_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

drop trigger if exists org_tool_access_set_updated_at on org_tool_access;
create trigger org_tool_access_set_updated_at
before update on org_tool_access
for each row execute function set_updated_at();

-- Helper: the workspace a project belongs to (security definer to avoid RLS recursion).
create or replace function public.project_workspace(target_project_id text)
returns text
language sql
stable
security definer
set search_path = public
as $$
  select workspace_id from public.projects where id = target_project_id;
$$;

alter table project_access enable row level security;
alter table org_tool_access enable row level security;

-- project_access: a user sees their own rows; workspace managers and superadmins see and
-- manage all rows for projects in workspaces they manage.
drop policy if exists "project_access self or manager read" on project_access;
create policy "project_access self or manager read" on project_access
for select to authenticated
using (
  user_id = auth.uid()
  or public.has_workspace_role(public.project_workspace(project_id), array['owner', 'admin']::workspace_role[])
);

drop policy if exists "project_access manager insert" on project_access;
create policy "project_access manager insert" on project_access
for insert to authenticated
with check (public.has_workspace_role(public.project_workspace(project_id), array['owner', 'admin']::workspace_role[]));

drop policy if exists "project_access manager update" on project_access;
create policy "project_access manager update" on project_access
for update to authenticated
using (public.has_workspace_role(public.project_workspace(project_id), array['owner', 'admin']::workspace_role[]))
with check (public.has_workspace_role(public.project_workspace(project_id), array['owner', 'admin']::workspace_role[]));

drop policy if exists "project_access manager delete" on project_access;
create policy "project_access manager delete" on project_access
for delete to authenticated
using (public.has_workspace_role(public.project_workspace(project_id), array['owner', 'admin']::workspace_role[]));

-- org_tool_access: a user sees their own row; superadmins (and workspace managers) manage.
-- Org tools are org-wide, so management is gated on superadmin or any owner/admin membership.
drop policy if exists "org_tool_access self or manager read" on org_tool_access;
create policy "org_tool_access self or manager read" on org_tool_access
for select to authenticated
using (
  user_id = auth.uid()
  or public.is_super_admin()
  or exists (
    select 1 from public.workspace_members wm
    where wm.user_id = auth.uid() and wm.role in ('owner', 'admin')
  )
);

drop policy if exists "org_tool_access manager write" on org_tool_access;
create policy "org_tool_access manager write" on org_tool_access
for all to authenticated
using (
  public.is_super_admin()
  or exists (
    select 1 from public.workspace_members wm
    where wm.user_id = auth.uid() and wm.role in ('owner', 'admin')
  )
)
with check (
  public.is_super_admin()
  or exists (
    select 1 from public.workspace_members wm
    where wm.user_id = auth.uid() and wm.role in ('owner', 'admin')
  )
);

-- Backfill so existing members keep the access they effectively have today (every member
-- can currently open every project in their workspace). Map role -> level.
insert into project_access (project_id, user_id, level)
select p.id, wm.user_id,
  case when wm.role in ('owner', 'admin', 'editor') then 'edit'::access_level else 'view'::access_level end
from public.workspace_members wm
join public.projects p on p.workspace_id = wm.workspace_id
on conflict (project_id, user_id) do nothing;

-- Existing members default to no Org tools access; superadmins bypass at the app layer.
insert into org_tool_access (user_id, level)
select wm.user_id, 'none'::access_level
from (select distinct user_id from public.workspace_members) wm
on conflict (user_id) do nothing;
