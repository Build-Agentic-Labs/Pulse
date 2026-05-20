create or replace function bump_row_version()
returns trigger
language plpgsql
as $$
begin
  if new.version is null or new.version = old.version then
    new.version = old.version + 1;
  end if;
  return new;
end;
$$;

alter table tasks
add column if not exists version integer not null default 1;

alter table manufacturing_steps
add column if not exists version integer not null default 1;

drop trigger if exists tasks_bump_version on tasks;
create trigger tasks_bump_version
before update on tasks
for each row execute function bump_row_version();

drop trigger if exists manufacturing_steps_bump_version on manufacturing_steps;
create trigger manufacturing_steps_bump_version
before update on manufacturing_steps
for each row execute function bump_row_version();

create table if not exists step_photos (
  id text primary key default gen_random_uuid()::text,
  task_id text not null references tasks(id) on delete cascade,
  step_id text not null references manufacturing_steps(id) on delete cascade,
  storage_path text not null,
  public_url text not null,
  file_name text not null default 'Step photo',
  mime_type text,
  size_bytes integer,
  width integer,
  height integer,
  caption text,
  captured_at timestamptz not null default now(),
  uploaded_by text,
  deleted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (size_bytes is null or size_bytes >= 0),
  check (width is null or width >= 0),
  check (height is null or height >= 0)
);

create table if not exists step_tools (
  id text primary key default gen_random_uuid()::text,
  task_id text not null references tasks(id) on delete cascade,
  step_id text not null references manufacturing_steps(id) on delete cascade,
  tool_name text not null,
  sequence integer not null default 1 check (sequence > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

drop trigger if exists step_photos_set_updated_at on step_photos;
create trigger step_photos_set_updated_at
before update on step_photos
for each row execute function set_updated_at();

drop trigger if exists step_tools_set_updated_at on step_tools;
create trigger step_tools_set_updated_at
before update on step_tools
for each row execute function set_updated_at();

create index if not exists step_photos_task_id_idx on step_photos(task_id);
create index if not exists step_photos_step_id_idx on step_photos(step_id);
create index if not exists step_photos_deleted_at_idx on step_photos(deleted_at);
create unique index if not exists step_photos_storage_path_idx on step_photos(storage_path);
create unique index if not exists step_photos_task_step_id_idx on step_photos(task_id, step_id, id);

create index if not exists step_tools_task_id_idx on step_tools(task_id);
create index if not exists step_tools_step_id_sequence_idx on step_tools(step_id, sequence);
create unique index if not exists step_tools_step_tool_name_idx on step_tools(step_id, lower(tool_name));

alter table step_photos enable row level security;
alter table step_tools enable row level security;

drop policy if exists "mvp anon read step_photos" on step_photos;
drop policy if exists "mvp anon insert step_photos" on step_photos;
drop policy if exists "mvp anon update step_photos" on step_photos;
drop policy if exists "mvp anon delete step_photos" on step_photos;

create policy "mvp anon read step_photos" on step_photos for select to anon using (true);
create policy "mvp anon insert step_photos" on step_photos for insert to anon with check (true);
create policy "mvp anon update step_photos" on step_photos for update to anon using (true) with check (true);
create policy "mvp anon delete step_photos" on step_photos for delete to anon using (true);

drop policy if exists "mvp anon read step_tools" on step_tools;
drop policy if exists "mvp anon insert step_tools" on step_tools;
drop policy if exists "mvp anon update step_tools" on step_tools;
drop policy if exists "mvp anon delete step_tools" on step_tools;

create policy "mvp anon read step_tools" on step_tools for select to anon using (true);
create policy "mvp anon insert step_tools" on step_tools for insert to anon with check (true);
create policy "mvp anon update step_tools" on step_tools for update to anon using (true) with check (true);
create policy "mvp anon delete step_tools" on step_tools for delete to anon using (true);

do $$
declare
  table_name text;
begin
  foreach table_name in array array['step_photos', 'step_tools']
  loop
    execute format('alter table public.%I replica identity full', table_name);

    begin
      execute format('alter publication supabase_realtime add table public.%I', table_name);
    exception
      when duplicate_object then
        null;
      when undefined_object then
        null;
    end;
  end loop;
end $$;
