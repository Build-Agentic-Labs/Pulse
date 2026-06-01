-- Per-project RLS isolation (v2 of the user-access model).
--
-- v1 (20260601123000) added project_access / org_tool_access but enforced them UI-only:
-- the planner data tables still gated reads/writes on has_workspace_role(workspace_id, ...),
-- so any authenticated workspace member could read or mutate ANY project's rows by calling
-- PostgREST directly. This migration closes that gap by moving the data-table policies onto
-- a per-project check, has_project_access(), while keeping workspace managers and superadmins
-- fully unrestricted (they manage every project in their workspace).
--
-- Access tiers (access_level enum is ordered none < view < edit):
--   * read   -> requires 'view'  (view or edit grant, or manager/superadmin)
--   * insert -> requires 'edit'
--   * update -> requires 'edit'
--   * delete -> requires 'edit'  (an 'edit' grant is full edit incl. delete WITHIN that
--               project; still fully isolated from other projects)
--
-- The projects table's own insert/update/delete stay workspace-role based: creating or
-- deleting an entire project/workspace is a manager action, not a per-project-edit action.
-- Only projects READ is scoped per-project (a user sees only projects they can access).
--
-- Additive & non-destructive: only replaces policy bodies and adds helper functions. No table,
-- column, or row is touched, so existing members keep exactly the access the v1 backfill gave
-- them (edit/view on every current project).

-- ---------------------------------------------------------------------------
-- Project-id resolvers (mirror the *_workspace_id chain from 20260518231500).
-- ---------------------------------------------------------------------------
create or replace function public.product_project_id(target_product_id text)
returns text
language sql
security definer
stable
set search_path = public
as $$
  select pr.project_id
  from public.products pr
  where pr.id = target_product_id;
$$;

create or replace function public.scenario_project_id(target_scenario_id text)
returns text
language sql
security definer
stable
set search_path = public
as $$
  select public.product_project_id(s.product_id)
  from public.scenarios s
  where s.id = target_scenario_id;
$$;

create or replace function public.task_project_id(target_task_id text)
returns text
language sql
security definer
stable
set search_path = public
as $$
  select public.scenario_project_id(t.scenario_id)
  from public.tasks t
  where t.id = target_task_id;
$$;

create or replace function public.custom_column_project_id(target_product_id text, target_scenario_id text)
returns text
language sql
security definer
stable
set search_path = public
as $$
  select coalesce(
    case when target_product_id is not null then public.product_project_id(target_product_id) end,
    case when target_scenario_id is not null then public.scenario_project_id(target_scenario_id) end
  );
$$;

-- ---------------------------------------------------------------------------
-- The per-project access check. Managers (owner/admin), the workspace owner, and superadmins
-- pass for every project in their workspace (via has_workspace_role, which already folds in
-- is_super_admin() and the owner_id fallback). Everyone else needs an explicit project_access
-- grant at or above min_level. SECURITY DEFINER so it bypasses RLS on project_access (no
-- recursion) and on the resolver joins.
-- ---------------------------------------------------------------------------
create or replace function public.has_project_access(target_project_id text, min_level access_level)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select
    target_project_id is not null
    and (
      public.has_workspace_role(
        public.project_workspace_id(target_project_id),
        array['owner', 'admin']::workspace_role[]
      )
      or exists (
        select 1
        from public.project_access pa
        where pa.project_id = target_project_id
          and pa.user_id = auth.uid()
          and pa.level >= min_level
      )
    );
$$;

-- ===========================================================================
-- projects: a user reads only projects they have access to (managers see all).
-- insert/update/delete role gating is unchanged (still workspace-role based).
-- ===========================================================================
drop policy if exists "projects member read" on projects;
create policy "projects member read" on projects
for select to authenticated
using (public.has_project_access(id, 'view'::access_level));

-- ===========================================================================
-- products (project_id is a direct column).
-- ===========================================================================
drop policy if exists "products workspace read" on products;
create policy "products workspace read" on products
for select to authenticated
using (public.has_project_access(project_id, 'view'::access_level));

drop policy if exists "products workspace insert" on products;
create policy "products workspace insert" on products
for insert to authenticated
with check (project_id is not null and public.has_project_access(project_id, 'edit'::access_level));

