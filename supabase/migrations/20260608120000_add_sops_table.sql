-- SOPs move from browser localStorage to Postgres, scoped to a workspace (SOPs are
-- org-wide, not per-project) and gated by the existing RLS/role model. The SOP body is
-- stored as a single jsonb `document` (the editor saves the whole Sop atomically while the
-- model is still settling); a handful of promoted columns mirror fields off the document for
-- cheap listing/search and future document-control without reshaping the body.

create table if not exists public.sops (
  id            text primary key,
  workspace_id  text not null references public.workspaces(id) on delete cascade,
  sop_number    text,
  title         text,
  version       text,
  source        text,
  document      jsonb not null,
  created_by    uuid references auth.users(id),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create index if not exists sops_workspace_id_idx on public.sops (workspace_id);

drop trigger if exists sops_set_updated_at on public.sops;
create trigger sops_set_updated_at
before update on public.sops
for each row execute function set_updated_at();

alter table public.sops enable row level security;

-- workspace_id is a direct column, so the policies call has_workspace_role on it directly
-- (no resolver function). Mirrors the canonical workspace-scoped pattern used by projects.
drop policy if exists "sops workspace read" on public.sops;
drop policy if exists "sops workspace insert" on public.sops;
drop policy if exists "sops workspace update" on public.sops;
drop policy if exists "sops workspace delete" on public.sops;
create policy "sops workspace read" on public.sops
for select to authenticated
using (public.has_workspace_role(workspace_id, array['owner', 'admin', 'editor', 'viewer']::workspace_role[]));
create policy "sops workspace insert" on public.sops
for insert to authenticated
with check (public.has_workspace_role(workspace_id, array['owner', 'admin', 'editor']::workspace_role[]));
create policy "sops workspace update" on public.sops
for update to authenticated
using (public.has_workspace_role(workspace_id, array['owner', 'admin', 'editor']::workspace_role[]))
with check (public.has_workspace_role(workspace_id, array['owner', 'admin', 'editor']::workspace_role[]));
-- Editor can delete for parity with the prototype's "anyone can delete". Tighten to
-- array['owner', 'admin'] when Document Control lands.
create policy "sops workspace delete" on public.sops
for delete to authenticated
using (public.has_workspace_role(workspace_id, array['owner', 'admin', 'editor']::workspace_role[]));
