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

alter table tasks add column if not exists zone_id text references zones(id) on delete set null;

drop trigger if exists zones_set_updated_at on zones;
create trigger zones_set_updated_at
before update on zones
for each row execute function set_updated_at();

create index if not exists zones_scenario_id_sequence_idx on zones(scenario_id, sequence);
create index if not exists tasks_zone_id_idx on tasks(zone_id);

alter table zones enable row level security;

drop policy if exists "mvp anon read zones" on zones;
drop policy if exists "mvp anon insert zones" on zones;
drop policy if exists "mvp anon update zones" on zones;
drop policy if exists "mvp anon delete zones" on zones;

create policy "mvp anon read zones" on zones for select to anon using (true);
create policy "mvp anon insert zones" on zones for insert to anon with check (true);
create policy "mvp anon update zones" on zones for update to anon using (true) with check (true);
create policy "mvp anon delete zones" on zones for delete to anon using (true);
