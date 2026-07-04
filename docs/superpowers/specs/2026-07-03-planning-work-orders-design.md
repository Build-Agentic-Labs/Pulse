# Planning Space: Digital Work-Order System — Design

**Date:** 2026-07-03
**Status:** Approved pending user review
**Approach:** Native work-order module in the Planning space (Approach A)

## Problem

The planner creates make-to-stock work orders by hand in Excel (`MTS Work Orders Master` workbook: ~48 template sheets + a 9,000-row Business Central item export). For each order he copies a template sheet, types item numbers from the product's BOM, copies Assembly Order numbers ("A-numbers") out of Business Central by hand, prints the sheet, and hands it to production. Shipped quantities are penciled in on paper. There is no digital record, no status visibility, and the process is slow and error-prone.

## Constraints (agreed)

- **Business Central access is file-export only.** No API. BOMs, the item master, and assembly orders live in BC; Pulse ingests exports the planner uploads. A-numbers are still minted in BC and entered into Pulse manually.
- **V1 scope: create + print + track.** Work orders are built from templates, printed for the floor, and tracked through statuses in Pulse. Floor-side data entry (workers updating shipped quantities from a tablet) is out of scope for v1.
- **Work orders are initiated manually.** The production-schedule spreadsheet stays outside Pulse in v1; importing it is a later phase.
- **Template library is seeded by importing the existing workbook** (one-time importer for all ~48 sheets).
- **Printed output is a cleaner redesign** carrying the same information as today's sheet.
- **Order numbering restarts at 1 each month** (planner request: "for each month we will start with 1").
- **Planning is permission-gated.** Non-admin users need an explicit admin-granted permission to access the space.
- **Theme fidelity.** No new fonts, colors, or component styles. Planning is built entirely from existing design tokens (`--color-*`, `--type-*`), existing `ui-*` classes (`ui-panel`, `ui-mono-label`, `ui-btn-*`, themed selects, `nothing-ui` primitives), and the existing space header shell. Anything genuinely new extends the design system deliberately; no one-off inline styles.

## Source workbook facts (verified by parsing)

- 49 sheets: ~48 work-order templates + 1 `DATA` sheet (BC item export: `No. / Description / Vendor No.`, 9,034 rows).
- Template sheets follow `<TYPE> <MODEL> <CUSTOMER>` naming (e.g. `HEAD UNIT 70-40 UR`, `ACC 25-25 ES`, `SDG25 Red D Ark`), with types: head unit, accessories (ACC), decal, trailer, rework, and a generic `AO-TEMPLATE` (make-to-stock with `Order Date` / `Order Number`, format `MTS-0705-02`).
- Sheet layout: title row (customer + type) → model (e.g. `BOSS70-40`) → line blocks of 4 rows: item no + A-number + build qty + blank shipped qty, with the item description on the following row → `Notes:` row (often a destination city).
- A-number cell values are either a direct number (`A35987`) or a reference (`PULL FROM A35132`, `PULL FROM STOCK A35731`).

## Data model

Four new workspace-scoped tables. RLS follows the existing workspace-membership pattern plus the new space gate (below).

### `item_master`
| column | notes |
|---|---|
| `workspace_id` | FK workspaces |
| `item_no` | unique per workspace |
| `description` | |
| `vendor_no` | nullable |
| `updated_at` | |

Refreshed by re-uploading a BC export; upserts by `item_no`. Used for item-number autocomplete and description auto-fill.

### `work_order_templates` + `work_order_template_lines`
Templates: `name`, `customer`, `model`, `order_type` (`head_unit | accessories | decal | trailer | rework | mts`), `notes_default`, `retired_at` (soft retire).
Lines: `item_no`, `description` (snapshotted), `build_qty`, `position`.

Templates carry **item lists and quantities only** — no A-numbers (those belong to orders). Descriptions are snapshotted so item-master re-uploads never mutate templates.

