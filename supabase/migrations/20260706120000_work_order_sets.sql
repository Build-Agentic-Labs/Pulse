-- Work-order sets: GEN/PM marriage + TRL supermarket distribution.
-- Adds the 'power_module' order type, per-order set columns, and the trailer-config catalog.
-- Apply with: node --env-file=.env.local scripts/apply-migration-safely.mjs 20260706120000_work_order_sets.sql
--
-- Constraint widening is done as drop-constraint + add-constraint: the safe applier forbids
-- irreversible structural loss but `alter table … drop constraint` + re-add is the
-- established, non-destructive way to widen a check.

-- ── widen the order-type checks to include 'power_module' ────────────────────
alter table public.work_order_templates
  drop constraint if exists work_order_templates_type_check;
alter table public.work_order_templates
  add constraint work_order_templates_type_check
    check (order_type in ('head_unit', 'power_module', 'accessories', 'decal', 'trailer', 'rework', 'mts'));

alter table public.work_orders
  drop constraint if exists work_orders_type_check;
alter table public.work_orders
  add constraint work_orders_type_check
    check (order_type in ('head_unit', 'power_module', 'accessories', 'decal', 'trailer', 'rework', 'mts'));

-- ── set definitions live on generator templates ──────────────────────────────
alter table public.work_order_templates
  add column if not exists pm_template_id text references public.work_order_templates(id) on delete set null;
alter table public.work_order_templates
  add column if not exists default_trailer_letter text not null default '';

-- ── per-order set columns ────────────────────────────────────────────────────
alter table public.work_orders
  add column if not exists set_no text not null default '';
alter table public.work_orders
  add column if not exists trailer_letter text not null default '';
alter table public.work_orders
  add column if not exists main_order_id text references public.work_orders(id) on delete set null;

create index if not exists work_orders_main_order_idx on public.work_orders(main_order_id);

-- ── trailer config catalog (Planning-owned; letter → name → optional template) ─
create table if not exists public.trailer_configs (
  workspace_id text not null references public.workspaces(id) on delete cascade,
  letter text not null,
  name text not null default '',
  trailer_template_id text references public.work_order_templates(id) on delete set null,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (workspace_id, letter),
  constraint trailer_configs_letter_check check (letter ~ '^[A-Z]$')
);

drop trigger if exists trailer_configs_set_updated_at on public.trailer_configs;
create trigger trailer_configs_set_updated_at
before update on public.trailer_configs
for each row execute function set_updated_at();

-- ── RLS: read requires space access; writes additionally require editor role ─
alter table public.trailer_configs enable row level security;

drop policy if exists "trailer_configs read" on public.trailer_configs;
create policy "trailer_configs read" on public.trailer_configs
for select to authenticated
using (public.has_space_access(workspace_id, 'planning'));

drop policy if exists "trailer_configs write insert" on public.trailer_configs;
create policy "trailer_configs write insert" on public.trailer_configs
for insert to authenticated
with check (
  public.has_space_access(workspace_id, 'planning')
  and public.has_workspace_role(workspace_id, array['owner', 'admin', 'editor']::public.workspace_role[])
);

drop policy if exists "trailer_configs write update" on public.trailer_configs;
create policy "trailer_configs write update" on public.trailer_configs
for update to authenticated
using (
  public.has_space_access(workspace_id, 'planning')
  and public.has_workspace_role(workspace_id, array['owner', 'admin', 'editor']::public.workspace_role[])
);

drop policy if exists "trailer_configs write delete" on public.trailer_configs;
create policy "trailer_configs write delete" on public.trailer_configs
for delete to authenticated
using (
  public.has_space_access(workspace_id, 'planning')
  and public.has_workspace_role(workspace_id, array['owner', 'admin', 'editor']::public.workspace_role[])
);
