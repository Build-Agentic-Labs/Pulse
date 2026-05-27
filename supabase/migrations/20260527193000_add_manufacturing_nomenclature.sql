alter table products
add column if not exists product_code text;

alter table zones
add column if not exists code text,
add column if not exists description text;

create table if not exists manufacturing_components (
  id text primary key default gen_random_uuid()::text,
  scenario_id text not null references scenarios(id) on delete cascade,
  zone_id text references zones(id) on delete set null,
  code text not null,
  name text not null,
  description text,
  sequence integer not null default 1 check (sequence > 0),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (scenario_id, code)
);

create table if not exists document_type_codes (
  id text primary key default gen_random_uuid()::text,
  project_id text references projects(id) on delete cascade,
  product_id text references products(id) on delete cascade,
  code text not null,
  name text not null,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (project_id is not null or product_id is not null)
);

create unique index if not exists document_type_codes_project_code_idx
on document_type_codes(project_id, code)
where project_id is not null;

create unique index if not exists document_type_codes_product_code_idx
on document_type_codes(product_id, code)
where product_id is not null;

alter table tasks
add column if not exists component_id text references manufacturing_components(id) on delete set null,
add column if not exists task_number integer,
add column if not exists manufacturing_code text,
add column if not exists code_locked boolean not null default false,
add column if not exists code_generated_at timestamptz;

drop trigger if exists manufacturing_components_set_updated_at on manufacturing_components;
create trigger manufacturing_components_set_updated_at
before update on manufacturing_components
for each row execute function set_updated_at();

drop trigger if exists document_type_codes_set_updated_at on document_type_codes;
create trigger document_type_codes_set_updated_at
before update on document_type_codes
for each row execute function set_updated_at();

create index if not exists zones_code_idx on zones(scenario_id, code);
create index if not exists manufacturing_components_scenario_sequence_idx on manufacturing_components(scenario_id, sequence);
create index if not exists manufacturing_components_zone_id_idx on manufacturing_components(zone_id);
create index if not exists tasks_component_id_idx on tasks(component_id);
create index if not exists tasks_manufacturing_code_idx on tasks(scenario_id, manufacturing_code);

create unique index if not exists tasks_scenario_manufacturing_code_unique
on tasks(scenario_id, manufacturing_code)
where manufacturing_code is not null and manufacturing_code <> '';

alter table manufacturing_components enable row level security;
alter table document_type_codes enable row level security;

drop policy if exists "manufacturing_components workspace read" on manufacturing_components;
drop policy if exists "manufacturing_components workspace insert" on manufacturing_components;
drop policy if exists "manufacturing_components workspace update" on manufacturing_components;
drop policy if exists "manufacturing_components workspace delete" on manufacturing_components;

create policy "manufacturing_components workspace read" on manufacturing_components
for select to authenticated using (
  exists (
    select 1
    from scenarios s
    inner join products pr on pr.id = s.product_id
    inner join projects p on p.id = pr.project_id
    inner join workspace_members wm on wm.workspace_id = p.workspace_id
    where s.id = manufacturing_components.scenario_id and wm.user_id = auth.uid()
  )
);

create policy "manufacturing_components workspace insert" on manufacturing_components
for insert to authenticated with check (
  exists (
    select 1
    from scenarios s
    inner join products pr on pr.id = s.product_id
    inner join projects p on p.id = pr.project_id
    inner join workspace_members wm on wm.workspace_id = p.workspace_id
    where s.id = manufacturing_components.scenario_id and wm.user_id = auth.uid() and wm.role in ('owner', 'admin', 'editor')
  )
);

create policy "manufacturing_components workspace update" on manufacturing_components
for update to authenticated using (
  exists (
    select 1
    from scenarios s
    inner join products pr on pr.id = s.product_id
    inner join projects p on p.id = pr.project_id
    inner join workspace_members wm on wm.workspace_id = p.workspace_id
    where s.id = manufacturing_components.scenario_id and wm.user_id = auth.uid() and wm.role in ('owner', 'admin', 'editor')
  )
) with check (
  exists (
    select 1
    from scenarios s
    inner join products pr on pr.id = s.product_id
    inner join projects p on p.id = pr.project_id
    inner join workspace_members wm on wm.workspace_id = p.workspace_id
    where s.id = manufacturing_components.scenario_id and wm.user_id = auth.uid() and wm.role in ('owner', 'admin', 'editor')
  )
);

