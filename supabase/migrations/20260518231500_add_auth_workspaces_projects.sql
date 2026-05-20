do $$
begin
  create type workspace_role as enum ('owner', 'admin', 'editor', 'viewer');
exception when duplicate_object then null;
end $$;

do $$
begin
  create type project_status as enum ('active', 'archived');
exception when duplicate_object then null;
end $$;

create table if not exists profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text,
  avatar_url text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists workspaces (
  id text primary key default gen_random_uuid()::text,
  name text not null,
  owner_id uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists workspace_members (
  workspace_id text not null references workspaces(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role workspace_role not null default 'editor',
  created_at timestamptz not null default now(),
  primary key (workspace_id, user_id)
);

create table if not exists projects (
  id text primary key default gen_random_uuid()::text,
  workspace_id text not null references workspaces(id) on delete cascade,
  name text not null,
  description text,
  status project_status not null default 'active',
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table products add column if not exists project_id text references projects(id) on delete set null;

insert into workspaces (id, name, owner_id)
values ('workspace-default', 'BuildLogic Workspace', null)
on conflict (id) do update
set name = excluded.name;

insert into projects (id, workspace_id, name, description, status, created_by)
values (
  'project-flexboost',
  'workspace-default',
  'FlexBoost',
  'Backfilled project for the existing FlexBoost line planner data.',
  'active',
  null
)
on conflict (id) do update
set
  workspace_id = excluded.workspace_id,
  name = excluded.name,
  description = excluded.description,
  status = excluded.status;

update products
set project_id = 'project-flexboost'
where project_id is null;

drop trigger if exists profiles_set_updated_at on profiles;
create trigger profiles_set_updated_at
before update on profiles
for each row execute function set_updated_at();

drop trigger if exists workspaces_set_updated_at on workspaces;
create trigger workspaces_set_updated_at
before update on workspaces
for each row execute function set_updated_at();

drop trigger if exists projects_set_updated_at on projects;
create trigger projects_set_updated_at
before update on projects
for each row execute function set_updated_at();

create index if not exists workspace_members_user_id_idx on workspace_members(user_id);
create index if not exists projects_workspace_id_idx on projects(workspace_id);
create index if not exists products_project_id_idx on products(project_id);

create or replace function public.handle_new_user_profile()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, full_name, avatar_url)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'full_name', new.email),
    new.raw_user_meta_data->>'avatar_url'
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created_buildlogic_profile on auth.users;
create trigger on_auth_user_created_buildlogic_profile
after insert on auth.users
for each row execute function public.handle_new_user_profile();

create or replace function public.workspace_has_members(target_workspace_id text)
returns boolean
language sql
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.workspace_members wm
    where wm.workspace_id = target_workspace_id
  );
$$;

create or replace function public.has_workspace_role(target_workspace_id text, allowed_roles workspace_role[])
returns boolean
language sql
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.workspace_members wm
    where wm.workspace_id = target_workspace_id
      and wm.user_id = auth.uid()
      and wm.role = any(allowed_roles)
  );
$$;

create or replace function public.project_workspace_id(target_project_id text)
returns text
language sql
security definer
set search_path = public
as $$
  select p.workspace_id
  from public.projects p
  where p.id = target_project_id;
$$;

create or replace function public.product_workspace_id(target_product_id text)
returns text
language sql
security definer
set search_path = public
as $$
  select p.workspace_id
  from public.products pr
  join public.projects p on p.id = pr.project_id
  where pr.id = target_product_id;
$$;

create or replace function public.scenario_workspace_id(target_scenario_id text)
returns text
language sql
security definer
set search_path = public
as $$
  select public.product_workspace_id(s.product_id)
  from public.scenarios s
  where s.id = target_scenario_id;
$$;

create or replace function public.task_workspace_id(target_task_id text)
returns text
language sql
security definer
set search_path = public
as $$
  select public.scenario_workspace_id(t.scenario_id)
  from public.tasks t
  where t.id = target_task_id;
$$;

