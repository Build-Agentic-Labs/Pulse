# Planning: Production Schedule → Work Orders

**Date:** 2026-07-21
**Status:** 🟡 Designed — approved section by section, implementation plan next
**Builds on:** `2026-07-06-work-order-sets-design.md` (shipped) · `2026-07-07-schedule-import-hardening.md` (resolver hardened, importer deferred) · `anacorp-product-nomenclature` (memory)
**Resolves:** the open CLAUDE.md question on `src/domain/schedule-import.ts` — *"decide to finish or delete"*. Answer: finish the sheet-parsing half, delete the customer-resolution half.

---

## Purpose

Today Pulse Planning is a work-order **generator** sitting beside the monthly production
schedule, not connected to it. The planner reads a row in Excel, retypes four fields into
Pulse, gets a work-order number, and retypes that number back into the spreadsheet. The
spreadsheet stays the system of record and every link between a schedule line and a physical
unit lives in a human's copy-paste.

This spec connects them: **upload the schedule, resolve each line against a SKU-keyed
configuration catalog, create and approve work orders, print travelers, and hand back a
single copy-paste column of generator work-order IDs** to paste into the schedule.

### Explicitly out of scope

- **Production execution** and the `/production` space.
- **QC / the `1-1-A` match check.** Downstream of this tool. `getWorkOrderMatch` and
  `WorkOrderMatchInfo` stay in the codebase untouched and unextended.
- **Serial-level genealogy.** `1-1-A` is a *configuration* (which trailer config a unit takes),
  not an identity of specific physical parts.
- **Batch work-order creation.** Single work order at a time in this pass. The design does not
  preclude batch later: `createGenPmSet` and the export column both already operate per-row.

---

## The flow

```
                 ┌─────────────── PULSE PLANNING ────────────────┐
Monthly          │                                               │
production   →   │  SALES ORDERS      WORK ORDERS      CONFIG    │
schedule         │  upload + parse    select SO#,      SKU → BOM │
(.xlsx)          │  → sales orders    verify, draft    parts list│
     ↑           │                         ↓                     │
     │           │                    approve → official number   │
     │           │                         ↓                     │
     └───────────┤   copy-paste GEN column      print travelers ──┼──→ floor
   planner pastes└───────────────────────────────────────────────┘
```

---

## Decisions (locked)

| # | Decision | Rationale |
|---|---|---|
| D1 | **One SKU → one BOM.** A different customer means a different SKU and a different BOM. | Customer is encoded in the SKU, so resolution is a dictionary lookup, not fuzzy matching. Deletes `normalizeCustomer` and the whole customer-variant failure class. |
| D2 | **One schedule line → GEN + PM.** The ACC SKU's parts append as *lines on the GEN order*, not a separate ACC order. | User decision (option B). `pm_template_id` already models the GEN↔PM pairing. |
| D3 | **Trailers stay a supermarket.** `TRL-MMYY-{LETTER}` remains one standing order per config letter per month that keeps trailers building. The GEN order carries `trailer_letter`; assembly matches it against supermarket stock. | Matches existing code exactly. `1-1-A`'s `A` is a config letter, not a serial. |
| D4 | **Paste only the GEN number.** One column. | GEN drives everything; PM shares the same `NN`, and the trailer is a letter on the GEN order. |
| D5 | **N1 — official number minted at approval.** Drafts carry a provisional `D-MMYY-NN`; `GEN-MMYY-NN` is allocated when the planner approves. | The only option that *guarantees* a contiguous official sequence, since discarding a draft then costs nothing. Production builds in number order. |
| D6 | **Approach A — nested layout + real routes.** | Idiomatic App Router; fixes the existing per-route auth re-mount; keeps server-first first paint. |
| D7 | **Trailer letters become A/B/C/D.** | Data change in the existing `trailer_configs` catalog (currently `E`/`S`). No code change. |

---

## §1 — Architecture & routing

```
app/planning/
  layout.tsx                 ← NEW  provider + sidebar, mounted once
  page.tsx                   ← work-order board (URL unchanged)
  sales-orders/page.tsx      ← NEW
  configuration/page.tsx     ← NEW
  work-orders/new/page.tsx   ← same URL, contents rewritten
  work-orders/[id]/…         ← unchanged
  print/page.tsx             ← unchanged
```

