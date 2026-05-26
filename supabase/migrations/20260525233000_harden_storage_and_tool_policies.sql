-- Harden photo/tool storage without deleting existing objects or rows.

update storage.buckets
set public = false
where id = 'step-photos';

drop policy if exists "workspace scoped step photo uploads" on storage.objects;
drop policy if exists "authenticated step photo reads" on storage.objects;
drop policy if exists "authenticated step photo updates" on storage.objects;
drop policy if exists "authenticated step photo deletes" on storage.objects;

create policy "workspace scoped step photo uploads"
on storage.objects for insert to authenticated
with check (
  bucket_id = 'step-photos'
  and name like 'workspaces/%/projects/%'
  and (storage.foldername(name))[1] = 'workspaces'
  and (storage.foldername(name))[3] = 'projects'
  and public.project_workspace_id((storage.foldername(name))[4]) = (storage.foldername(name))[2]
  and public.has_workspace_role((storage.foldername(name))[2], array['owner', 'admin', 'editor']::workspace_role[])
);

create policy "workspace scoped step photo reads"
on storage.objects for select to authenticated
using (
  bucket_id = 'step-photos'
  and (
    (
      name like 'workspaces/%/projects/%'
      and (storage.foldername(name))[1] = 'workspaces'
      and public.has_workspace_role((storage.foldername(name))[2], array['owner', 'admin', 'editor', 'viewer']::workspace_role[])
    )
    or exists (
      select 1
      from public.step_photos sp
      where sp.deleted_at is null
        and (sp.storage_path = storage.objects.name or sp.thumbnail_storage_path = storage.objects.name)
        and public.has_workspace_role(public.task_workspace_id(sp.task_id), array['owner', 'admin', 'editor', 'viewer']::workspace_role[])
    )
    or exists (
      select 1
      from public.tool_library tl
      where tl.storage_path = storage.objects.name
        and (
          tl.project_id is null
          or public.has_workspace_role(public.project_workspace_id(tl.project_id), array['owner', 'admin', 'editor', 'viewer']::workspace_role[])
        )
    )
  )
);

create policy "workspace scoped step photo updates"
on storage.objects for update to authenticated
using (
  bucket_id = 'step-photos'
  and (
    (
      name like 'workspaces/%/projects/%'
      and (storage.foldername(name))[1] = 'workspaces'
      and public.has_workspace_role((storage.foldername(name))[2], array['owner', 'admin', 'editor']::workspace_role[])
    )
    or exists (
      select 1
      from public.step_photos sp
      where (sp.storage_path = storage.objects.name or sp.thumbnail_storage_path = storage.objects.name)
        and public.has_workspace_role(public.task_workspace_id(sp.task_id), array['owner', 'admin', 'editor']::workspace_role[])
    )
    or exists (
      select 1
      from public.tool_library tl
      where tl.storage_path = storage.objects.name
        and tl.project_id is not null
        and public.has_workspace_role(public.project_workspace_id(tl.project_id), array['owner', 'admin', 'editor']::workspace_role[])
    )
  )
)
with check (
  bucket_id = 'step-photos'
  and name like 'workspaces/%/projects/%'
  and (storage.foldername(name))[1] = 'workspaces'
  and public.has_workspace_role((storage.foldername(name))[2], array['owner', 'admin', 'editor']::workspace_role[])
);

create policy "workspace scoped step photo deletes"
on storage.objects for delete to authenticated
using (
  bucket_id = 'step-photos'
  and (
    (
      name like 'workspaces/%/projects/%'
      and (storage.foldername(name))[1] = 'workspaces'
      and public.has_workspace_role((storage.foldername(name))[2], array['owner', 'admin']::workspace_role[])
    )
    or exists (
      select 1
      from public.step_photos sp
      where (sp.storage_path = storage.objects.name or sp.thumbnail_storage_path = storage.objects.name)
        and public.has_workspace_role(public.task_workspace_id(sp.task_id), array['owner', 'admin']::workspace_role[])
    )
    or exists (
      select 1
      from public.tool_library tl
      where tl.storage_path = storage.objects.name
        and tl.project_id is not null
        and public.has_workspace_role(public.project_workspace_id(tl.project_id), array['owner', 'admin']::workspace_role[])
    )
  )
);

drop policy if exists "tool_library workspace read" on tool_library;
drop policy if exists "tool_library workspace insert" on tool_library;
drop policy if exists "tool_library workspace update" on tool_library;
drop policy if exists "tool_library workspace delete" on tool_library;

create policy "tool_library workspace read" on tool_library
for select to authenticated
using (
  project_id is null
  or public.has_workspace_role(
    public.project_workspace_id(project_id),
    array['owner', 'admin', 'editor', 'viewer']::workspace_role[]
  )
);

create policy "tool_library workspace insert" on tool_library
for insert to authenticated
with check (
  project_id is not null
  and public.has_workspace_role(
    public.project_workspace_id(project_id),
    array['owner', 'admin', 'editor']::workspace_role[]
  )
);

create policy "tool_library workspace update" on tool_library
for update to authenticated
using (
  project_id is not null
  and public.has_workspace_role(
    public.project_workspace_id(project_id),
    array['owner', 'admin', 'editor']::workspace_role[]
  )
)
with check (
  project_id is not null
  and public.has_workspace_role(
    public.project_workspace_id(project_id),
    array['owner', 'admin', 'editor']::workspace_role[]
  )
);

create policy "tool_library workspace delete" on tool_library
for delete to authenticated
using (
  project_id is not null
  and public.has_workspace_role(
    public.project_workspace_id(project_id),
    array['owner', 'admin']::workspace_role[]
  )
);