### `work_orders` + `work_order_lines`
Orders: `order_no` (unique per workspace), `template_id` (nullable, provenance only), `customer`, `model`, `order_type`, `status`, `order_date`, `notes`, `created_by`, and status timestamps (`released_at`, `production_started_at`, `shipped_at`, `cancelled_at`).
Lines: `item_no`, `description` (snapshotted), `build_qty`, `shipped_qty` (nullable), `fulfillment` (`assembly | pull_from | pull_from_stock`), `assembly_order_no` (nullable A-number), `pull_from_ref` (referenced A# for pull lines), `position`.

Decisions:
1. **Line descriptions are snapshots**, never live joins — a printed order must not change retroactively.
2. **Customer/model are plain text** with autocomplete from prior values. No lookup tables (YAGNI; ~10 customers).
3. **Creating an order copies template lines**; editing a template never touches existing orders.
4. **Statuses:** `draft → released → in_production → shipped`, plus `cancelled`. Forward-only for editors; admins may step back one status. Transitions validated server-side.

### Order numbering
Format **`WO-YYMM-NN`** (e.g. `WO-2607-01`), sequence resets each month. The month bucket derives from `order_date`, so backdated orders join that month's series. Pulse suggests the next number at creation; the field stays editable with a uniqueness guard, and collisions retry with the next sequence.

## Access gating

New generic table **`space_access`**: `workspace_id`, `user_id`, `space` (text, `'planning'` in v1), `granted_by`, `created_at`; PK `(workspace_id, user_id, space)`. Designed to be reused when Production/MES ships.

- **Owners/admins implicitly have every space.** Editors/viewers need a grant.
- **RLS is the real gate:** one shared SQL helper (`has_space_access(workspace_id, space)`) used by all planning tables. Reads require membership + (admin/owner role OR grant). Writes additionally respect workspace role: a viewer-role user with a grant is read-only.
- **Route shell:** `/planning` checks access before rendering; without it, a clean "Planning requires access — ask a workspace admin" screen.
- **Dashboard:** the Planning card renders locked (padlock, subdued) for users without access rather than disappearing.
- **Admin UI:** the existing workspace-members settings panel gains a per-member Planning access toggle; grants record `granted_by`.

## Screens

All inside the Planning space, using the existing space header (back-to-dashboard, wordmark, space label, `UserNav`).

1. **Work-order board** (`/planning`) — table of orders: order no, customer, model, type, status chip, order date, A#-completeness indicator ("3 lines missing A#"). Filters: status, customer, month; search by order no / item no. **Checkbox selection → "Print selected."** Primary action: New work order.
2. **New work order** — single screen: searchable template picker (grouped by model, shows customer + type) → pre-fills lines → adjust quantities, order date, notes → auto-suggested order no → save as draft. Blank-start option for one-offs (rework).
3. **Work-order detail** — header with status + transition action (Release / Start production / Mark shipped); line table with item-no autocomplete, auto-filled editable description, build qty, fulfillment type, A-number field (missing A#s highlighted; order badge until all assembly lines have one). Shipped-qty column unlocks at `in_production`. Print button → preview.
4. **Print preview** (`/planning/work-orders/[id]/print`) — the exact printable document rendered on screen with a Print button. **Batch route** takes `?ids=…` and stacks N documents with CSS page breaks — one dialog prints the whole stack.
5. **Settings drawer** — item-master upload (preview + "12 added, 3 updated" report), one-time workbook import (per-sheet parse preview before commit), template library (view/edit/duplicate/retire).

## Imports

- **Workbook importer (one-time seed):** server-side parse with `read-excel-file` (existing dependency; verified against the real workbook). Extracts customer/type from the title row, model, and the 4-row line blocks. Skips the `DATA` sheet; strips A-numbers (templates don't carry them). Preview lists what each sheet parsed into and flags unparseable sheets explicitly — nothing silently dropped. Commit is transactional.
- **Item-master upload (recurring):** xlsx/csv with `No. / Description / Vendor No.`. Upserts by item no; rows without an item no are rejected with row numbers. All-or-nothing per file.

## Printing

Dedicated print routes render server-driven HTML with print CSS (`@page` margins, no app chrome): customer + order-type header, order no + date, model, line table with signature-style blanks in the Shipped column, notes block. Same type stack as the app (Space Grotesk / Space Mono). Browser print → paper or PDF; no PDF library dependency. This matches how Pulse already prints (QR/photo flows).

## Error handling

- Imports: transactional per file; human-readable failure lists with row/sheet references.
- Order numbers: unique constraint; collision retries with next sequence.
- Template deletion/retirement never affects existing orders.
- Status transitions validated server-side (e.g. cannot ship a draft).
- All user-facing errors use existing feedback components; detailed context logged server-side.

## Testing

Vitest (existing setup):
- **Sheet parser** — fixtures cut from the real workbook (title-row variants, 4-row blocks, `PULL FROM` parsing, malformed sheets).
- **Order-number sequencer** — month rollover, backdating, collision retry.
- **Status-transition rules** — allowed/blocked moves per role.
- **A#-completeness logic** — line-level and order-badge derivation.
- **Access gate** — helper logic for role/grant combinations.

## Out of scope (v1)

Production-schedule import, floor-side shipped-quantity entry, BC API integration, full BOM modeling / MRP explosion, customer/model lookup tables. The item-master table and per-line `assembly_order_no` field are the deliberate seams for BC integration later.
