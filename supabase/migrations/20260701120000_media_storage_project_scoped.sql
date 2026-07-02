-- Audit 2026-07-01 remediation (#1, #2, #3, M4): media storage becomes private and
-- per-project, matching the table-level RLS model from 20260601124000.
--
--   1. task-videos bucket goes private (same fix 20260525233000 applied to step-photos;
--      the app already signs every video URL, so nothing depends on public access).
--   2. Object policies on BOTH buckets move from workspace-role gating to
--      has_project_access() resolved from the path (workspaces/<ws>/projects/<proj>/...),
--      closing the gap where a member with project_access = 'none' could still read or
--      write another project's files. The 20260601124000 note claiming paths carry no
--      project id has been stale since 20260525233000 — every write path is project-keyed.
--   3. The task-videos read/delete "name not like 'workspaces/%'" allow-branches are
--      dropped: un-scoped paths are now unreadable/undeletable instead of open to every
--      authenticated user.
--   4. Deletes are gated on project 'edit' (was owner/admin), so the app's delete flows
--      can remove the object together with the row for project editors too.
--
-- Legacy flat-path step-photo objects (pre-20260525233000) stay reachable through the
-- row-lookup fallback branches, now resolved to project level via task_project_id().

update storage.buckets
set public = false
where id = 'task-videos';

-- ============================== step-photos ==============================

drop policy if exists "workspace scoped step photo uploads" on storage.objects;
create policy "workspace scoped step photo uploads"
on storage.objects for insert to authenticated
with check (
  bucket_id = 'step-photos'
  and name like 'workspaces/%/projects/%'
  and (storage.foldername(name))[1] = 'workspaces'
  and (storage.foldername(name))[3] = 'projects'
  and public.project_workspace_id((storage.foldername(name))[4]) = (storage.foldername(name))[2]
  and public.has_project_access((storage.foldername(name))[4], 'edit'::access_level)
);

drop policy if exists "workspace scoped step photo reads" on storage.objects;
create policy "workspace scoped step photo reads"
on storage.objects for select to authenticated
using (
  bucket_id = 'step-photos'
  and (
    (
      name like 'workspaces/%/projects/%'
      and (storage.foldername(name))[1] = 'workspaces'
      and public.has_project_access((storage.foldername(name))[4], 'view'::access_level)
    )
    or exists (
      select 1
      from public.step_photos sp
      where sp.deleted_at is null
        and (sp.storage_path = storage.objects.name or sp.thumbnail_storage_path = storage.objects.name)
        and public.has_project_access(public.task_project_id(sp.task_id), 'view'::access_level)
    )
    or exists (
      select 1
      from public.tool_library tl
      where tl.storage_path = storage.objects.name
        and public.has_project_access(tl.project_id, 'view'::access_level)
    )
  )
);

drop policy if exists "workspace scoped step photo updates" on storage.objects;
create policy "workspace scoped step photo updates"
on storage.objects for update to authenticated
using (
  bucket_id = 'step-photos'
  and (
    (
      name like 'workspaces/%/projects/%'
      and (storage.foldername(name))[1] = 'workspaces'
      and public.has_project_access((storage.foldername(name))[4], 'edit'::access_level)
    )
    or exists (
      select 1
      from public.step_photos sp
      where (sp.storage_path = storage.objects.name or sp.thumbnail_storage_path = storage.objects.name)
        and public.has_project_access(public.task_project_id(sp.task_id), 'edit'::access_level)
    )
    or exists (
      select 1
      from public.tool_library tl
      where tl.storage_path = storage.objects.name
        and public.has_project_access(tl.project_id, 'edit'::access_level)
    )
  )
)
with check (
  bucket_id = 'step-photos'
  and name like 'workspaces/%/projects/%'
  and (storage.foldername(name))[1] = 'workspaces'
  and public.has_project_access((storage.foldername(name))[4], 'edit'::access_level)
);

drop policy if exists "workspace scoped step photo deletes" on storage.objects;
create policy "workspace scoped step photo deletes"
on storage.objects for delete to authenticated
using (
  bucket_id = 'step-photos'
  and (
    (
      name like 'workspaces/%/projects/%'
      and (storage.foldername(name))[1] = 'workspaces'
      and public.has_project_access((storage.foldername(name))[4], 'edit'::access_level)
    )
    or exists (
      select 1
      from public.step_photos sp
      where (sp.storage_path = storage.objects.name or sp.thumbnail_storage_path = storage.objects.name)
        and public.has_project_access(public.task_project_id(sp.task_id), 'edit'::access_level)
    )
    or exists (
      select 1
      from public.tool_library tl
      where tl.storage_path = storage.objects.name
        and public.has_project_access(tl.project_id, 'edit'::access_level)
    )
  )
);

-- tool_library table read follows the same per-project model as its images (M4).
drop policy if exists "tool_library workspace read" on tool_library;
create policy "tool_library workspace read" on tool_library
for select to authenticated
using (public.has_project_access(project_id, 'view'::access_level));

-- ============================== task-videos ==============================
-- Rebuilt without the "name not like 'workspaces/%'" allow-branches: the upload policy
-- has only ever admitted workspaces/<ws>/projects/<proj>/ paths, so nothing legitimate
-- lives outside that tree.

drop policy if exists "task video uploads" on storage.objects;
create policy "task video uploads"
on storage.objects for insert to authenticated
with check (
  bucket_id = 'task-videos'
  and name like 'workspaces/%/projects/%'
  and (storage.foldername(name))[1] = 'workspaces'
  and (storage.foldername(name))[3] = 'projects'
  and public.project_workspace_id((storage.foldername(name))[4]) = (storage.foldername(name))[2]
  and public.has_project_access((storage.foldername(name))[4], 'edit'::access_level)
);

drop policy if exists "task video reads" on storage.objects;
create policy "task video reads"
on storage.objects for select to authenticated
using (
  bucket_id = 'task-videos'
  and name like 'workspaces/%/projects/%'
  and (storage.foldername(name))[1] = 'workspaces'
  and public.has_project_access((storage.foldername(name))[4], 'view'::access_level)
);

drop policy if exists "task video deletes" on storage.objects;
create policy "task video deletes"
on storage.objects for delete to authenticated
using (
  bucket_id = 'task-videos'
  and name like 'workspaces/%/projects/%'
  and (storage.foldername(name))[1] = 'workspaces'
  and public.has_project_access((storage.foldername(name))[4], 'edit'::access_level)
);
