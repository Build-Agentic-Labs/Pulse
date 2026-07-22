-- Planning: production-schedule import -> sales orders -> work orders.
-- Apply with: node --env-file=.env.local scripts/apply-migration-safely.mjs 20260721120000_planning_sales_orders.sql
--
-- Additive only. Ids are `text` with gen_random_uuid()::text to match every existing planning
-- table. RLS mirrors those tables exactly: read requires Planning space access; write
-- additionally requires owner/admin/editor.
--
-- Design: docs/superpowers/specs/2026-07-21-planning-schedule-to-work-order-design.md

-- ── schedule_imports ────────────────────────────────────────────────────────
-- One row per uploaded workbook. first_row_no/last_row_no are the 1-based spreadsheet row
-- range, which is what the copy-paste export column walks -- pasting safely requires knowing
-- the batch covered rows 4..215 of a named sheet, not merely how many orders were created.
create table if not exists public.schedule_imports (
  id text primary key default gen_random_uuid()::text,
  workspace_id text not null references public.workspaces(id) on delete cascade,
  file_name text not null default '',
  sheet_name text not null default '',
  first_row_no integer not null default 0,
  last_row_no integer not null default 0,
  row_count integer not null default 0,
  imported_by uuid references auth.users(id) on delete set null,
  imported_at timestamptz not null default now()
);

create index if not exists schedule_imports_workspace_idx
  on public.schedule_imports(workspace_id, imported_at desc);

-- ── sales_orders ────────────────────────────────────────────────────────────
-- One row per S-ORD####. This is what the work-order create flow selects.
create table if not exists public.sales_orders (
  id text primary key default gen_random_uuid()::text,
  workspace_id text not null references public.workspaces(id) on delete cascade,
  so_no text not null,
  customer text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint sales_orders_no_unique unique (workspace_id, so_no)
);

create index if not exists sales_orders_workspace_idx
  on public.sales_orders(workspace_id);