create or replace function public.custom_column_workspace_id(target_product_id text, target_scenario_id text)
returns text
language sql
security definer
set search_path = public
as $$
  select coalesce(
    case when target_product_id is not null then public.product_workspace_id(target_product_id) end,
    case when target_scenario_id is not null then public.scenario_workspace_id(target_scenario_id) end
  );
$$;

alter table profiles enable row level security;
alter table workspaces enable row level security;
alter table workspace_members enable row level security;
alter table projects enable row level security;

drop policy if exists "profiles own read" on profiles;
drop policy if exists "profiles own insert" on profiles;
drop policy if exists "profiles own update" on profiles;
create policy "profiles own read" on profiles for select to authenticated using (id = auth.uid());
create policy "profiles own insert" on profiles for insert to authenticated with check (id = auth.uid());
create policy "profiles own update" on profiles for update to authenticated using (id = auth.uid()) with check (id = auth.uid());

drop policy if exists "workspaces member read" on workspaces;
drop policy if exists "workspaces authenticated insert" on workspaces;
drop policy if exists "workspaces admin update" on workspaces;
drop policy if exists "workspaces owner delete" on workspaces;
create policy "workspaces member read" on workspaces
for select to authenticated
using (
  public.has_workspace_role(id, array['owner', 'admin', 'editor', 'viewer']::workspace_role[])
  or not public.workspace_has_members(id)
);
create policy "workspaces authenticated insert" on workspaces
for insert to authenticated
with check (owner_id = auth.uid() or owner_id is null);
create policy "workspaces admin update" on workspaces
for update to authenticated
using (public.has_workspace_role(id, array['owner', 'admin']::workspace_role[]))
with check (public.has_workspace_role(id, array['owner', 'admin']::workspace_role[]));
create policy "workspaces owner delete" on workspaces
for delete to authenticated
using (public.has_workspace_role(id, array['owner']::workspace_role[]));

drop policy if exists "workspace_members member read" on workspace_members;
drop policy if exists "workspace_members bootstrap or admin insert" on workspace_members;
drop policy if exists "workspace_members admin update" on workspace_members;
drop policy if exists "workspace_members owner delete" on workspace_members;
create policy "workspace_members member read" on workspace_members
for select to authenticated
using (
  user_id = auth.uid()
  or public.has_workspace_role(workspace_id, array['owner', 'admin']::workspace_role[])
  or not public.workspace_has_members(workspace_id)
);
create policy "workspace_members bootstrap or admin insert" on workspace_members
for insert to authenticated
with check (
  (
    user_id = auth.uid()
    and role = 'owner'
    and not public.workspace_has_members(workspace_id)
  )
  or public.has_workspace_role(workspace_id, array['owner', 'admin']::workspace_role[])
);
create policy "workspace_members admin update" on workspace_members
for update to authenticated
using (public.has_workspace_role(workspace_id, array['owner', 'admin']::workspace_role[]))
with check (public.has_workspace_role(workspace_id, array['owner', 'admin']::workspace_role[]));
create policy "workspace_members owner delete" on workspace_members
for delete to authenticated
using (public.has_workspace_role(workspace_id, array['owner']::workspace_role[]));

drop policy if exists "projects member read" on projects;
drop policy if exists "projects editor insert" on projects;
drop policy if exists "projects editor update" on projects;
drop policy if exists "projects admin delete" on projects;
create policy "projects member read" on projects
for select to authenticated
using (public.has_workspace_role(workspace_id, array['owner', 'admin', 'editor', 'viewer']::workspace_role[]));
create policy "projects editor insert" on projects
for insert to authenticated
with check (public.has_workspace_role(workspace_id, array['owner', 'admin', 'editor']::workspace_role[]));
create policy "projects editor update" on projects
for update to authenticated
using (public.has_workspace_role(workspace_id, array['owner', 'admin', 'editor']::workspace_role[]))
with check (public.has_workspace_role(workspace_id, array['owner', 'admin', 'editor']::workspace_role[]));
create policy "projects admin delete" on projects
for delete to authenticated
using (public.has_workspace_role(workspace_id, array['owner', 'admin']::workspace_role[]));

do $$
declare
  table_name text;
