-- SolidWorks exploded-view attachments for manufacturing steps. Mirrors step_photos (same shape,
-- triggers, indexes, MVP anon RLS, and realtime registration) with extra columns carrying the
-- SolidWorks provenance: the source file, the explode configuration, the frame index within a
-- step-by-step explode, and the part numbers visible in the frame.

create table if not exists step_exploded_views (
  id text primary key default gen_random_uuid()::text,
  task_id text not null references tasks(id) on delete cascade,
  step_id text not null references manufacturing_steps(id) on delete cascade,
  storage_path text not null,
  public_url text not null,
  thumbnail_url text,
  thumbnail_storage_path text,
  file_name text not null default 'Exploded view',
  mime_type text,
  size_bytes integer,
  width integer,
  height integer,
  caption text,
  -- SolidWorks provenance:
  solidworks_file_path text,
  config_name text,
  frame_number integer,
  components text[],
  captured_at timestamptz not null default now(),
  uploaded_by text,
  deleted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (size_bytes is null or size_bytes >= 0),
  check (width is null or width >= 0),
  check (height is null or height >= 0),
  check (frame_number is null or frame_number >= 0)
);

drop trigger if exists step_exploded_views_set_updated_at on step_exploded_views;
create trigger step_exploded_views_set_updated_at
before update on step_exploded_views
for each row execute function set_updated_at();

create index if not exists step_exploded_views_task_id_idx on step_exploded_views(task_id);
create index if not exists step_exploded_views_step_id_idx on step_exploded_views(step_id);
create index if not exists step_exploded_views_deleted_at_idx on step_exploded_views(deleted_at);
create unique index if not exists step_exploded_views_storage_path_idx on step_exploded_views(storage_path);
create unique index if not exists step_exploded_views_task_step_id_idx on step_exploded_views(task_id, step_id, id);
create unique index if not exists step_exploded_views_thumbnail_storage_path_idx
on step_exploded_views(thumbnail_storage_path)
where thumbnail_storage_path is not null;

alter table step_exploded_views enable row level security;

drop policy if exists "mvp anon read step_exploded_views" on step_exploded_views;
drop policy if exists "mvp anon insert step_exploded_views" on step_exploded_views;
drop policy if exists "mvp anon update step_exploded_views" on step_exploded_views;
drop policy if exists "mvp anon delete step_exploded_views" on step_exploded_views;

create policy "mvp anon read step_exploded_views" on step_exploded_views for select to anon using (true);
create policy "mvp anon insert step_exploded_views" on step_exploded_views for insert to anon with check (true);
create policy "mvp anon update step_exploded_views" on step_exploded_views for update to anon using (true) with check (true);
create policy "mvp anon delete step_exploded_views" on step_exploded_views for delete to anon using (true);

-- Realtime: full row on change (so DELETE payloads carry task_id) + add to the publication.
do $$
begin
  execute 'alter table public.step_exploded_views replica identity full';

  begin
    execute 'alter publication supabase_realtime add table public.step_exploded_views';
  exception
    when duplicate_object then
      null;
    when undefined_object then
      null;
  end;
end $$;

-- NOTE: exploded-view images reuse the existing `step-photos` storage bucket (under an
-- `exploded/` path segment), so no new bucket or storage policies are needed here. The
-- separate table above is what keeps exploded views distinct from photos.
