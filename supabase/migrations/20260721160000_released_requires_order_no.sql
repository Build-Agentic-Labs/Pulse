-- Close the N1 bypass: a released order must ALWAYS carry an official number.
-- Apply with: node --env-file=.env.local scripts/apply-migration-safely.mjs 20260721160000_released_requires_order_no.sql
--
-- The transition trigger enforces this, but it fires `before update OF STATUS`. Blanking a
-- released order's order_no is an UPDATE that never touches status, so the trigger does not fire:
-- the order silently loses its number, and because approval's max() scan ignores NULL numbers,
-- the NEXT approval re-mints the same GEN-MMYY-NN. Two travelers on the floor carrying one
-- official number.
--
-- This is a row-local invariant, so it belongs in a CHECK, which no update path can dodge.
-- Draft and cancelled orders are exempt: a draft has not been issued yet (that is the whole point
-- of N1), and a cancelled one may predate numbering.

alter table public.work_orders
  drop constraint if exists work_orders_issued_requires_order_no;

alter table public.work_orders
  add constraint work_orders_issued_requires_order_no
  check (
    status in ('draft', 'cancelled')
    or (order_no is not null and btrim(order_no) <> '')
  );