drop policy if exists "products workspace update" on products;
create policy "products workspace update" on products
for update to authenticated
using (public.has_project_access(project_id, 'edit'::access_level))
with check (public.has_project_access(project_id, 'edit'::access_level));

drop policy if exists "products workspace delete" on products;
create policy "products workspace delete" on products
for delete to authenticated
using (public.has_project_access(project_id, 'edit'::access_level));

-- ===========================================================================
-- scenarios (resolve project via product_id).
-- ===========================================================================
drop policy if exists "scenarios workspace read" on scenarios;
create policy "scenarios workspace read" on scenarios
for select to authenticated
using (public.has_project_access(public.product_project_id(product_id), 'view'::access_level));

drop policy if exists "scenarios workspace insert" on scenarios;
create policy "scenarios workspace insert" on scenarios
for insert to authenticated
with check (public.has_project_access(public.product_project_id(product_id), 'edit'::access_level));

drop policy if exists "scenarios workspace update" on scenarios;
create policy "scenarios workspace update" on scenarios
for update to authenticated
using (public.has_project_access(public.product_project_id(product_id), 'edit'::access_level))
with check (public.has_project_access(public.product_project_id(product_id), 'edit'::access_level));

drop policy if exists "scenarios workspace delete" on scenarios;
create policy "scenarios workspace delete" on scenarios
for delete to authenticated
using (public.has_project_access(public.product_project_id(product_id), 'edit'::access_level));

-- ===========================================================================
-- stations / zones / tasks (resolve project via scenario_id).
-- ===========================================================================
drop policy if exists "stations workspace read" on stations;
create policy "stations workspace read" on stations
for select to authenticated
using (public.has_project_access(public.scenario_project_id(scenario_id), 'view'::access_level));

drop policy if exists "stations workspace insert" on stations;
create policy "stations workspace insert" on stations
for insert to authenticated
with check (public.has_project_access(public.scenario_project_id(scenario_id), 'edit'::access_level));

drop policy if exists "stations workspace update" on stations;
create policy "stations workspace update" on stations
for update to authenticated
using (public.has_project_access(public.scenario_project_id(scenario_id), 'edit'::access_level))
with check (public.has_project_access(public.scenario_project_id(scenario_id), 'edit'::access_level));

drop policy if exists "stations workspace delete" on stations;
create policy "stations workspace delete" on stations
for delete to authenticated
using (public.has_project_access(public.scenario_project_id(scenario_id), 'edit'::access_level));

drop policy if exists "zones workspace read" on zones;
create policy "zones workspace read" on zones
for select to authenticated
using (public.has_project_access(public.scenario_project_id(scenario_id), 'view'::access_level));

drop policy if exists "zones workspace insert" on zones;
create policy "zones workspace insert" on zones
for insert to authenticated
with check (public.has_project_access(public.scenario_project_id(scenario_id), 'edit'::access_level));

drop policy if exists "zones workspace update" on zones;
create policy "zones workspace update" on zones
for update to authenticated
using (public.has_project_access(public.scenario_project_id(scenario_id), 'edit'::access_level))
with check (public.has_project_access(public.scenario_project_id(scenario_id), 'edit'::access_level));

drop policy if exists "zones workspace delete" on zones;
create policy "zones workspace delete" on zones
for delete to authenticated
using (public.has_project_access(public.scenario_project_id(scenario_id), 'edit'::access_level));

drop policy if exists "tasks workspace read" on tasks;
create policy "tasks workspace read" on tasks
for select to authenticated
using (public.has_project_access(public.scenario_project_id(scenario_id), 'view'::access_level));

drop policy if exists "tasks workspace insert" on tasks;
create policy "tasks workspace insert" on tasks
for insert to authenticated
with check (public.has_project_access(public.scenario_project_id(scenario_id), 'edit'::access_level));

drop policy if exists "tasks workspace update" on tasks;
create policy "tasks workspace update" on tasks
for update to authenticated
using (public.has_project_access(public.scenario_project_id(scenario_id), 'edit'::access_level))
with check (public.has_project_access(public.scenario_project_id(scenario_id), 'edit'::access_level));