`app/planning/layout.tsx` is a **server component**: it performs the one
`fetchInitialWorkspaceGroups()` call, wraps children in `PlanningWorkspaceProvider` + the
access gate, and renders the sidebar beside `{children}`. Because App Router layouts do not
re-render when navigating between their children, auth runs **once** for the space and the
sidebar never blinks — the same fix `app/sops/layout.tsx` made for Quality.

A client component may receive server components as `children` and render them without
converting them to client components — children arrive as already-rendered React payload. That
is what lets the client provider wrap server-component pages.

**Layout shape** — sidebar full-height left, each page owning its own header in the content
column. The header is deliberately *not* spanned across the top (unlike `SopShell`): the detail
page needs its own back arrow, `wide` mode and action buttons, and a spanning header would
require a slot mechanism to pass those from page up to layout.

```
┌──────────┬────────────────────────────┐
│          │  ← Pulse | Planning · …    │  page header (PlanningShell)
│ Sidebar  ├────────────────────────────┤
│ (layout) │  page content, scrolls     │
└──────────┴────────────────────────────┘
```

**New files**
- `app/planning/layout.tsx` — server component; fetch + providers + sidebar
- `src/components/planning/planning-nav.tsx` — `"use client"` (needs `usePathname()` for active
  state). Built from `ui-nav-item` / `ui-nav-item-active` / `ui-nav-item-idle` / `ui-nav-section`
  + `NavSelectionTrack`, identical to the Quality sidebar.

**Modified**
- `planning-shell.tsx` — drops its `h-[100dvh]` outer wrapper (layout owns full height); keeps
  header, `backHref`, `wide`, `actions` unchanged.
- `planning-route.tsx` — the per-page gating wrapper dissolves into the layout.

**Nav** — flow order, configuration separated as reference data:

```
PLANNING
  Sales orders            /planning/sales-orders
  Work orders             /planning
SETUP
  Product configuration   /planning/configuration
```

`/planning` stays the board so existing links, print routes and bookmarks keep working.

---

## §2 — Data model

**RLS, one sentence, identical to the existing planning tables:** every new table is
readable by anyone with Planning space access in that workspace
(`has_space_access(workspace_id, 'planning')`), and writable by owner/admin/editor holding
that access (`has_workspace_role(workspace_id, array['owner','admin','editor'])`).

### New tables

**`schedule_imports`** — one row per uploaded file.

| column | notes |
|---|---|
| `id` | uuid pk |
| `workspace_id` | text, FK |
| `file_name` | source workbook |
| `sheet_name` | which sheet was imported |
| `first_row_no` / `last_row_no` | the 1-based spreadsheet row range — drives the export column |
| `row_count` | rows read |
| `imported_at` / `imported_by` | audit |

Earns its place because the copy-paste column is scoped to *an upload*: pasting safely
requires knowing the batch was rows 4–215 of a named file.

**`sales_orders`** — one row per `S-ORD####`, unique per workspace.

| column | notes |
|---|---|
| `id` | uuid pk |
| `workspace_id` | text, FK |
| `so_no` | unique per workspace |
| `customer` | as read from the sheet |
| `created_at` / `updated_at` | |

**`sales_order_lines`** — one row per spreadsheet row; the unit-level data.

| column | notes |
|---|---|
| `id` | uuid pk |
| `workspace_id` | text, FK |
| `sales_order_id` | FK → `sales_orders` |
| `import_id` | FK → `schedule_imports` |
| `source_row_no` | **1-based original spreadsheet row — load-bearing** |
| `fg_sku` / `acc_sku` | the two config lookups |
| `trailer_letter` | resolved from the sheet's Trailer Type |
| `model_raw` / `customer_raw` | as-read, for verification display |
| `assembly_order_no` | the `A#####` |
| `status` | `pending \| flagged \| converted \| skipped` |
| `flags` | jsonb, array of `ResolutionFlag` |
| `work_order_id` | FK → `work_orders`, null until converted |

Unique on `(import_id, source_row_no)`.

**Divider rows are never stored.** A row `isSectionHeaderRow` identifies as a category label
("TRAILERS", "STOCK") is skipped at parse time and produces no `sales_order_lines` row — June
had 11 of them. Its `source_row_no` therefore has no record at all, and the export column
leaves that cell blank simply because walking the row range finds nothing for it. This is why
the export walks a *range* rather than a list.

