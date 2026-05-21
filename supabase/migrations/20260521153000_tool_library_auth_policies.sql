-- Authenticated workspace access for tool_library (replacing anon-only MVP policies).

drop policy if exists "mvp anon read tool_library" on tool_library;
drop policy if exists "mvp anon insert tool_library" on tool_library;
drop policy if exists "mvp anon update tool_library" on tool_library;
drop policy if exists "mvp anon delete tool_library" on tool_library;

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
  project_id is null
  or public.has_workspace_role(
    public.project_workspace_id(project_id),
    array['owner', 'admin', 'editor']::workspace_role[]
  )
);

create policy "tool_library workspace update" on tool_library
for update to authenticated
using (
  project_id is null
  or public.has_workspace_role(
    public.project_workspace_id(project_id),
    array['owner', 'admin', 'editor']::workspace_role[]
  )
)
with check (
  project_id is null
  or public.has_workspace_role(
    public.project_workspace_id(project_id),
    array['owner', 'admin', 'editor']::workspace_role[]
  )
);

create policy "tool_library workspace delete" on tool_library
for delete to authenticated
using (
  project_id is null
  or public.has_workspace_role(
    public.project_workspace_id(project_id),
    array['owner', 'admin']::workspace_role[]
  )
);