begin
  foreach table_name in array array[
    'products',
    'scenarios',
    'stations',
    'zones',
    'tasks',
    'task_dependencies',
    'manufacturing_steps',
    'part_references',
    'actual_events',
    'custom_columns',
    'step_photos',
    'step_tools'
  ]
  loop
    execute format('drop policy if exists "mvp anon read %s" on %I', table_name, table_name);
    execute format('drop policy if exists "mvp anon insert %s" on %I', table_name, table_name);
    execute format('drop policy if exists "mvp anon update %s" on %I', table_name, table_name);
    execute format('drop policy if exists "mvp anon delete %s" on %I', table_name, table_name);
  end loop;
end $$;

drop policy if exists "products workspace read" on products;
drop policy if exists "products workspace insert" on products;
drop policy if exists "products workspace update" on products;
drop policy if exists "products workspace delete" on products;
create policy "products workspace read" on products
for select to authenticated
using (public.has_workspace_role(public.product_workspace_id(id), array['owner', 'admin', 'editor', 'viewer']::workspace_role[]));
create policy "products workspace insert" on products
for insert to authenticated
with check (public.has_workspace_role(public.project_workspace_id(project_id), array['owner', 'admin', 'editor']::workspace_role[]));
create policy "products workspace update" on products
for update to authenticated
using (public.has_workspace_role(public.product_workspace_id(id), array['owner', 'admin', 'editor']::workspace_role[]))
with check (public.has_workspace_role(public.project_workspace_id(project_id), array['owner', 'admin', 'editor']::workspace_role[]));
create policy "products workspace delete" on products
for delete to authenticated
using (public.has_workspace_role(public.product_workspace_id(id), array['owner', 'admin']::workspace_role[]));

drop policy if exists "scenarios workspace read" on scenarios;
drop policy if exists "scenarios workspace insert" on scenarios;
drop policy if exists "scenarios workspace update" on scenarios;
drop policy if exists "scenarios workspace delete" on scenarios;
create policy "scenarios workspace read" on scenarios
for select to authenticated
using (public.has_workspace_role(public.product_workspace_id(product_id), array['owner', 'admin', 'editor', 'viewer']::workspace_role[]));
create policy "scenarios workspace insert" on scenarios
for insert to authenticated
with check (public.has_workspace_role(public.product_workspace_id(product_id), array['owner', 'admin', 'editor']::workspace_role[]));
create policy "scenarios workspace update" on scenarios
for update to authenticated
using (public.has_workspace_role(public.scenario_workspace_id(id), array['owner', 'admin', 'editor']::workspace_role[]))
with check (public.has_workspace_role(public.product_workspace_id(product_id), array['owner', 'admin', 'editor']::workspace_role[]));
create policy "scenarios workspace delete" on scenarios
for delete to authenticated
using (public.has_workspace_role(public.scenario_workspace_id(id), array['owner', 'admin']::workspace_role[]));

drop policy if exists "stations workspace read" on stations;
drop policy if exists "stations workspace insert" on stations;
drop policy if exists "stations workspace update" on stations;
drop policy if exists "stations workspace delete" on stations;
create policy "stations workspace read" on stations
for select to authenticated
using (public.has_workspace_role(public.scenario_workspace_id(scenario_id), array['owner', 'admin', 'editor', 'viewer']::workspace_role[]));
create policy "stations workspace insert" on stations
for insert to authenticated
with check (public.has_workspace_role(public.scenario_workspace_id(scenario_id), array['owner', 'admin', 'editor']::workspace_role[]));
create policy "stations workspace update" on stations
for update to authenticated
using (public.has_workspace_role(public.scenario_workspace_id(scenario_id), array['owner', 'admin', 'editor']::workspace_role[]))
with check (public.has_workspace_role(public.scenario_workspace_id(scenario_id), array['owner', 'admin', 'editor']::workspace_role[]));
create policy "stations workspace delete" on stations
for delete to authenticated
using (public.has_workspace_role(public.scenario_workspace_id(scenario_id), array['owner', 'admin']::workspace_role[]));

