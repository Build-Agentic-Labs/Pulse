create table if not exists tool_library (
  id text primary key default gen_random_uuid()::text,
  project_id text references projects(id) on delete cascade,
  tool_name text not null,
  image_url text,
  storage_path text,
  category text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

drop trigger if exists tool_library_set_updated_at on tool_library;
create trigger tool_library_set_updated_at
before update on tool_library
for each row execute function set_updated_at();

create index if not exists tool_library_project_id_idx on tool_library(project_id);
create unique index if not exists tool_library_project_tool_name_idx on tool_library(coalesce(project_id, ''), lower(tool_name));

alter table tool_library enable row level security;

drop policy if exists "mvp anon read tool_library" on tool_library;
drop policy if exists "mvp anon insert tool_library" on tool_library;
drop policy if exists "mvp anon update tool_library" on tool_library;
drop policy if exists "mvp anon delete tool_library" on tool_library;

create policy "mvp anon read tool_library" on tool_library for select to anon using (true);
create policy "mvp anon insert tool_library" on tool_library for insert to anon with check (true);
create policy "mvp anon update tool_library" on tool_library for update to anon using (true) with check (true);
create policy "mvp anon delete tool_library" on tool_library for delete to anon using (true);

do $$
begin
  execute 'alter table public.tool_library replica identity full';

  begin
    execute 'alter publication supabase_realtime add table public.tool_library';
  exception
    when duplicate_object then
      null;
    when undefined_object then
      null;
  end;
end $$;