drop policy if exists "tasks workspace delete" on tasks;
create policy "tasks workspace delete" on tasks
for delete to authenticated
using (public.has_project_access(public.scenario_project_id(scenario_id), 'edit'::access_level));

-- ===========================================================================
-- task_dependencies (resolve via tasks; require edit on BOTH endpoints for writes,
-- matching the seed-fix migration's two-sided check).
-- ===========================================================================
drop policy if exists "task_dependencies workspace read" on task_dependencies;
create policy "task_dependencies workspace read" on task_dependencies
for select to authenticated
using (public.has_project_access(public.task_project_id(successor_task_id), 'view'::access_level));

drop policy if exists "task_dependencies workspace insert" on task_dependencies;
create policy "task_dependencies workspace insert" on task_dependencies
for insert to authenticated
with check (
  public.has_project_access(public.task_project_id(successor_task_id), 'edit'::access_level)
  and public.has_project_access(public.task_project_id(predecessor_task_id), 'edit'::access_level)
);

drop policy if exists "task_dependencies workspace update" on task_dependencies;
create policy "task_dependencies workspace update" on task_dependencies
for update to authenticated
using (public.has_project_access(public.task_project_id(successor_task_id), 'edit'::access_level))
with check (
  public.has_project_access(public.task_project_id(successor_task_id), 'edit'::access_level)
  and public.has_project_access(public.task_project_id(predecessor_task_id), 'edit'::access_level)
);

drop policy if exists "task_dependencies workspace delete" on task_dependencies;
create policy "task_dependencies workspace delete" on task_dependencies
for delete to authenticated
using (public.has_project_access(public.task_project_id(successor_task_id), 'edit'::access_level));

-- ===========================================================================
-- task-scoped child tables: manufacturing_steps, part_references, actual_events,
-- step_photos, step_tools (resolve project via task_id).
-- ===========================================================================
drop policy if exists "manufacturing_steps workspace read" on manufacturing_steps;
create policy "manufacturing_steps workspace read" on manufacturing_steps
for select to authenticated
using (public.has_project_access(public.task_project_id(task_id), 'view'::access_level));

drop policy if exists "manufacturing_steps workspace insert" on manufacturing_steps;
create policy "manufacturing_steps workspace insert" on manufacturing_steps
for insert to authenticated
with check (public.has_project_access(public.task_project_id(task_id), 'edit'::access_level));

drop policy if exists "manufacturing_steps workspace update" on manufacturing_steps;
create policy "manufacturing_steps workspace update" on manufacturing_steps
for update to authenticated
using (public.has_project_access(public.task_project_id(task_id), 'edit'::access_level))
with check (public.has_project_access(public.task_project_id(task_id), 'edit'::access_level));

drop policy if exists "manufacturing_steps workspace delete" on manufacturing_steps;
create policy "manufacturing_steps workspace delete" on manufacturing_steps
for delete to authenticated
using (public.has_project_access(public.task_project_id(task_id), 'edit'::access_level));

drop policy if exists "part_references workspace read" on part_references;
create policy "part_references workspace read" on part_references
for select to authenticated
using (public.has_project_access(public.task_project_id(task_id), 'view'::access_level));

drop policy if exists "part_references workspace insert" on part_references;
create policy "part_references workspace insert" on part_references
for insert to authenticated
with check (public.has_project_access(public.task_project_id(task_id), 'edit'::access_level));

drop policy if exists "part_references workspace update" on part_references;
create policy "part_references workspace update" on part_references
for update to authenticated
using (public.has_project_access(public.task_project_id(task_id), 'edit'::access_level))
with check (public.has_project_access(public.task_project_id(task_id), 'edit'::access_level));

drop policy if exists "part_references workspace delete" on part_references;
create policy "part_references workspace delete" on part_references
for delete to authenticated
using (public.has_project_access(public.task_project_id(task_id), 'edit'::access_level));

drop policy if exists "actual_events workspace read" on actual_events;
create policy "actual_events workspace read" on actual_events
for select to authenticated
using (public.has_project_access(public.task_project_id(task_id), 'view'::access_level));

drop policy if exists "actual_events workspace insert" on actual_events;
create policy "actual_events workspace insert" on actual_events
for insert to authenticated
with check (public.has_project_access(public.task_project_id(task_id), 'edit'::access_level));

drop policy if exists "actual_events workspace update" on actual_events;
create policy "actual_events workspace update" on actual_events
for update to authenticated
using (public.has_project_access(public.task_project_id(task_id), 'edit'::access_level))
with check (public.has_project_access(public.task_project_id(task_id), 'edit'::access_level));

drop policy if exists "actual_events workspace delete" on actual_events;
create policy "actual_events workspace delete" on actual_events
for delete to authenticated
using (public.has_project_access(public.task_project_id(task_id), 'edit'::access_level));

drop policy if exists "step_photos workspace read" on step_photos;
create policy "step_photos workspace read" on step_photos
for select to authenticated
using (public.has_project_access(public.task_project_id(task_id), 'view'::access_level));

drop policy if exists "step_photos workspace insert" on step_photos;
create policy "step_photos workspace insert" on step_photos
for insert to authenticated
with check (public.has_project_access(public.task_project_id(task_id), 'edit'::access_level));

drop policy if exists "step_photos workspace update" on step_photos;
create policy "step_photos workspace update" on step_photos
for update to authenticated
using (public.has_project_access(public.task_project_id(task_id), 'edit'::access_level))
with check (public.has_project_access(public.task_project_id(task_id), 'edit'::access_level));

drop policy if exists "step_photos workspace delete" on step_photos;
create policy "step_photos workspace delete" on step_photos
for delete to authenticated
using (public.has_project_access(public.task_project_id(task_id), 'edit'::access_level));

drop policy if exists "step_tools workspace read" on step_tools;
create policy "step_tools workspace read" on step_tools
for select to authenticated
using (public.has_project_access(public.task_project_id(task_id), 'view'::access_level));

drop policy if exists "step_tools workspace insert" on step_tools;
create policy "step_tools workspace insert" on step_tools
for insert to authenticated
with check (public.has_project_access(public.task_project_id(task_id), 'edit'::access_level));

drop policy if exists "step_tools workspace update" on step_tools;
create policy "step_tools workspace update" on step_tools
for update to authenticated
using (public.has_project_access(public.task_project_id(task_id), 'edit'::access_level))
with check (public.has_project_access(public.task_project_id(task_id), 'edit'::access_level));

drop policy if exists "step_tools workspace delete" on step_tools;
create policy "step_tools workspace delete" on step_tools
for delete to authenticated
using (public.has_project_access(public.task_project_id(task_id), 'edit'::access_level));

-- ===========================================================================
-- custom_columns (resolve project via product_id or scenario_id).
-- ===========================================================================
drop policy if exists "custom_columns workspace read" on custom_columns;
create policy "custom_columns workspace read" on custom_columns
for select to authenticated
using (public.has_project_access(public.custom_column_project_id(product_id, scenario_id), 'view'::access_level));

drop policy if exists "custom_columns workspace insert" on custom_columns;
create policy "custom_columns workspace insert" on custom_columns
for insert to authenticated
with check (public.has_project_access(public.custom_column_project_id(product_id, scenario_id), 'edit'::access_level));

drop policy if exists "custom_columns workspace update" on custom_columns;
create policy "custom_columns workspace update" on custom_columns
for update to authenticated
using (public.has_project_access(public.custom_column_project_id(product_id, scenario_id), 'edit'::access_level))
with check (public.has_project_access(public.custom_column_project_id(product_id, scenario_id), 'edit'::access_level));

drop policy if exists "custom_columns workspace delete" on custom_columns;
create policy "custom_columns workspace delete" on custom_columns
for delete to authenticated
using (public.has_project_access(public.custom_column_project_id(product_id, scenario_id), 'edit'::access_level));

-- ---------------------------------------------------------------------------
-- Residual, intentionally-left gaps (documented, not closed here):
--   * step-photo STORAGE objects stay workspace-keyed: the storage path is
--     step-photos/<workspace_id>/... with no project or task id to resolve a project from,
--     so object-level RLS can't be scoped per-project without a path/schema change. The
--     step_photos TABLE (metadata + signed-url issuance happens app-side) is now scoped.
--   * project creation remains manager-gated (projects insert = owner/admin/editor, and the
--     creator self-grant is manager-only), so non-managers cannot seed new projects.
-- ---------------------------------------------------------------------------