create policy "manufacturing_components workspace delete" on manufacturing_components
for delete to authenticated using (
  exists (
    select 1
    from scenarios s
    inner join products pr on pr.id = s.product_id
    inner join projects p on p.id = pr.project_id
    inner join workspace_members wm on wm.workspace_id = p.workspace_id
    where s.id = manufacturing_components.scenario_id and wm.user_id = auth.uid() and wm.role in ('owner', 'admin', 'editor')
  )
);

drop policy if exists "document_type_codes workspace read" on document_type_codes;
drop policy if exists "document_type_codes workspace insert" on document_type_codes;
drop policy if exists "document_type_codes workspace update" on document_type_codes;
drop policy if exists "document_type_codes workspace delete" on document_type_codes;

create policy "document_type_codes workspace read" on document_type_codes
for select to authenticated using (
  exists (
    select 1
    from projects p
    inner join workspace_members wm on wm.workspace_id = p.workspace_id
    where p.id = document_type_codes.project_id and wm.user_id = auth.uid()
  )
  or exists (
    select 1
    from products pr
    inner join projects p on p.id = pr.project_id
    inner join workspace_members wm on wm.workspace_id = p.workspace_id
    where pr.id = document_type_codes.product_id and wm.user_id = auth.uid()
  )
);

create policy "document_type_codes workspace insert" on document_type_codes
for insert to authenticated with check (
  exists (
    select 1
    from projects p
    inner join workspace_members wm on wm.workspace_id = p.workspace_id
    where p.id = document_type_codes.project_id and wm.user_id = auth.uid() and wm.role in ('owner', 'admin', 'editor')
  )
  or exists (
    select 1
    from products pr
    inner join projects p on p.id = pr.project_id
    inner join workspace_members wm on wm.workspace_id = p.workspace_id
    where pr.id = document_type_codes.product_id and wm.user_id = auth.uid() and wm.role in ('owner', 'admin', 'editor')
  )
);

create policy "document_type_codes workspace update" on document_type_codes
for update to authenticated using (
  exists (
    select 1
    from projects p
    inner join workspace_members wm on wm.workspace_id = p.workspace_id
    where p.id = document_type_codes.project_id and wm.user_id = auth.uid() and wm.role in ('owner', 'admin', 'editor')
  )
  or exists (
    select 1
    from products pr
    inner join projects p on p.id = pr.project_id
    inner join workspace_members wm on wm.workspace_id = p.workspace_id
    where pr.id = document_type_codes.product_id and wm.user_id = auth.uid() and wm.role in ('owner', 'admin', 'editor')
  )
) with check (
  exists (
    select 1
    from projects p
    inner join workspace_members wm on wm.workspace_id = p.workspace_id
    where p.id = document_type_codes.project_id and wm.user_id = auth.uid() and wm.role in ('owner', 'admin', 'editor')
  )
  or exists (
    select 1
    from products pr
    inner join projects p on p.id = pr.project_id
    inner join workspace_members wm on wm.workspace_id = p.workspace_id
    where pr.id = document_type_codes.product_id and wm.user_id = auth.uid() and wm.role in ('owner', 'admin', 'editor')
  )
);

create policy "document_type_codes workspace delete" on document_type_codes
for delete to authenticated using (
  exists (
    select 1
    from projects p
    inner join workspace_members wm on wm.workspace_id = p.workspace_id
    where p.id = document_type_codes.project_id and wm.user_id = auth.uid() and wm.role in ('owner', 'admin', 'editor')
  )
  or exists (
    select 1
    from products pr
    inner join projects p on p.id = pr.project_id
    inner join workspace_members wm on wm.workspace_id = p.workspace_id
    where pr.id = document_type_codes.product_id and wm.user_id = auth.uid() and wm.role in ('owner', 'admin', 'editor')
  )
);

do $$
begin
  execute 'alter table public.manufacturing_components replica identity full';
  execute 'alter table public.document_type_codes replica identity full';

  begin
    execute 'alter publication supabase_realtime add table public.manufacturing_components';
  exception
    when duplicate_object then null;
    when undefined_object then null;
  end;

  begin
    execute 'alter publication supabase_realtime add table public.document_type_codes';
  exception
    when duplicate_object then null;
    when undefined_object then null;
  end;
end $$;
