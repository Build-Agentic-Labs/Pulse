-- SOP audit 2026-07-02: document-control groundwork + task linking.
--
--   * lifecycle status (draft/in_review/approved/obsolete) -- existing rows stay 'draft'
--   * soft delete (deleted_at) so a misclick can't destroy a controlled document; the
--     hard-delete policy tightens to workspace managers (the 20260608120000 comment said
--     "tighten when Document Control lands" -- this is that change)
--   * updated_by attribution alongside created_by (which app code stops overwriting)
--   * uniqueness for sop_number per workspace (live data verified duplicate-free)
--   * tasks.sop_id -- a real FK replacing free-text-URL-only SOP references

alter table public.sops
  add column if not exists status text not null default 'draft',
  add column if not exists deleted_at timestamptz,
  add column if not exists updated_by uuid references auth.users(id);

alter table public.sops drop constraint if exists sops_status_check;
alter table public.sops add constraint sops_status_check
  check (status in ('draft', 'in_review', 'approved', 'obsolete'));

create unique index if not exists sops_workspace_number_unique_idx
  on public.sops (workspace_id, lower(btrim(sop_number)))
  where sop_number is not null and btrim(sop_number) <> '' and deleted_at is null;

create index if not exists sops_deleted_at_idx on public.sops (deleted_at);

-- Soft delete is an UPDATE (org-tools edit level, recoverable); hard delete is manager-only.
drop policy if exists "sops workspace delete" on public.sops;
create policy "sops workspace delete" on public.sops
for delete to authenticated
using (public.has_workspace_role(workspace_id, array['owner', 'admin']::workspace_role[]));

-- Task -> SOP link. The free-text sopLink URL field stays for external documents; this FK
-- is for SOPs managed inside Pulse. on delete set null: removing an SOP must never block
-- on (or cascade into) production planning rows.
alter table public.tasks
  add column if not exists sop_id text references public.sops(id) on delete set null;

create index if not exists tasks_sop_id_idx on public.tasks(sop_id);
