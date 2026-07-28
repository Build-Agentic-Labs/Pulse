-- Workspace-shared job titles for department rosters.
--
-- The position title assigned to a person came from a hardcoded map
-- (STANDARD_POSITION_TITLES, keyed by department code), so hiring a Calibration Technician meant
-- a code change before anyone could record it. Admins can now type a title, and it joins a
-- workspace list offered to every department.
--
-- Separate from sop_rasic_roles on purpose, and the separation is the whole point: a RASIC role
-- names an actor in a process and may be collective ("Board of Management", "Associates/
-- Employees"); a job title names one person on a roster. Merging them would offer "Board of
-- Management" when assigning a title to a real employee.
--
-- Purely additive. No existing table, function or trigger is touched.
--
-- Spec: docs/superpowers/specs/2026-07-28-editable-job-titles-design.md

create table if not exists public.sop_job_titles (
  id           text primary key default gen_random_uuid()::text,
  workspace_id text not null references public.workspaces(id) on delete cascade,
  name         text not null,
  created_by   uuid references auth.users(id),
  created_at   timestamptz not null default now()
);

-- Case and edge-whitespace near-duplicates die here; collapsing INTERNAL whitespace is the
-- app-side normalizer's job. Same shape as sop_rasic_roles_ws_name_uidx.
create unique index if not exists sop_job_titles_ws_name_uidx
  on public.sop_job_titles (workspace_id, lower(btrim(name)));

create index if not exists sop_job_titles_workspace_idx
  on public.sop_job_titles (workspace_id);

alter table public.sop_job_titles enable row level security;

-- Anyone who can edit SOPs in the workspace may read and add a job title; only workspace
-- owners/admins may rename or delete one. Identical rule and precedents to sop_rasic_roles.
drop policy if exists sop_job_titles_read on public.sop_job_titles;
create policy sop_job_titles_read on public.sop_job_titles
for select using (public.has_org_tool_access(workspace_id, 'view'::public.access_level));

drop policy if exists sop_job_titles_insert on public.sop_job_titles;
create policy sop_job_titles_insert on public.sop_job_titles
for insert to authenticated
with check (public.has_org_tool_access(workspace_id, 'edit'::public.access_level));

drop policy if exists sop_job_titles_update on public.sop_job_titles;
create policy sop_job_titles_update on public.sop_job_titles
for update to authenticated
using (public.has_workspace_role(workspace_id, array['owner', 'admin']::public.workspace_role[]))
with check (public.has_workspace_role(workspace_id, array['owner', 'admin']::public.workspace_role[]));

drop policy if exists sop_job_titles_delete on public.sop_job_titles;
create policy sop_job_titles_delete on public.sop_job_titles
for delete to authenticated
using (public.has_workspace_role(workspace_id, array['owner', 'admin']::public.workspace_role[]));

comment on table public.sop_job_titles is
  'Workspace-shared job titles for department rosters. STANDARD_POSITION_TITLES ships in code and is NOT here. Distinct from sop_rasic_roles: a title names a person, a role names a process actor.';
