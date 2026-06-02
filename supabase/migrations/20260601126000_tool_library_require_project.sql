-- Remove "global" tools entirely: every tool_library row must belong to a project.
--
-- Background: tool_library.project_id was nullable, where NULL meant an org-wide "global" tool.
-- That created two problems the audit flagged:
--   1. Read leak: the read policy allowed `project_id is null` for ANY authenticated user, so
--      global tools (names, categories, image storage paths) were visible to users in no
--      workspace / other tenants.
--   2. Broken writes: the 20260525233000 hardening blocked all global-tool inserts, so the
--      app's project-less upload/upsert paths failed at runtime.
--
-- Decision: drop the global concept. Every tool belongs to a project; access follows the
-- project's workspace. tool_library is empty in production (0 rows), so adding NOT NULL is a
-- zero-row, non-destructive change. The insert/update/delete policies already require
-- project_id is not null, so they are correct as-is once the column is mandatory.

alter table tool_library
  alter column project_id set not null;

-- Read policy: drop the `project_id is null` leak branch. A project tool is readable by any
-- member (incl. viewer) of the project's workspace.
drop policy if exists "tool_library workspace read" on tool_library;
create policy "tool_library workspace read" on tool_library
for select to authenticated
using (
  public.has_workspace_role(
    public.project_workspace_id(project_id),
    array['owner', 'admin', 'editor', 'viewer']::workspace_role[]
  )
);

-- Storage read policy: rebuild identically to 20260525233000 EXCEPT the tool_library branch no
-- longer admits `tl.project_id is null` (that object class no longer exists). Project tool
-- images stay readable by workspace members; the step-photo and workspace-path branches are
-- unchanged.
drop policy if exists "workspace scoped step photo reads" on storage.objects;
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
        and public.has_workspace_role(public.project_workspace_id(tl.project_id), array['owner', 'admin', 'editor', 'viewer']::workspace_role[])
    )
  )
);