drop policy if exists "zones workspace read" on zones;
drop policy if exists "zones workspace insert" on zones;
drop policy if exists "zones workspace update" on zones;
drop policy if exists "zones workspace delete" on zones;
create policy "zones workspace read" on zones
for select to authenticated
using (public.has_workspace_role(public.scenario_workspace_id(scenario_id), array['owner', 'admin', 'editor', 'viewer']::workspace_role[]));
create policy "zones workspace insert" on zones
for insert to authenticated
with check (public.has_workspace_role(public.scenario_workspace_id(scenario_id), array['owner', 'admin', 'editor']::workspace_role[]));
create policy "zones workspace update" on zones
for update to authenticated
using (public.has_workspace_role(public.scenario_workspace_id(scenario_id), array['owner', 'admin', 'editor']::workspace_role[]))
with check (public.has_workspace_role(public.scenario_workspace_id(scenario_id), array['owner', 'admin', 'editor']::workspace_role[]));
create policy "zones workspace delete" on zones
for delete to authenticated
using (public.has_workspace_role(public.scenario_workspace_id(scenario_id), array['owner', 'admin']::workspace_role[]));

drop policy if exists "tasks workspace read" on tasks;
drop policy if exists "tasks workspace insert" on tasks;
drop policy if exists "tasks workspace update" on tasks;
drop policy if exists "tasks workspace delete" on tasks;
create policy "tasks workspace read" on tasks
for select to authenticated
using (public.has_workspace_role(public.scenario_workspace_id(scenario_id), array['owner', 'admin', 'editor', 'viewer']::workspace_role[]));
create policy "tasks workspace insert" on tasks
for insert to authenticated
with check (public.has_workspace_role(public.scenario_workspace_id(scenario_id), array['owner', 'admin', 'editor']::workspace_role[]));
create policy "tasks workspace update" on tasks
for update to authenticated
using (public.has_workspace_role(public.scenario_workspace_id(scenario_id), array['owner', 'admin', 'editor']::workspace_role[]))
with check (public.has_workspace_role(public.scenario_workspace_id(scenario_id), array['owner', 'admin', 'editor']::workspace_role[]));
create policy "tasks workspace delete" on tasks
for delete to authenticated
using (public.has_workspace_role(public.scenario_workspace_id(scenario_id), array['owner', 'admin']::workspace_role[]));

drop policy if exists "task_dependencies workspace read" on task_dependencies;
drop policy if exists "task_dependencies workspace insert" on task_dependencies;
drop policy if exists "task_dependencies workspace update" on task_dependencies;
drop policy if exists "task_dependencies workspace delete" on task_dependencies;
create policy "task_dependencies workspace read" on task_dependencies
for select to authenticated
using (public.has_workspace_role(public.task_workspace_id(successor_task_id), array['owner', 'admin', 'editor', 'viewer']::workspace_role[]));
create policy "task_dependencies workspace insert" on task_dependencies
for insert to authenticated
with check (
  public.has_workspace_role(public.task_workspace_id(successor_task_id), array['owner', 'admin', 'editor']::workspace_role[])
  and public.task_workspace_id(successor_task_id) = public.task_workspace_id(predecessor_task_id)
);
create policy "task_dependencies workspace update" on task_dependencies
for update to authenticated
using (public.has_workspace_role(public.task_workspace_id(successor_task_id), array['owner', 'admin', 'editor']::workspace_role[]))
with check (
  public.has_workspace_role(public.task_workspace_id(successor_task_id), array['owner', 'admin', 'editor']::workspace_role[])
  and public.task_workspace_id(successor_task_id) = public.task_workspace_id(predecessor_task_id)
);
create policy "task_dependencies workspace delete" on task_dependencies
for delete to authenticated
using (public.has_workspace_role(public.task_workspace_id(successor_task_id), array['owner', 'admin']::workspace_role[]));

