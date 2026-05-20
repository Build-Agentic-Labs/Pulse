create extension if not exists pgcrypto;

do $$
begin
  create type product_status as enum ('draft', 'review', 'approved', 'released', 'obsolete');
exception when duplicate_object then null;
end $$;

do $$
begin
  create type demand_period as enum ('shift', 'day', 'week', 'month', 'year', 'custom');
exception when duplicate_object then null;
end $$;

do $$
begin
  create type scenario_type as enum ('current_state', 'future_state', 'prototype', 'production', 'what_if');
exception when duplicate_object then null;
end $$;

do $$
begin
  create type scenario_status as enum ('draft', 'baseline', 'released', 'archived');
exception when duplicate_object then null;
end $$;

do $$
begin
  create type takt_status as enum ('green', 'yellow', 'red', 'missing');
exception when duplicate_object then null;
end $$;

do $$
begin
  create type row_type as enum ('task', 'milestone', 'inspection', 'material_gate', 'hold', 'rework', 'buffer');
exception when duplicate_object then null;
end $$;

do $$
begin
  create type task_status as enum ('not_started', 'ready', 'in_progress', 'complete', 'blocked', 'hold', 'qc_hold', 'rework');
exception when duplicate_object then null;
end $$;

do $$
begin
  create type dependency_type as enum ('finish_to_start', 'start_to_start', 'finish_to_finish', 'start_to_finish');
exception when duplicate_object then null;
end $$;

do $$
begin
  create type constraint_type as enum ('safety', 'quality', 'material', 'tooling', 'labor', 'engineering', 'traveler');
exception when duplicate_object then null;
end $$;

do $$
begin
  create type skill_level as enum ('apprentice', 'trained', 'certified', 'expert');
exception when duplicate_object then null;
end $$;

do $$
begin
  create type rework_risk as enum ('low', 'medium', 'high');
exception when duplicate_object then null;
end $$;

do $$
begin
  create type actual_event_type as enum ('start', 'pause', 'resume', 'complete', 'blocked', 'unblocked', 'qc_hold', 'rework', 'note');
exception when duplicate_object then null;
end $$;

do $$
begin
  create type custom_column_type as enum (
    'text',
    'long_text',
    'number',
    'currency',
    'percent',
    'duration',
    'date',
    'datetime',
    'checkbox',
    'select',
    'multi_select',
    'person',
    'formula',
    'url',
    'file',
    'relation',
    'rollup',
    'status',
    'rating',
    'risk_score'
  );
exception when duplicate_object then null;
end $$;

do $$
begin
  create type custom_column_scope as enum ('product', 'scenario', 'station', 'task', 'all');
exception when duplicate_object then null;
end $$;

