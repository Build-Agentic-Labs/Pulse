# Work-Order Sets: GEN / PM / TRL Distribution — Design

**Date:** 2026-07-06
**Status:** Approved in conversation (scheme shaped by the planner)
**Builds on:** `2026-07-03-planning-work-orders-design.md` (shipped)

## Problem

Final assembly wastes time matching components to units. Three work orders are distributed
per generator build — the Main (generator/head unit), a Power Module, and a Trailer — with
no printed linkage. The fix: serialized marriage for Gen↔PM (same set number), supermarket
pull for trailers (configuration letter), all stamped on the Main's printed sheet.

## Agreed scheme

| Document | Number | Match rule |
|---|---|---|
| Main (Generator) | `GEN-0726-01` | Prints match strip: SET 01 · TRAILER A |
| Power module | `PM-0726-01` | Auto-created with its Main; same set number |
| Trailer supermarket | `TRL-0726-A` | One order per config letter per month; quantity-driven; NO batch suffix |

- Numbering becomes **`{PREFIX}-MMYY-NN`** (e.g. July 2026 → `0726`), replacing `WO-YYMM-NN`.
  Prefix by order type: `GEN` (head_unit), `PM` (power_module — NEW type), `TRL` (trailer),
  `ACC` (accessories), `DEC` (decal), `RWK` (rework), `MTS` (mts). Existing `WO-…` orders keep
  their numbers; only new orders use the new format. Sequences remain per-month and are
  **shared across GEN+PM within a set** (PM copies the Main's NN), independent otherwise per type.
- Trailer orders use the **letter as the identifier**: `TRL-0726-A`, unique per workspace —
  which enforces one trailer order per config per month (restock = raise build quantity).
- The **trailer config catalog** is a small Planning-owned table: letter → name
  ("Dual axle · electric brakes") → optional trailer template. Managed in Planning settings.
- **Set definitions** live on generator templates: `pm_template_id` (which PM template
  auto-creates with this Main) + `default_trailer_letter`. Planner can override the letter
  per order at creation.
- The printed Main carries the **Final Assembly Match strip** (already shipped visually in
  `work-order-print.tsx` as the optional `match` prop): GEN set no · PM set no · Trailer letter
  with config name. This work wires real data into it.

## Data model (migration `20260706*_work_order_sets.sql`)

1. `work_order_templates.order_type` + `work_orders.order_type` check constraints gain
   `'power_module'`. (Constraint swap: drop + re-add with the extended list — the safe
   applier forbids destructive table ops but `alter table … drop constraint` + `add` is the
   established, non-destructive way to widen a check.)
2. `work_order_templates` add: `pm_template_id text references work_order_templates(id) on delete set null`,
   `default_trailer_letter text not null default ''`.
3. `work_orders` add: `set_no text not null default ''` (short match number, e.g. "01"),
   `trailer_letter text not null default ''` (Mains only), `main_order_id text references
   work_orders(id) on delete set null` (set on PM orders; provenance of the marriage).
4. New `trailer_configs`: `workspace_id`, `letter` (single A–Z, upper), `name`,
   `trailer_template_id` nullable FK, `created_by`, timestamps; PK `(workspace_id, letter)`;
   RLS identical to other planning tables (`has_space_access` read; editor+ write).

## Domain (`src/domain/work-orders.ts`)

- `WorkOrderType` gains `"power_module"`; labels updated (`head_unit` label becomes
  "Generator (Main)" — floor language keeps HEAD UNIT on templates, but UI labels say Generator).
- `ORDER_TYPE_PREFIXES: Record<WorkOrderType, string>` = GEN/PM/TRL/ACC/DEC/RWK/MTS.
- `orderNoMonthKey` → MMYY (`"2026-07-15"` → `"0726"`). All tests updated.
- `suggestOrderNo(existing, orderDate, orderType)` — type-prefixed; GEN and PM share a
  sequence pool (both scan `GEN-`+`PM-` numbers for the month so a set's NN is never reused).
- `trailerOrderNo(orderDate, letter)` → `TRL-0726-A`.
- `setNoFromOrderNo(orderNo)` → `"01"`.

## Flows

- **Create from a generator template with a set definition:** one action creates the Main
  (`GEN-0726-NN`, `set_no`, `trailer_letter` from default or planner override via ThemedSelect
  fed by the catalog) AND the PM order (`PM-0726-NN`, same NN/set_no, `main_order_id`, lines
  copied from the PM template). Both land as drafts; success toast names both numbers.
- **Trailer supermarket order:** creating from a trailer template (or picking type trailer)
  asks for the config letter (catalog select) and numbers it `TRL-0726-{letter}`; a duplicate
  in the month is surfaced as "TRL-0726-A already exists — raise its quantity instead" (23505 mapped).
- **Board:** new "Set / TRL" column: Mains show `SET 01 · A`, PMs show `SET 01 → GEN-0726-01`
  (link), trailers show their letter chip.
- **Detail/print:** Mains pass `match` (set_no, paired PM order_no via `main_order_id` reverse
  lookup, trailer_letter + catalog name) into `WorkOrderPrintDocument` — live preview and both
  print routes show the strip.
- **Settings:** "Trailer configurations" section (letter, name, optional template link; add/edit/
  retire=delete with confirm). Template library: generator templates get PM-template picker +
  default-letter select.

## Out of scope

BC-BOM-derived PM templates (import/author via existing tools instead); renumbering existing
`WO-…` orders; PM→Main navigation beyond the board link; multi-PM sets.

## Testing

Domain: new prefix/MMYY/shared-sequence/trailer-letter tests replace-extend existing numbering
tests. Store/UI: repo convention (no component tests); verification gate + live smoke.