`status` values: `pending` = resolved, awaiting a work order · `flagged` = blocked, has
blocking flags · `converted` = a work order exists (`work_order_id` set) · `skipped` = the
planner explicitly dismissed this line.

`flags` is jsonb rather than a child table: they are read as a whole, never queried
individually, and their shape is already defined by `ResolutionFlag` in domain code.

### Changed tables

**`work_orders`** — three columns:
- `sales_order_line_id` — FK, the traceability link that does not exist today
- `sales_order_no` — text snapshot, so a printed traveler keeps its SO# even if the schedule is
  later re-imported. The FK answers *"which schedule line produced this?"* (live, joinable);
  the text answers *"what did this traveler say when printed?"* (frozen).
- `draft_no` — provisional `D-MMYY-NN`, allocated at draft creation (see D5)

**`order_no` becomes nullable.** Under N1 a draft has no official number. Postgres permits
multiple NULLs under a unique index, so the existing uniqueness constraint still holds.
Existing rows keep their numbers (grandfathered).

**`work_order_templates`** — one column: `sku`, unique per workspace among non-retired rows.
This is the re-key from D1; `customer` and `model` demote to descriptive fields. No table
rename — it is already the right table, it just had the wrong key.

---

## §3 — Sales orders & Configuration manager

### Sales orders — `/planning/sales-orders`

Server component fetches the SO list for first paint; the client component seeds from it and
handles upload.

**Upload flow:** pick file → `readWorkbookFile` → choose sheet → detect header row →
**confirm column mapping** → dry-run preview → import.

- `readWorkbookFile` ([src/lib/planning/read-files.ts](../../../src/lib/planning/read-files.ts))
  reads every sheet into cell matrices in one call, lazy-imported so the xlsx reader only ships
  when someone uploads. Reused as-is; the sheet picker is nearly free because all sheets arrive
  together.
- **Column mapping is confirmed, never assumed.** June's headers are known (`MODEL TYPE`,
  `CUSTOMER`, `BRAKE TYPE`, `SO#`, `FG A#`) but a monthly file will drift, and a renamed header
  would otherwise import a whole month into the wrong fields silently. Auto-detect by fuzzy
  header match, show the planner what matched, allow remapping before import.
- **The preview is a dry run** in the shape the existing `dry-run-schedule-import.ts` produces:
  *N rows → divider rows skipped → importable → resolved / flagged*, every flag named. Nothing
  is written until confirmed.
- **Re-import:** unique on `(import_id, source_row_no)`, plus a warning when an
  `SO# + FG SKU` already has a converted work order, so re-uploading a corrected file does not
  quietly double-build.

Import writes happen in **client effects — never during an RSC render** (CLAUDE.md: server
reads are read-only; prefetches and streaming retries multi-fire).

### Configuration manager — `/planning/configuration`

**List:** SKU · name · type (Generator / PM / Accessory) · BOM line count · paired PM · retired.

**Editor:** header fields (`sku`, `name`, `order_type`, `pm_template_id`,
`default_trailer_letter`, `notes_default`) plus BOM lines (`item_no`, `description`,
`build_qty`, `position`).

- **Part picker:** a new component over `searchItems()` against `planning_item_master`.
  `BomPartSearch` is **not** reusable — it is keyed to `MasterBom` / `detectBomFieldColumns`
  from the Product space, a different catalog.
- **Retire, never delete.** `retired_at` already exists and `work_orders.template_id` points at
  these rows; deleting would orphan the provenance of every order built from a config. The
  unique index on `sku` applies only to non-retired rows, so a SKU can be superseded.
- **Trailer letter precedence:** the schedule's Trailer Type wins (via `normalizeBrake`); the
  config's `default_trailer_letter` is the fallback when the sheet cell is blank. The existing
  advisory flag `trailer-letter-unspecified` tells the planner they are getting a default.

`order_type` on the config is what makes D2 work: the FG SKU's config is `head_unit`, the ACC
SKU's is `accessories`, and create appends the accessory config's lines to the generator's
order rather than minting a second order. **Accessory lines are appended after the generator's
lines**, continuing the same `position` sequence, so a traveler reads generator BOM first and
accessories second without needing a separate marker column.

**D7 (trailer letters A/B/C/D) is a data change, not code.** The existing trailer-configs
screen edits `trailer_configs`; the catalog currently holds `E = Electric` and
`S = Surge / Hydraulic`. `normalizeBrake` maps brake strings to letters and will need its
mapping updated to whatever the four new letters mean — that is its only code change.