drop policy if exists "manufacturing_steps workspace read" on manufacturing_steps;
drop policy if exists "manufacturing_steps workspace insert" on manufacturing_steps;
drop policy if exists "manufacturing_steps workspace update" on manufacturing_steps;
drop policy if exists "manufacturing_steps workspace delete" on manufacturing_steps;
create policy "manufacturing_steps workspace read" on manufacturing_steps
for select to authenticated
using (public.has_workspace_role(public.task_workspace_id(task_id), array['owner', 'admin', 'editor', 'viewer']::workspace_role[]));
create policy "manufacturing_steps workspace insert" on manufacturing_steps
for insert to authenticated
with check (public.has_workspace_role(public.task_workspace_id(task_id), array['owner', 'admin', 'editor']::workspace_role[]));
create policy "manufacturing_steps workspace update" on manufacturing_steps
for update to authenticated
using (public.has_workspace_role(public.task_workspace_id(task_id), array['owner', 'admin', 'editor']::workspace_role[]))
with check (public.has_workspace_role(public.task_workspace_id(task_id), array['owner', 'admin', 'editor']::workspace_role[]));
create policy "manufacturing_steps workspace delete" on manufacturing_steps
for delete to authenticated
using (public.has_workspace_role(public.task_workspace_id(task_id), array['owner', 'admin']::workspace_role[]));

drop policy if exists "part_references workspace read" on part_references;
drop policy if exists "part_references workspace insert" on part_references;
drop policy if exists "part_references workspace update" on part_references;
drop policy if exists "part_references workspace delete" on part_references;
create policy "part_references workspace read" on part_references
for select to authenticated
using (public.has_workspace_role(public.task_workspace_id(task_id), array['owner', 'admin', 'editor', 'viewer']::workspace_role[]));
create policy "part_references workspace insert" on part_references
for insert to authenticated
with check (public.has_workspace_role(public.task_workspace_id(task_id), array['owner', 'admin', 'editor']::workspace_role[]));
create policy "part_references workspace update" on part_references
for update to authenticated
using (public.has_workspace_role(public.task_workspace_id(task_id), array['owner', 'admin', 'editor']::workspace_role[]))
with check (public.has_workspace_role(public.task_workspace_id(task_id), array['owner', 'admin', 'editor']::workspace_role[]));
create policy "part_references workspace delete" on part_references
for delete to authenticated
using (public.has_workspace_role(public.task_workspace_id(task_id), array['owner', 'admin']::workspace_role[]));

drop policy if exists "actual_events workspace read" on actual_events;
drop policy if exists "actual_events workspace insert" on actual_events;
drop policy if exists "actual_events workspace update" on actual_events;
drop policy if exists "actual_events workspace delete" on actual_events;
create policy "actual_events workspace read" on actual_events
for select to authenticated
using (public.has_workspace_role(public.task_workspace_id(task_id), array['owner', 'admin', 'editor', 'viewer']::workspace_role[]));
create policy "actual_events workspace insert" on actual_events
for insert to authenticated
with check (public.has_workspace_role(public.task_workspace_id(task_id), array['owner', 'admin', 'editor']::workspace_role[]));
create policy "actual_events workspace update" on actual_events
for update to authenticated
using (public.has_workspace_role(public.task_workspace_id(task_id), array['owner', 'admin', 'editor']::workspace_role[]))
with check (public.has_workspace_role(public.task_workspace_id(task_id), array['owner', 'admin', 'editor']::workspace_role[]));
create policy "actual_events workspace delete" on actual_events
for delete to authenticated
using (public.has_workspace_role(public.task_workspace_id(task_id), array['owner', 'admin']::workspace_role[]));

drop policy if exists "custom_columns workspace read" on custom_columns;
drop policy if exists "custom_columns workspace insert" on custom_columns;
drop policy if exists "custom_columns workspace update" on custom_columns;
drop policy if exists "custom_columns workspace delete" on custom_columns;
create policy "custom_columns workspace read" on custom_columns
for select to authenticated
using (public.has_workspace_role(public.custom_column_workspace_id(product_id, scenario_id), array['owner', 'admin', 'editor', 'viewer']::workspace_role[]));
create policy "custom_columns workspace insert" on custom_columns
for insert to authenticated
with check (public.has_workspace_role(public.custom_column_workspace_id(product_id, scenario_id), array['owner', 'admin', 'editor']::workspace_role[]));
create policy "custom_columns workspace update" on custom_columns
for update to authenticated
using (public.has_workspace_role(public.custom_column_workspace_id(product_id, scenario_id), array['owner', 'admin', 'editor']::workspace_role[]))
with check (public.has_workspace_role(public.custom_column_workspace_id(product_id, scenario_id), array['owner', 'admin', 'editor']::workspace_role[]));
create policy "custom_columns workspace delete" on custom_columns
for delete to authenticated
using (public.has_workspace_role(public.custom_column_workspace_id(product_id, scenario_id), array['owner', 'admin']::workspace_role[]));

