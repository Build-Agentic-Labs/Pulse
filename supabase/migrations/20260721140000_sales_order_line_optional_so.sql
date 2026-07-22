-- A schedule line may be importable WITHOUT a sales order number yet.
-- Apply with: node --env-file=.env.local scripts/apply-migration-safely.mjs 20260721140000_sales_order_line_optional_so.sql
--
-- `cleanSo` treats a blank/NEED SO# as an ADVISORY flag, not a blocking one -- the June schedule
-- carries such rows and they are still real units to build. But `sales_order_lines.sales_order_id`
-- was NOT NULL, so exactly those lines could not be stored at all: the importer would have had to
-- either drop them (losing rows, and with them the export column's row alignment) or invent a
-- placeholder sales order (fabricating a number that has to be un-fabricated later).
--
-- Nullable is the honest shape: the line exists, its sales order is not known yet, and the
-- planner assigns one when the sheet catches up.

alter table public.sales_order_lines alter column sales_order_id drop not null;

-- A line still cannot claim to be converted without naming its work order (unchanged), and the
-- import/row uniqueness that the export column depends on is untouched.