---

## §4 — The work-order flow

`/planning/work-orders/new` keeps its URL and loses its free-text form.

1. **Select a sales order** — searchable list of `sales_orders` with unconverted lines.
2. **Pick the line** if that SO covers more than one unit (single work order at a time).
3. **Fields fill in** from the resolved line: customer, model, trailer letter, order date, A#,
   and the BOM — FG SKU's config lines with the ACC SKU's config lines appended.
4. **Planner verifies and edits.** Anything wrong here is wrong in the schedule or the config,
   and both are fixable without leaving Planning.
5. **Save draft** → provisional `D-0726-07`.
6. **Approve** → mints `GEN-0726-05` + `PM-0726-05`, releases both.
7. **Print**, then the copy-paste column.

### Provisional identity (D5 / N1)

`order_no` nullable; `draft_no` (`D-MMYY-NN`) allocated at draft creation. Deliberately a
different prefix from `GEN-` so nothing reaching paper or a spreadsheet can be mistaken for an
official number. Gaps in the `D-` series are harmless and expected — that is the point of N1.
`set_no` is likewise assigned at approval, so the board shows `—` in the Set column until then.

**Allocation rule:** `draft_no` is max+1 among that month's drafts (same `MMYY` derivation as
`order_no`, from `order_date`). It is **retained after approval**, not cleared — an approved
order carries both `draft_no` and `order_no`, giving an audit trail from what the planner
reviewed to what was issued.

**The PM is created as a draft alongside the GEN**, not at approval — `createGenPmSet` already
creates both in one call, and the planner needs to see the PM's BOM while verifying. Only the
GEN carries a `draft_no`; the PM is identified pre-approval through `main_order_id`, exactly as
it is identified post-approval through a shared `set_no`.