drop policy if exists "step_photos workspace read" on step_photos;
drop policy if exists "step_photos workspace insert" on step_photos;
drop policy if exists "step_photos workspace update" on step_photos;
drop policy if exists "step_photos workspace delete" on step_photos;
create policy "step_photos workspace read" on step_photos
for select to authenticated
using (public.has_workspace_role(public.task_workspace_id(task_id), array['owner', 'admin', 'editor', 'viewer']::workspace_role[]));
create policy "step_photos workspace insert" on step_photos
for insert to authenticated
with check (public.has_workspace_role(public.task_workspace_id(task_id), array['owner', 'admin', 'editor']::workspace_role[]));
create policy "step_photos workspace update" on step_photos
for update to authenticated
using (public.has_workspace_role(public.task_workspace_id(task_id), array['owner', 'admin', 'editor']::workspace_role[]))
with check (public.has_workspace_role(public.task_workspace_id(task_id), array['owner', 'admin', 'editor']::workspace_role[]));
create policy "step_photos workspace delete" on step_photos
for delete to authenticated
using (public.has_workspace_role(public.task_workspace_id(task_id), array['owner', 'admin']::workspace_role[]));

drop policy if exists "step_tools workspace read" on step_tools;
drop policy if exists "step_tools workspace insert" on step_tools;
drop policy if exists "step_tools workspace update" on step_tools;
drop policy if exists "step_tools workspace delete" on step_tools;
create policy "step_tools workspace read" on step_tools
for select to authenticated
using (public.has_workspace_role(public.task_workspace_id(task_id), array['owner', 'admin', 'editor', 'viewer']::workspace_role[]));
create policy "step_tools workspace insert" on step_tools
for insert to authenticated
with check (public.has_workspace_role(public.task_workspace_id(task_id), array['owner', 'admin', 'editor']::workspace_role[]));
create policy "step_tools workspace update" on step_tools
for update to authenticated
using (public.has_workspace_role(public.task_workspace_id(task_id), array['owner', 'admin', 'editor']::workspace_role[]))
with check (public.has_workspace_role(public.task_workspace_id(task_id), array['owner', 'admin', 'editor']::workspace_role[]));
create policy "step_tools workspace delete" on step_tools
for delete to authenticated
using (public.has_workspace_role(public.task_workspace_id(task_id), array['owner', 'admin']::workspace_role[]));

drop policy if exists "mvp anon read step photos" on storage.objects;
drop policy if exists "mvp anon insert step photos" on storage.objects;
drop policy if exists "mvp anon update step photos" on storage.objects;
drop policy if exists "mvp anon delete step photos" on storage.objects;
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

create policy "authenticated step photo reads"
on storage.objects for select to authenticated
using (
  bucket_id = 'step-photos'
  and (
    name not like 'workspaces/%'
    or public.has_workspace_role((storage.foldername(name))[2], array['owner', 'admin', 'editor', 'viewer']::workspace_role[])
  )
);

create policy "authenticated step photo updates"
on storage.objects for update to authenticated
using (
  bucket_id = 'step-photos'
  and (
    name not like 'workspaces/%'
    or public.has_workspace_role((storage.foldername(name))[2], array['owner', 'admin', 'editor']::workspace_role[])
  )
)
with check (
  bucket_id = 'step-photos'
  and (
    name not like 'workspaces/%'
    or public.has_workspace_role((storage.foldername(name))[2], array['owner', 'admin', 'editor']::workspace_role[])
  )
);

create policy "authenticated step photo deletes"
on storage.objects for delete to authenticated
using (
  bucket_id = 'step-photos'
  and (
    name not like 'workspaces/%'
    or public.has_workspace_role((storage.foldername(name))[2], array['owner', 'admin']::workspace_role[])
  )
);