-- ── sales_order_lines ───────────────────────────────────────────────────────
-- One row per IMPORTABLE spreadsheet row. Category divider rows ("TRAILERS", "STOCK") are
-- skipped at parse time and never stored, so their source_row_no simply has no record --
-- which is exactly why the export column walks a ROW RANGE and leaves those cells blank
-- instead of listing created orders and silently shifting every id below them up one row.
create table if not exists public.sales_order_lines (
  id text primary key default gen_random_uuid()::text,
  workspace_id text not null references public.workspaces(id) on delete cascade,
  sales_order_id text not null references public.sales_orders(id) on delete cascade,
  import_id text not null references public.schedule_imports(id) on delete cascade,
  source_row_no integer not null,
  fg_sku text not null default '',
  acc_sku text not null default '',
  trailer_letter text not null default '',
  model_raw text not null default '',
  customer_raw text not null default '',
  assembly_order_no text not null default '',
  status text not null default 'pending',
  flags jsonb not null default '[]'::jsonb,
  work_order_id text references public.work_orders(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint sales_order_lines_status_check
    check (status in ('pending', 'flagged', 'converted', 'skipped')),
  constraint sales_order_lines_row_unique unique (import_id, source_row_no)
);

create index if not exists sales_order_lines_order_idx
  on public.sales_order_lines(sales_order_id);
create index if not exists sales_order_lines_import_idx
  on public.sales_order_lines(import_id, source_row_no);

-- ── work_orders: traceability + provisional identity ────────────────────────
-- sales_order_line_id answers "which schedule line produced this?" (live, joinable).
-- sales_order_no is a frozen snapshot so a PRINTED traveler keeps its SO# even if the
-- schedule is later re-imported.
-- draft_no is the provisional D-MMYY-NN. Under the N1 decision the OFFICIAL order_no is
-- minted at approval, which is what keeps the official sequence contiguous -- discarding a
-- draft then costs nothing. order_no therefore becomes nullable; Postgres allows multiple
-- NULLs under a unique index, so existing uniqueness still holds.
alter table public.work_orders
  add column if not exists sales_order_line_id text
    references public.sales_order_lines(id) on delete set null,
  add column if not exists sales_order_no text not null default '',
  add column if not exists draft_no text not null default '';

alter table public.work_orders alter column order_no drop not null;

create index if not exists work_orders_sales_order_line_idx
  on public.work_orders(sales_order_line_id);

-- ── work_order_templates: re-key to SKU ─────────────────────────────────────
-- One SKU -> one BOM. A different customer means a different SKU, so the customer is encoded
-- in the SKU and template lookup becomes a dictionary hit instead of fuzzy customer matching.
-- Unique among NON-RETIRED rows only, so a SKU can be superseded (retire, never delete --
-- work_orders.template_id references these rows).
alter table public.work_order_templates
  add column if not exists sku text not null default '';

create unique index if not exists work_order_templates_sku_unique
  on public.work_order_templates(workspace_id, sku)
  where retired_at is null and sku <> '';

-- ── RLS ─────────────────────────────────────────────────────────────────────
alter table public.schedule_imports enable row level security;
alter table public.sales_orders enable row level security;
alter table public.sales_order_lines enable row level security;

drop policy if exists "schedule_imports read" on public.schedule_imports;
create policy "schedule_imports read" on public.schedule_imports
for select to authenticated
using (public.has_space_access(workspace_id, 'planning'));

drop policy if exists "schedule_imports write insert" on public.schedule_imports;
create policy "schedule_imports write insert" on public.schedule_imports
for insert to authenticated
with check (
  public.has_space_access(workspace_id, 'planning')
  and public.has_workspace_role(workspace_id, array['owner', 'admin', 'editor']::public.workspace_role[])
);

drop policy if exists "schedule_imports write update" on public.schedule_imports;
create policy "schedule_imports write update" on public.schedule_imports
for update to authenticated
using (
  public.has_space_access(workspace_id, 'planning')
  and public.has_workspace_role(workspace_id, array['owner', 'admin', 'editor']::public.workspace_role[])
);

drop policy if exists "schedule_imports write delete" on public.schedule_imports;
create policy "schedule_imports write delete" on public.schedule_imports
for delete to authenticated
using (
  public.has_space_access(workspace_id, 'planning')
  and public.has_workspace_role(workspace_id, array['owner', 'admin', 'editor']::public.workspace_role[])
);

drop policy if exists "sales_orders read" on public.sales_orders;
create policy "sales_orders read" on public.sales_orders
for select to authenticated
using (public.has_space_access(workspace_id, 'planning'));

drop policy if exists "sales_orders write insert" on public.sales_orders;
create policy "sales_orders write insert" on public.sales_orders
for insert to authenticated
with check (
  public.has_space_access(workspace_id, 'planning')
  and public.has_workspace_role(workspace_id, array['owner', 'admin', 'editor']::public.workspace_role[])
);

drop policy if exists "sales_orders write update" on public.sales_orders;
create policy "sales_orders write update" on public.sales_orders
for update to authenticated
using (
  public.has_space_access(workspace_id, 'planning')
  and public.has_workspace_role(workspace_id, array['owner', 'admin', 'editor']::public.workspace_role[])
);

drop policy if exists "sales_orders write delete" on public.sales_orders;
create policy "sales_orders write delete" on public.sales_orders
for delete to authenticated
using (
  public.has_space_access(workspace_id, 'planning')
  and public.has_workspace_role(workspace_id, array['owner', 'admin', 'editor']::public.workspace_role[])
);

drop policy if exists "sales_order_lines read" on public.sales_order_lines;
create policy "sales_order_lines read" on public.sales_order_lines
for select to authenticated
using (public.has_space_access(workspace_id, 'planning'));

drop policy if exists "sales_order_lines write insert" on public.sales_order_lines;
create policy "sales_order_lines write insert" on public.sales_order_lines
for insert to authenticated
with check (
  public.has_space_access(workspace_id, 'planning')
  and public.has_workspace_role(workspace_id, array['owner', 'admin', 'editor']::public.workspace_role[])
);

drop policy if exists "sales_order_lines write update" on public.sales_order_lines;
create policy "sales_order_lines write update" on public.sales_order_lines
for update to authenticated
using (
  public.has_space_access(workspace_id, 'planning')
  and public.has_workspace_role(workspace_id, array['owner', 'admin', 'editor']::public.workspace_role[])
);

drop policy if exists "sales_order_lines write delete" on public.sales_order_lines;
create policy "sales_order_lines write delete" on public.sales_order_lines
for delete to authenticated
using (
  public.has_space_access(workspace_id, 'planning')
  and public.has_workspace_role(workspace_id, array['owner', 'admin', 'editor']::public.workspace_role[])
);
