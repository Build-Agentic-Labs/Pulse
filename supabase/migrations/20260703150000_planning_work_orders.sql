-- Planning space: work orders, templates, item master, and the space_access gate.
-- Apply with: node --env-file=.env.local scripts/apply-migration-safely.mjs 20260703150000_planning_work_orders.sql

-- ── space access (generic per-space grants; owners/admins are implicit) ──────
create table if not exists public.space_access (
  workspace_id text not null references public.workspaces(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  space text not null,
  granted_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  primary key (workspace_id, user_id, space),
  constraint space_access_known_space check (space in ('planning', 'production'))
);

create index if not exists space_access_user_idx on public.space_access(user_id);

create or replace function public.has_space_access(target_workspace_id text, target_space text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select
    target_workspace_id is not null
    and (
      public.has_workspace_role(target_workspace_id, array['owner', 'admin']::public.workspace_role[])
      or (
        public.has_workspace_role(
          target_workspace_id,
          array['owner', 'admin', 'editor', 'viewer']::public.workspace_role[]
        )
        and exists (
          select 1
          from public.space_access sa
          where sa.workspace_id = target_workspace_id
            and sa.user_id = auth.uid()
            and sa.space = target_space
        )
      )
    );
$$;

alter table public.space_access enable row level security;

drop policy if exists "space_access self or admin read" on public.space_access;
create policy "space_access self or admin read" on public.space_access
for select to authenticated
using (
  user_id = auth.uid()
  or public.has_workspace_role(workspace_id, array['owner', 'admin']::public.workspace_role[])
);

drop policy if exists "space_access admin insert" on public.space_access;
create policy "space_access admin insert" on public.space_access
for insert to authenticated
with check (public.has_workspace_role(workspace_id, array['owner', 'admin']::public.workspace_role[]));

drop policy if exists "space_access admin delete" on public.space_access;
create policy "space_access admin delete" on public.space_access
for delete to authenticated
using (public.has_workspace_role(workspace_id, array['owner', 'admin']::public.workspace_role[]));

-- ── item master (BC export, refreshed by re-upload) ──────────────────────────
create table if not exists public.planning_item_master (
  workspace_id text not null references public.workspaces(id) on delete cascade,
  item_no text not null,
  description text not null default '',
  vendor_no text,
  updated_at timestamptz not null default now(),
  primary key (workspace_id, item_no)
);

drop trigger if exists planning_item_master_set_updated_at on public.planning_item_master;
create trigger planning_item_master_set_updated_at
before update on public.planning_item_master
for each row execute function set_updated_at();

-- ── work order templates ─────────────────────────────────────────────────────
create table if not exists public.work_order_templates (
  id text primary key default gen_random_uuid()::text,
  workspace_id text not null references public.workspaces(id) on delete cascade,
  name text not null,
  customer text not null default '',
  model text not null default '',
  order_type text not null default 'head_unit',
  notes_default text not null default '',
  retired_at timestamptz,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint work_order_templates_type_check
    check (order_type in ('head_unit', 'accessories', 'decal', 'trailer', 'rework', 'mts'))
);

create index if not exists work_order_templates_workspace_idx on public.work_order_templates(workspace_id);

drop trigger if exists work_order_templates_set_updated_at on public.work_order_templates;
create trigger work_order_templates_set_updated_at
before update on public.work_order_templates
for each row execute function set_updated_at();

create table if not exists public.work_order_template_lines (
  id text primary key default gen_random_uuid()::text,
  template_id text not null references public.work_order_templates(id) on delete cascade,
  workspace_id text not null references public.workspaces(id) on delete cascade,
  item_no text not null,
  description text not null default '',
  build_qty numeric not null default 1,
  position integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists work_order_template_lines_template_idx on public.work_order_template_lines(template_id);
create index if not exists work_order_template_lines_workspace_idx on public.work_order_template_lines(workspace_id);

drop trigger if exists work_order_template_lines_set_updated_at on public.work_order_template_lines;
create trigger work_order_template_lines_set_updated_at
before update on public.work_order_template_lines
for each row execute function set_updated_at();

-- ── work orders ──────────────────────────────────────────────────────────────
create table if not exists public.work_orders (
  id text primary key default gen_random_uuid()::text,
  workspace_id text not null references public.workspaces(id) on delete cascade,
  order_no text not null,
  template_id text references public.work_order_templates(id) on delete set null,
  customer text not null default '',
  model text not null default '',
  order_type text not null default 'head_unit',
  status text not null default 'draft',
  order_date date not null default current_date,
  notes text not null default '',
  created_by uuid references auth.users(id) on delete set null,
  released_at timestamptz,
  production_started_at timestamptz,
  shipped_at timestamptz,
  cancelled_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint work_orders_type_check
    check (order_type in ('head_unit', 'accessories', 'decal', 'trailer', 'rework', 'mts')),
  constraint work_orders_status_check
    check (status in ('draft', 'released', 'in_production', 'shipped', 'cancelled'))
);

create index if not exists work_orders_workspace_status_idx on public.work_orders(workspace_id, status);
create unique index if not exists work_orders_order_no_unique_idx
  on public.work_orders (workspace_id, lower(btrim(order_no)));

drop trigger if exists work_orders_set_updated_at on public.work_orders;
create trigger work_orders_set_updated_at
before update on public.work_orders
for each row execute function set_updated_at();

create table if not exists public.work_order_lines (
  id text primary key default gen_random_uuid()::text,
  work_order_id text not null references public.work_orders(id) on delete cascade,
  workspace_id text not null references public.workspaces(id) on delete cascade,
  item_no text not null,
  description text not null default '',
  build_qty numeric not null default 1,
  shipped_qty numeric,
  fulfillment text not null default 'assembly',
  assembly_order_no text not null default '',
  pull_from_ref text not null default '',
  position integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint work_order_lines_fulfillment_check
    check (fulfillment in ('assembly', 'pull_from', 'pull_from_stock'))
);

create index if not exists work_order_lines_order_idx on public.work_order_lines(work_order_id);
create index if not exists work_order_lines_workspace_idx on public.work_order_lines(workspace_id);

drop trigger if exists work_order_lines_set_updated_at on public.work_order_lines;
create trigger work_order_lines_set_updated_at
before update on public.work_order_lines
for each row execute function set_updated_at();

-- ── RLS: read requires space access; writes additionally require editor role ─
alter table public.planning_item_master enable row level security;
alter table public.work_order_templates enable row level security;
alter table public.work_order_template_lines enable row level security;
alter table public.work_orders enable row level security;
alter table public.work_order_lines enable row level security;

drop policy if exists "planning_item_master read" on public.planning_item_master;
create policy "planning_item_master read" on public.planning_item_master
for select to authenticated
using (public.has_space_access(workspace_id, 'planning'));

drop policy if exists "planning_item_master write insert" on public.planning_item_master;
create policy "planning_item_master write insert" on public.planning_item_master
for insert to authenticated
with check (
  public.has_space_access(workspace_id, 'planning')
  and public.has_workspace_role(workspace_id, array['owner', 'admin', 'editor']::public.workspace_role[])
);

drop policy if exists "planning_item_master write update" on public.planning_item_master;
create policy "planning_item_master write update" on public.planning_item_master
for update to authenticated
using (
  public.has_space_access(workspace_id, 'planning')
  and public.has_workspace_role(workspace_id, array['owner', 'admin', 'editor']::public.workspace_role[])
);

drop policy if exists "planning_item_master write delete" on public.planning_item_master;
create policy "planning_item_master write delete" on public.planning_item_master
for delete to authenticated
using (
  public.has_space_access(workspace_id, 'planning')
  and public.has_workspace_role(workspace_id, array['owner', 'admin', 'editor']::public.workspace_role[])
);

drop policy if exists "work_order_templates read" on public.work_order_templates;
create policy "work_order_templates read" on public.work_order_templates
for select to authenticated
using (public.has_space_access(workspace_id, 'planning'));

drop policy if exists "work_order_templates write insert" on public.work_order_templates;
create policy "work_order_templates write insert" on public.work_order_templates
for insert to authenticated
with check (
  public.has_space_access(workspace_id, 'planning')
  and public.has_workspace_role(workspace_id, array['owner', 'admin', 'editor']::public.workspace_role[])
);

drop policy if exists "work_order_templates write update" on public.work_order_templates;
create policy "work_order_templates write update" on public.work_order_templates
for update to authenticated
using (
  public.has_space_access(workspace_id, 'planning')
  and public.has_workspace_role(workspace_id, array['owner', 'admin', 'editor']::public.workspace_role[])
);

drop policy if exists "work_order_templates write delete" on public.work_order_templates;
create policy "work_order_templates write delete" on public.work_order_templates
for delete to authenticated
using (
  public.has_space_access(workspace_id, 'planning')
  and public.has_workspace_role(workspace_id, array['owner', 'admin', 'editor']::public.workspace_role[])
);

drop policy if exists "work_order_template_lines read" on public.work_order_template_lines;
create policy "work_order_template_lines read" on public.work_order_template_lines
for select to authenticated
using (public.has_space_access(workspace_id, 'planning'));

drop policy if exists "work_order_template_lines write insert" on public.work_order_template_lines;
create policy "work_order_template_lines write insert" on public.work_order_template_lines
for insert to authenticated
with check (
  public.has_space_access(workspace_id, 'planning')
  and public.has_workspace_role(workspace_id, array['owner', 'admin', 'editor']::public.workspace_role[])
);

drop policy if exists "work_order_template_lines write update" on public.work_order_template_lines;
create policy "work_order_template_lines write update" on public.work_order_template_lines
for update to authenticated
using (
  public.has_space_access(workspace_id, 'planning')
  and public.has_workspace_role(workspace_id, array['owner', 'admin', 'editor']::public.workspace_role[])
);

drop policy if exists "work_order_template_lines write delete" on public.work_order_template_lines;
create policy "work_order_template_lines write delete" on public.work_order_template_lines
for delete to authenticated
using (
  public.has_space_access(workspace_id, 'planning')
  and public.has_workspace_role(workspace_id, array['owner', 'admin', 'editor']::public.workspace_role[])
);

drop policy if exists "work_orders read" on public.work_orders;
create policy "work_orders read" on public.work_orders
for select to authenticated
using (public.has_space_access(workspace_id, 'planning'));

drop policy if exists "work_orders write insert" on public.work_orders;
create policy "work_orders write insert" on public.work_orders
for insert to authenticated
with check (
  public.has_space_access(workspace_id, 'planning')
  and public.has_workspace_role(workspace_id, array['owner', 'admin', 'editor']::public.workspace_role[])
);

drop policy if exists "work_orders write update" on public.work_orders;
create policy "work_orders write update" on public.work_orders
for update to authenticated
using (
  public.has_space_access(workspace_id, 'planning')
  and public.has_workspace_role(workspace_id, array['owner', 'admin', 'editor']::public.workspace_role[])
);

drop policy if exists "work_orders write delete" on public.work_orders;
create policy "work_orders write delete" on public.work_orders
for delete to authenticated
using (
  public.has_space_access(workspace_id, 'planning')
  and public.has_workspace_role(workspace_id, array['owner', 'admin']::public.workspace_role[])
);

drop policy if exists "work_order_lines read" on public.work_order_lines;
create policy "work_order_lines read" on public.work_order_lines
for select to authenticated
using (public.has_space_access(workspace_id, 'planning'));

drop policy if exists "work_order_lines write insert" on public.work_order_lines;
create policy "work_order_lines write insert" on public.work_order_lines
for insert to authenticated
with check (
  public.has_space_access(workspace_id, 'planning')
  and public.has_workspace_role(workspace_id, array['owner', 'admin', 'editor']::public.workspace_role[])
);

drop policy if exists "work_order_lines write update" on public.work_order_lines;
create policy "work_order_lines write update" on public.work_order_lines
for update to authenticated
using (
  public.has_space_access(workspace_id, 'planning')
  and public.has_workspace_role(workspace_id, array['owner', 'admin', 'editor']::public.workspace_role[])
);

drop policy if exists "work_order_lines write delete" on public.work_order_lines;
create policy "work_order_lines write delete" on public.work_order_lines
for delete to authenticated
using (
  public.has_space_access(workspace_id, 'planning')
  and public.has_workspace_role(workspace_id, array['owner', 'admin', 'editor']::public.workspace_role[])
);
