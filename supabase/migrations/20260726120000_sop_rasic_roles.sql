-- Workspace-shared RASIC role vocabulary for SOP procedures.
--
-- Role names in the procedure matrix have until now come from one hardcoded map
-- (STANDARD_POSITION_TITLES, keyed by department code), so an author whose process involves an
-- actor outside that map had no way to express it. Authors may now type a role in the dropdown;
-- it is saved on the document AND added here, immediately visible to every author.
--
-- Purely additive: no existing table, function or trigger is touched. In particular neither
-- enforce_sop_transition nor sign_sop is involved, so the patched-in-place rule does not apply.
--
-- Deliberately NOT seeded with the eight "General" roles (EVP Operations, Supervisor, Team
-- Leader, Quality Inspector, Operator, Associates/Employees, HoD, Board of Management). Those
-- ship in code as GENERAL_RASIC_ROLES: no per-workspace bootstrap, new workspaces work on day
-- one, and a code-shipped baseline cannot be deleted the way a row can. Curation therefore
-- applies exactly where drift happens — the roles people type.
--
-- Spec: docs/superpowers/specs/2026-07-26-sop-rasic-roles-design.md

create table if not exists public.sop_rasic_roles (
  id           text primary key default gen_random_uuid()::text,
  workspace_id text not null references public.workspaces(id) on delete cascade,
  name         text not null,
  created_by   uuid references auth.users(id),
  created_at   timestamptz not null default now()
);

-- Case and edge-whitespace near-duplicates die at the source of truth; collapsing INTERNAL
-- whitespace is the app-side normalizer's job. Between the two, "Team Leader", " team leader "
-- and "Team  Leader" are one role. Same shape as departments_ws_code_uidx.
create unique index if not exists sop_rasic_roles_ws_name_uidx
  on public.sop_rasic_roles (workspace_id, lower(btrim(name)));

create index if not exists sop_rasic_roles_workspace_idx
  on public.sop_rasic_roles (workspace_id);

alter table public.sop_rasic_roles enable row level security;

-- Anyone who can edit SOPs in the workspace may read and add roles; only workspace
-- owners/admins may rename or delete one. Each policy mirrors an existing precedent rather
-- than inventing a predicate: departments_read, the sops insert policy, departments_write.
drop policy if exists sop_rasic_roles_read on public.sop_rasic_roles;
create policy sop_rasic_roles_read on public.sop_rasic_roles
for select using (public.has_org_tool_access(workspace_id, 'view'::public.access_level));

drop policy if exists sop_rasic_roles_insert on public.sop_rasic_roles;
create policy sop_rasic_roles_insert on public.sop_rasic_roles
for insert to authenticated
with check (public.has_org_tool_access(workspace_id, 'edit'::public.access_level));

-- update and delete are curation, not authoring: the same gate the departments admin uses.
drop policy if exists sop_rasic_roles_update on public.sop_rasic_roles;
create policy sop_rasic_roles_update on public.sop_rasic_roles
for update to authenticated
using (public.has_workspace_role(workspace_id, array['owner', 'admin']::public.workspace_role[]))
with check (public.has_workspace_role(workspace_id, array['owner', 'admin']::public.workspace_role[]));

drop policy if exists sop_rasic_roles_delete on public.sop_rasic_roles;
create policy sop_rasic_roles_delete on public.sop_rasic_roles
for delete to authenticated
using (public.has_workspace_role(workspace_id, array['owner', 'admin']::public.workspace_role[]));

comment on table public.sop_rasic_roles is
  'Workspace-shared RASIC role names typed by SOP authors. The eight General roles are NOT here — they ship in code as GENERAL_RASIC_ROLES.';
