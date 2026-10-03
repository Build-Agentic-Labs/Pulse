drop policy "awi author create" on public.awi_masters;
create policy "awi author create" on public.awi_masters for insert to authenticated
with check (public.has_project_access(project_id, 'edit'::public.access_level)
  and published_at is null and published_release_id is null
  and public.task_project_id(task_id) = project_id
  and exists (select 1 from public.projects p where p.id=awi_masters.project_id and p.workspace_id=awi_masters.workspace_id and p.is_awi_master));
