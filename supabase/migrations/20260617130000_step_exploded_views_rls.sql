-- Replace the placeholder MVP-anon policies on step_exploded_views (from 20260617120000) with the
-- authenticated, per-project RLS the rest of the schema uses (mirrors the step_photos policies set in
-- 20260601124000_per_project_rls_isolation). Reads require 'view' access to the owning task's project;
-- writes require 'edit'. The anon server role is intentionally no longer granted any access.

drop policy if exists "mvp anon read step_exploded_views" on step_exploded_views;
drop policy if exists "mvp anon insert step_exploded_views" on step_exploded_views;
drop policy if exists "mvp anon update step_exploded_views" on step_exploded_views;
drop policy if exists "mvp anon delete step_exploded_views" on step_exploded_views;

drop policy if exists "step_exploded_views workspace read" on step_exploded_views;
create policy "step_exploded_views workspace read" on step_exploded_views
for select to authenticated
using (public.has_project_access(public.task_project_id(task_id), 'view'::access_level));

drop policy if exists "step_exploded_views workspace insert" on step_exploded_views;
create policy "step_exploded_views workspace insert" on step_exploded_views
for insert to authenticated
with check (public.has_project_access(public.task_project_id(task_id), 'edit'::access_level));

drop policy if exists "step_exploded_views workspace update" on step_exploded_views;
create policy "step_exploded_views workspace update" on step_exploded_views
for update to authenticated
using (public.has_project_access(public.task_project_id(task_id), 'edit'::access_level))
with check (public.has_project_access(public.task_project_id(task_id), 'edit'::access_level));

drop policy if exists "step_exploded_views workspace delete" on step_exploded_views;
create policy "step_exploded_views workspace delete" on step_exploded_views
for delete to authenticated
using (public.has_project_access(public.task_project_id(task_id), 'edit'::access_level));
