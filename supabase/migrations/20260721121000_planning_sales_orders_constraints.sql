-- Gate-review corrections to 20260721120000_planning_sales_orders.sql.
-- Apply with: node --env-file=.env.local scripts/apply-migration-safely.mjs 20260721121000_planning_sales_orders_constraints.sql
--
-- Additive only. Each item below was raised by an adversarial review of the prior migration
-- and is cheap to fix now, while these tables are still empty and unshipped.

-- ── 1. updated_at triggers (BLOCKING finding) ───────────────────────────────
-- Every other planning table installs set_updated_at(); these two were missed, so a row
-- flipped from 'pending' to 'converted' would keep its import-time updated_at forever and
-- every freshness display built on it would silently report stale data.
drop trigger if exists sales_orders_set_updated_at on public.sales_orders;
create trigger sales_orders_set_updated_at
before update on public.sales_orders
for each row execute function set_updated_at();

drop trigger if exists sales_order_lines_set_updated_at on public.sales_order_lines;
create trigger sales_order_lines_set_updated_at
before update on public.sales_order_lines
for each row execute function set_updated_at();

-- ── 2. Case/trim-normalized sales order numbers ─────────────────────────────
-- cleanSo preserves the sheet's casing, so "s-ord1234" and "S-ORD1234" would otherwise become
-- two distinct sales orders. work_orders already normalizes this way; match it.
alter table public.sales_orders drop constraint if exists sales_orders_no_unique;
create unique index if not exists sales_orders_no_unique_idx
  on public.sales_orders (workspace_id, lower(btrim(so_no)));

-- ── 3. draft_no uniqueness backstop ─────────────────────────────────────────
-- suggestDraftNo is a client-side max+1. order_no has a unique index that its 23505 retry
-- depends on; draft_no had no equivalent, so two concurrent draft creations could mint the
-- same D-MMYY-NN -- and draft_no is retained permanently as the audit identity.
create unique index if not exists work_orders_draft_no_unique_idx
  on public.work_orders (workspace_id, lower(btrim(draft_no)))
  where draft_no <> '';

-- ── 4. Row-range and flag-shape sanity ──────────────────────────────────────
-- An inverted range would make the export column silently empty; buildExportColumn already
-- returns an empty column for last < first, but the data should never get there.
alter table public.schedule_imports
  drop constraint if exists schedule_imports_row_range_check;
alter table public.schedule_imports
  add constraint schedule_imports_row_range_check
  check (last_row_no >= first_row_no);

-- flags is consumed as an array of ResolutionFlag; an object or scalar would break the reader.
alter table public.sales_order_lines
  drop constraint if exists sales_order_lines_flags_array_check;
alter table public.sales_order_lines
  add constraint sales_order_lines_flags_array_check
  check (jsonb_typeof(flags) = 'array');

-- ── 5. Converted lines must name their work order ───────────────────────────
-- A line marked 'converted' with a null work_order_id is unreachable state: the export column
-- would leave its cell blank while the UI reports it as done.
alter table public.sales_order_lines
  drop constraint if exists sales_order_lines_converted_has_order_check;
alter table public.sales_order_lines
  add constraint sales_order_lines_converted_has_order_check
  check (status <> 'converted' or work_order_id is not null);