create or replace function set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create table if not exists products (
  id text primary key default gen_random_uuid()::text,
  name text not null,
  sku text,
  family text,
  revision text not null default 'Rev A',
  description text,
  owner_id text,
  owner_name text not null default 'Manufacturing Engineering',
  status product_status not null default 'draft',
  target_man_hours numeric(10,2) not null default 0 check (target_man_hours >= 0),
  demand_quantity numeric(12,2) not null default 1 check (demand_quantity >= 0),
  demand_period demand_period not null default 'day',
  gross_available_minutes numeric(10,2) not null default 0 check (gross_available_minutes >= 0),
  break_minutes numeric(10,2) not null default 0 check (break_minutes >= 0),
  lunch_minutes numeric(10,2) not null default 0 check (lunch_minutes >= 0),
  meeting_minutes numeric(10,2) not null default 0 check (meeting_minutes >= 0),
  planned_downtime_minutes numeric(10,2) not null default 0 check (planned_downtime_minutes >= 0),
  work_days_per_week numeric(5,2) not null default 5 check (work_days_per_week >= 0),
  work_weeks_per_month numeric(5,2) not null default 4.33 check (work_weeks_per_month >= 0),
  available_work_days_per_month numeric(7,2) not null default 0 check (available_work_days_per_month >= 0),
  net_available_minutes numeric(10,2) not null default 0 check (net_available_minutes >= 0),
  weekly_available_minutes numeric(12,2) not null default 0 check (weekly_available_minutes >= 0),
  monthly_available_minutes numeric(12,2) not null default 0 check (monthly_available_minutes >= 0),
  calculated_takt_minutes numeric(10,2) not null default 0 check (calculated_takt_minutes >= 0),
  manual_takt_minutes numeric(10,2) check (manual_takt_minutes is null or manual_takt_minutes >= 0),
  active_takt_minutes numeric(10,2) not null default 0 check (active_takt_minutes >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists scenarios (
  id text primary key default gen_random_uuid()::text,
  product_id text not null references products(id) on delete cascade,
  name text not null,
  description text,
  type scenario_type not null default 'current_state',
  status scenario_status not null default 'draft',
  target_output numeric(12,2) not null default 1 check (target_output >= 0),
  target_output_period text not null default 'day',
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists stations (
  id text primary key default gen_random_uuid()::text,
  scenario_id text not null references scenarios(id) on delete cascade,
  sequence integer not null check (sequence > 0),
  name text not null,
  description text,
  owner_id text,
  owner_name text not null default 'Manufacturing Engineering',
  planned_cycle_minutes numeric(10,2) not null default 0 check (planned_cycle_minutes >= 0),
  actual_cycle_minutes numeric(10,2) check (actual_cycle_minutes is null or actual_cycle_minutes >= 0),
  planned_operators numeric(8,2) not null default 1 check (planned_operators >= 0),
  actual_operators numeric(8,2) check (actual_operators is null or actual_operators >= 0),
  planned_man_hours numeric(10,2) not null default 0 check (planned_man_hours >= 0),
  actual_man_hours numeric(10,2) check (actual_man_hours is null or actual_man_hours >= 0),
  takt_status takt_status not null default 'missing',
  bottleneck_flag boolean not null default false,
  wip_limit integer check (wip_limit is null or wip_limit >= 0),
  area text,
  tools_required text[] not null default '{}',
  equipment_required text[] not null default '{}',
  safety_notes text,
  qc_notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (scenario_id, sequence)
);

create table if not exists zones (
  id text primary key default gen_random_uuid()::text,
  scenario_id text not null references scenarios(id) on delete cascade,
  sequence integer not null check (sequence > 0),
  name text not null default '',
  color text not null default '#15756d',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (scenario_id, sequence)
);

create table if not exists tasks (
  id text primary key default gen_random_uuid()::text,
  scenario_id text not null references scenarios(id) on delete cascade,
  station_id text references stations(id) on delete set null,
  zone_id text references zones(id) on delete set null,
  parent_task_id text references tasks(id) on delete cascade,
  row_type row_type not null default 'task',
  wbs text not null,
  name text not null default '',
  description text,
  planned_start timestamptz not null,
  planned_finish timestamptz not null,
  planned_duration_minutes numeric(10,2) not null default 0 check (planned_duration_minutes >= 0),
  actual_start timestamptz,
  actual_finish timestamptz,
  actual_duration_minutes numeric(10,2) check (actual_duration_minutes is null or actual_duration_minutes >= 0),
  planned_operators numeric(8,2) not null default 1 check (planned_operators >= 0),
  actual_operators numeric(8,2) check (actual_operators is null or actual_operators >= 0),
  planned_man_hours numeric(10,2) not null default 0 check (planned_man_hours >= 0),
  actual_man_hours numeric(10,2) check (actual_man_hours is null or actual_man_hours >= 0),
  status task_status not null default 'not_started',
  percent_complete numeric(5,2) not null default 0 check (percent_complete >= 0 and percent_complete <= 100),
  owner_id text,
  owner_name text,
  role text,
  skill_level skill_level,
  critical_path boolean not null default false,
  bottleneck_flag boolean not null default false,
  quality_gate boolean not null default false,
  traveler_signoff_required boolean not null default false,
  sop_link text,
  work_instruction_link text,
  drawing_link text,
  material_kit text,
  tools_required text[] not null default '{}',
  equipment_required text[] not null default '{}',
  safety_notes text,
  qc_checklist text,
  rework_risk rework_risk,
  notes text,
  custom_fields jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (planned_finish >= planned_start),
  unique (scenario_id, wbs)
);

create table if not exists task_dependencies (
  id text primary key default gen_random_uuid()::text,
  predecessor_task_id text not null references tasks(id) on delete cascade,
  successor_task_id text not null references tasks(id) on delete cascade,
  type dependency_type not null default 'finish_to_start',
  lag_minutes numeric(10,2) not null default 0,
  constraint_type constraint_type,
  created_at timestamptz not null default now(),
  check (predecessor_task_id <> successor_task_id),
  unique (predecessor_task_id, successor_task_id, type)
);

create table if not exists manufacturing_steps (
  id text primary key default gen_random_uuid()::text,
  task_id text not null references tasks(id) on delete cascade,
  sequence integer not null check (sequence > 0),
  instruction text not null default '',
  duration_minutes numeric(10,2) not null default 0 check (duration_minutes >= 0),
  quality_check text,
  dependency_ids text[] not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (task_id, sequence)
);

create table if not exists part_references (
  id text primary key default gen_random_uuid()::text,
  task_id text not null references tasks(id) on delete cascade,
  part_number text not null,
  description text,
  quantity numeric(12,3) check (quantity is null or quantity >= 0),
  disposition text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists actual_events (
  id text primary key default gen_random_uuid()::text,
  task_id text not null references tasks(id) on delete cascade,
  event_type actual_event_type not null,
  timestamp timestamptz not null default now(),
  user_id text,
  notes text,
  reason_code text,
  created_at timestamptz not null default now()
);

create table if not exists custom_columns (
  id text primary key default gen_random_uuid()::text,
  product_id text references products(id) on delete cascade,
  scenario_id text references scenarios(id) on delete cascade,
  name text not null,
  key text not null,
  description text,
  type custom_column_type not null default 'text',
  applies_to custom_column_scope not null default 'task',
  required boolean not null default false,
  default_value jsonb,
  options text[] not null default '{}',
  formula text,
  unit text,
  precision integer check (precision is null or precision >= 0),
  visible boolean not null default true,
  locked boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (product_id is not null or scenario_id is not null)
);

drop trigger if exists products_set_updated_at on products;
create trigger products_set_updated_at
before update on products
for each row execute function set_updated_at();

drop trigger if exists scenarios_set_updated_at on scenarios;
create trigger scenarios_set_updated_at
before update on scenarios
for each row execute function set_updated_at();

drop trigger if exists stations_set_updated_at on stations;
create trigger stations_set_updated_at
before update on stations
for each row execute function set_updated_at();

drop trigger if exists tasks_set_updated_at on tasks;
create trigger tasks_set_updated_at
before update on tasks
for each row execute function set_updated_at();

drop trigger if exists zones_set_updated_at on zones;
create trigger zones_set_updated_at
before update on zones
for each row execute function set_updated_at();

drop trigger if exists manufacturing_steps_set_updated_at on manufacturing_steps;
create trigger manufacturing_steps_set_updated_at
before update on manufacturing_steps
for each row execute function set_updated_at();

drop trigger if exists part_references_set_updated_at on part_references;
create trigger part_references_set_updated_at
before update on part_references
for each row execute function set_updated_at();

drop trigger if exists custom_columns_set_updated_at on custom_columns;
create trigger custom_columns_set_updated_at
before update on custom_columns
for each row execute function set_updated_at();

create index if not exists scenarios_product_id_idx on scenarios(product_id);
create index if not exists stations_scenario_id_sequence_idx on stations(scenario_id, sequence);
create index if not exists zones_scenario_id_sequence_idx on zones(scenario_id, sequence);
create index if not exists tasks_scenario_id_wbs_idx on tasks(scenario_id, wbs);
create index if not exists tasks_station_id_idx on tasks(station_id);
create index if not exists tasks_zone_id_idx on tasks(zone_id);
create index if not exists tasks_parent_task_id_idx on tasks(parent_task_id);
create index if not exists task_dependencies_successor_idx on task_dependencies(successor_task_id);
create index if not exists task_dependencies_predecessor_idx on task_dependencies(predecessor_task_id);
create index if not exists manufacturing_steps_task_id_sequence_idx on manufacturing_steps(task_id, sequence);
create index if not exists part_references_task_id_idx on part_references(task_id);
create index if not exists actual_events_task_id_timestamp_idx on actual_events(task_id, timestamp);
create index if not exists custom_columns_product_id_idx on custom_columns(product_id);
create index if not exists custom_columns_scenario_id_idx on custom_columns(scenario_id);
create unique index if not exists custom_columns_scope_key_idx
on custom_columns (coalesce(product_id, ''), coalesce(scenario_id, ''), key);

create or replace view planner_tasks as
select
  t.*,
  coalesce(
    array_agg(td.predecessor_task_id order by td.created_at) filter (where td.predecessor_task_id is not null),
    '{}'::text[]
  ) as dependency_ids,
  coalesce(
    (
      select jsonb_agg(
        jsonb_build_object(
          'id', ms.id,
          'sequence', ms.sequence,
          'instruction', ms.instruction,
          'durationMinutes', ms.duration_minutes,
          'qualityCheck', ms.quality_check,
          'dependencyIds', ms.dependency_ids
        )
        order by ms.sequence
      )
      from manufacturing_steps ms
      where ms.task_id = t.id
    ),
    '[]'::jsonb
  ) as manufacturing_steps,
  coalesce(
    (
      select jsonb_agg(
        jsonb_build_object(
          'id', pr.id,
          'partNumber', pr.part_number,
          'description', pr.description,
          'quantity', pr.quantity,
          'disposition', pr.disposition
        )
        order by pr.created_at, pr.id
      )
      from part_references pr
      where pr.task_id = t.id
    ),
    '[]'::jsonb
  ) as part_references
from tasks t
left join task_dependencies td on td.successor_task_id = t.id
group by t.id;

alter table products enable row level security;
alter table scenarios enable row level security;
alter table stations enable row level security;
alter table zones enable row level security;
alter table tasks enable row level security;
alter table task_dependencies enable row level security;
alter table manufacturing_steps enable row level security;
alter table part_references enable row level security;
alter table actual_events enable row level security;
alter table custom_columns enable row level security;