`suggestOrderNo` scans only **non-draft** orders when allocating at approval. `MMYY` continues
to derive from `order_date` (the schedule's month), so contiguity is *per month of the
schedule*, not per approval date.

### Approval is a Postgres function

Approving a set must do four things atomically: scan the month's approved numbers, allocate
`NN`, stamp both GEN and PM, release both. As two client-side updates, a failure between them
leaves a numbered Main married to an unnumbered PM — a broken set and a hole in the sequence.

`approve_work_order_set(workspace_id, main_id)` as an RPC, **security invoker** so RLS still
applies, with the `23505` retry inside the function. `transitionWorkOrder` stays as-is for
every other transition.

This is a deliberate departure from the store-with-injected-client pattern. Every other write
in Planning is a single-row write where a client round-trip is safe; set approval is the only
multi-row invariant, and the database is the only place it can be enforced — the same reasoning
that puts RLS in the database rather than the UI.

⚠️ **Prerequisite:** `supabase/migrations/20260703170000_work_order_transition_guard.sql`
installs a transition trigger. It must be reviewed before this lands — it may reject a
`draft → released` transition that also mutates `order_no`.

### The copy-paste column

Lives on the **import detail** in Sales orders, because it is scoped to one uploaded file.

```
June Henderson.xlsx — rows 4–215
160 of 212 rows have approved work orders

┌──────────────┐
│ GEN-0726-01  │  ← row 4
│ GEN-0726-02  │  ← row 5
│              │  ← row 6  (divider row, skipped)
│ GEN-0726-03  │  ← row 7
│              │  ← row 8  (flagged, no config)
└──────────────┘
        [ Copy column ]
```

Generated by walking `source_row_no` from `first_row_no` to `last_row_no` — **not** by listing
created orders. Every original row gets a cell; rows without an approved order get an empty
one. Newline-separated on copy, so one paste fills the column in correct alignment. The row
range is displayed so the planner can confirm the paste target before committing.

Both construction methods produce identical output on a clean import; they diverge exactly
when something was skipped — which is precisely when a silent misalignment would cost a month
of mismatched IDs.

N1 pays off here: because only approved orders have numbers, the column can never contain a
provisional ID that later changes.

### Error handling

- **Import:** nothing writes until the dry-run preview is confirmed; a failed parse names the
  sheet and row.
- **Create:** a line whose SKU has no config is blocked with a link into the Configuration
  manager, not a dead-end message.
- **Approve:** number collision retries inside the RPC; a rejected transition surfaces the
  guard's reason.
- **Export:** if any row in range is unapproved, the count states it plainly rather than
  emitting a short column.

---

## §5 — Domain logic & testing

### `schedule-import.ts` splits

**`src/domain/planning/schedule-row.ts`** — pure sheet parsing, carried over unchanged:
`isSectionHeaderRow` · `cleanSo` · `aoStatus` · `normalizeBrake` · `parseModel` (demoted from
resolver to validator — it now confirms the SKU's model agrees with the sheet).

**`src/domain/planning/schedule-resolve.ts`** — new. `resolveScheduleLine(row, configIndex)`,
a SKU dictionary lookup returning the resolution plus flags.

**`src/domain/planning/export-column.ts`** — new.
`buildExportColumn(lines, approvedOrders, rowRange) → string[]`. Pure, no I/O. The
highest-risk logic in the feature; heaviest test coverage.

**Deleted:** `normalizeCustomer` + the nine `CUSTOMER_RULES`, `parseGenTemplateName`,
`parsePmSize`, `buildTemplateIndex`, and the combo/suffix matching inside `resolveLine` —
along with flag codes `unknown-customer`, `no-template-for-customer`,
`no-gen-template-for-combo`, `template-model-mismatch`.

**New flags:** `sku-not-configured`, `acc-sku-not-configured`, `sku-wrong-type`,
`acc-sku-wrong-type` — all blocking, all linking into the Configuration manager.
`trailer-letter-unspecified` and `ao-to-enter` survive as advisories.

**The order-type flags exist because of one specific accident:** a single-column paste shift in
the schedule puts the ACC SKU in the FG column. Without checking that the resolved config's
`order_type` suits the column it came from, that line resolves *perfectly cleanly* and builds a
"generator" work order out of an accessory parts list. A FG SKU must resolve to
`head_unit`/`power_module`/`trailer`; an ACC SKU must resolve to `accessories`.

**`unrecognized-model` is ADVISORY, not blocking** (it was blocking in the pre-SKU resolver).
Under one-SKU-one-BOM the SKU is authoritative and the model text is only a human-readable
cross-check, so unfamiliar model spelling must not stall a legitimate row — model naming drifts
month to month. The genuinely dangerous case, *the SKU itself being wrong*, is caught by the
order-type flags above rather than by parsing prose. `model-mismatch` compares parsed **kind**
as well as combo, so a standalone-PM row married to a hybrid SKU is flagged even though neither
side yields a comparable combo.

Modules are split by **phase** (parse the sheet → resolve against config → build the export),
not by entity, so each has one dependency direction and no shared state: `schedule-row.ts`
does not know configs exist; `export-column.ts` does not know Excel exists.

### Test plan

**Unit** (vitest, colocated):
- Sheet parsers — existing tests for surviving functions carry over unchanged; tests covering
  customer/template resolution retire with their code.
- `resolveScheduleLine` — SKU hit, SKU missing, ACC missing, trailer letter from sheet vs.
  config default, A# advisory.
- **`buildExportColumn`** — divider rows blank · flagged rows blank · gaps in the row range ·
  out-of-order input · duplicate `source_row_no` · empty import · single row · unapproved rows
  blank. `rowRange` is an explicit argument precisely so "rows 4–215 produce exactly 212 cells"
  is assertable without a row being present.
- Numbering — contiguity across approvals, month rollover, GEN/PM sharing one `NN`.

**Integration** (real DB):
- `approve_work_order_set` atomicity — a mid-way failure burns no number and leaves no
  half-numbered set.
- Two concurrent approvals get distinct, contiguous numbers.
- RLS on all three new tables: a user without Planning access reads nothing and writes nothing.

**E2E** (Playwright): upload a fixture sheet → preview shows expected skipped/resolved/flagged
counts → import → create a work order from an SO → verify → approve → official number appears
→ export column aligns to original rows.

**Gate before merge** (CLAUDE.md): migration applied → `npm run gen:types` → typecheck + lint +
tests green → then drive it in the browser. A green suite does not prove a rendered screen.

---

## What this deletes from the backlog

The hardening spec's residual data to-dos — *"author 25 PM / 125 PM templates"*, *"add 25-25
Kiewit/CAT and 70-45 Kiewit gen variants"* — were customer variants of a model. Under D1 they
are simply separate SKUs configured once in the Configuration manager, and the flags that
reported them become actionable work items with a UI to resolve them in.
