# Planning: Production Schedule → Work Orders — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Connect the monthly production-schedule spreadsheet to Pulse work orders — upload and parse the schedule, resolve each line against a SKU-keyed configuration catalog, create and approve work orders with contiguous official numbers, and hand back a copy-paste column of generator IDs.

**Architecture:** A nested App Router layout (`app/planning/layout.tsx`) mounts the workspace provider and a persistent side pane once for three sibling routes: Sales orders (upload/parse), Work orders (the existing board), and Product configuration (SKU → BOM). Domain logic splits by phase into three pure modules — parse the sheet, resolve against config, build the export column. Official work-order numbers are minted at approval by a Postgres RPC so the sequence is contiguous and set approval is atomic.

**Tech Stack:** Next.js 16 (App Router, Turbopack) · React 19 · Supabase (RLS-enforced) · TypeScript · Vitest · `read-excel-file` · Tailwind + `ui-*` component classes.

**Spec:** [`docs/superpowers/specs/2026-07-21-planning-schedule-to-work-order-design.md`](../specs/2026-07-21-planning-schedule-to-work-order-design.md)

## Global Constraints

- **Schema + RLS first**, then `npm run gen:types`, then queries. Commit the updated `src/lib/database.types.ts`.
- **RLS is the enforcement layer.** Every new table: read = `has_space_access(workspace_id, 'planning')`; write = that plus `has_workspace_role(workspace_id, array['owner','admin','editor']::public.workspace_role[])`.
- **Server reads are READ-ONLY.** Never mutate during an RSC render. Writes live in client effects, route handlers, or server actions.
- **Never full-state save.** New writes are granular upserts. Do not weaken `assertSaneStateDeletion`.
- **Domain logic is pure** — no React, no Supabase, no DOM — and gets a colocated `*.test.ts`.
- **Stores take an optional injected client:** `function listX(scopeId: string, client?: SupabaseClient<Database>)` with `const supabase = client ?? createPlannerSupabaseClient();`
- **`createPlannerSupabaseClient()` is browser-only.** On the server pass a per-request server client.
- **`"use client"` only for a nameable reason** — interactivity, browser APIs, realtime. "It fetches data" is not one.
- **CSS:** feature styles go in a component/route-scoped file imported by its component. Never `app/globals.css`.
- **Controlled documents use `formatDateControlled`**; UI surfaces use `formatDate`/`formatDateTime` from `@/domain/formatting`.
- **Migrations apply with** `node --env-file=.env.local scripts/apply-migration-safely.mjs <file>.sql`.
- **Tests:** `npm run test` (vitest). **Typecheck:** `npm run typecheck`. **Lint:** `npm run lint` (`--max-warnings=0`).
- Existing `ui-*` classes only for chrome — `ui-nav-item`, `ui-nav-item-active`, `ui-nav-item-idle`, `ui-nav-section`, `ui-panel`, `ui-btn-ghost`, `ui-mono-label`, `ui-input`. No new global classes.

---

## File Structure

| File | Responsibility |
|---|---|
| `supabase/migrations/20260721120000_planning_sales_orders.sql` | 3 new tables + RLS, `work_orders` columns, `work_order_templates.sku` |
| `supabase/migrations/20260721130000_approve_work_order_set.sql` | The approval RPC |
| `app/planning/layout.tsx` | Provider + side pane, mounted once (server component) |
| `app/planning/sales-orders/page.tsx` | Sales orders route (server first paint) |
| `app/planning/configuration/page.tsx` | Configuration route (server first paint) |
| `src/components/planning/planning-nav.tsx` | The side pane nav (client — needs `usePathname`) |
| `src/domain/planning/schedule-row.ts` | Pure sheet parsing (carried from `schedule-import.ts`) |
| `src/domain/planning/schedule-resolve.ts` | SKU → config resolution + flags |
| `src/domain/planning/export-column.ts` | The copy-paste column (pure, highest-risk) |
| `src/lib/planning/sales-order-store.ts` | Imports, sales orders, lines |
| `src/lib/planning/config-store.ts` | SKU-keyed configs + BOM lines |
| `src/components/planning/sales-orders-workspace.tsx` | Upload → map → preview → import |
| `src/components/planning/configuration-workspace.tsx` | SKU config list + editor |
| `src/components/planning/export-column-panel.tsx` | The copy-paste column UI |

`src/domain/schedule-import.ts` is **deleted** at Task 3 after its surviving functions move.

---

## Task 1: Schema, RLS, and generated types

> ✅ **DONE** — commit `2516148`, corrections in `20260721121000_planning_sales_orders_constraints.sql`.
>
> ⚠️ **The inline SQL below is WRONG and is kept only as a record of intent.** It declares `uuid`
> primary keys; every existing planning table uses `text` with `gen_random_uuid()::text`, so this
> SQL would fail against `work_orders.id`. Step 2 caught it. **The applied, correct migration is
> `supabase/migrations/20260721120000_planning_sales_orders.sql` — read that, not this block.**
>
> Gate review also added, in the follow-up migration: `set_updated_at` triggers on both new
> tables (missed; every other planning table has one), a case/trim-normalized unique index on
> `sales_orders.so_no`, a `draft_no` uniqueness backstop, and check constraints for row-range
> sanity, `flags` being a JSON array, and `converted` lines naming their work order.

**Files:**
- Create: `supabase/migrations/20260721120000_planning_sales_orders.sql`
- Modify: `src/lib/database.types.ts` (generated)

**Interfaces:**
- Consumes: existing `public.has_space_access`, `public.has_workspace_role`, `public.workspace_role`
- Produces: tables `schedule_imports`, `sales_orders`, `sales_order_lines`; columns `work_orders.sales_order_line_id`, `work_orders.sales_order_no`, `work_orders.draft_no`, `work_orders.order_no` (now nullable), `work_order_templates.sku`

- [ ] **Step 1: Write the migration**

```sql
-- Planning: production-schedule import → sales orders → work orders.
-- Apply with: node --env-file=.env.local scripts/apply-migration-safely.mjs 20260721120000_planning_sales_orders.sql
--
-- Additive only. RLS mirrors the existing planning tables exactly: read requires Planning
-- space access; write additionally requires owner/admin/editor.

create table if not exists public.schedule_imports (
  id uuid primary key default gen_random_uuid(),
  workspace_id text not null references public.workspaces(id) on delete cascade,
  file_name text not null default '',
  sheet_name text not null default '',
  first_row_no integer not null default 0,
  last_row_no integer not null default 0,
  row_count integer not null default 0,
  imported_at timestamptz not null default now(),
  imported_by uuid references auth.users(id) on delete set null
);
create index if not exists schedule_imports_workspace_idx
  on public.schedule_imports(workspace_id, imported_at desc);

create table if not exists public.sales_orders (
  id uuid primary key default gen_random_uuid(),
  workspace_id text not null references public.workspaces(id) on delete cascade,
  so_no text not null,
  customer text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint sales_orders_no_unique unique (workspace_id, so_no)
);
create index if not exists sales_orders_workspace_idx on public.sales_orders(workspace_id);

create table if not exists public.sales_order_lines (
  id uuid primary key default gen_random_uuid(),
  workspace_id text not null references public.workspaces(id) on delete cascade,
  sales_order_id uuid not null references public.sales_orders(id) on delete cascade,
  import_id uuid not null references public.schedule_imports(id) on delete cascade,
  source_row_no integer not null,
  fg_sku text not null default '',
  acc_sku text not null default '',
  trailer_letter text not null default '',
  model_raw text not null default '',
  customer_raw text not null default '',
  assembly_order_no text not null default '',
  status text not null default 'pending',
  flags jsonb not null default '[]'::jsonb,
  work_order_id uuid references public.work_orders(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint sales_order_lines_status_known
    check (status in ('pending', 'flagged', 'converted', 'skipped')),
  constraint sales_order_lines_row_unique unique (import_id, source_row_no)
);
create index if not exists sales_order_lines_order_idx
  on public.sales_order_lines(sales_order_id);
create index if not exists sales_order_lines_import_idx
  on public.sales_order_lines(import_id, source_row_no);

-- work_orders: traceability + provisional identity (N1).
alter table public.work_orders
  add column if not exists sales_order_line_id uuid
    references public.sales_order_lines(id) on delete set null,
  add column if not exists sales_order_no text not null default '',
  add column if not exists draft_no text not null default '';
alter table public.work_orders alter column order_no drop not null;
create index if not exists work_orders_sales_order_line_idx
  on public.work_orders(sales_order_line_id);

-- work_order_templates: re-key to SKU (one SKU -> one BOM).
alter table public.work_order_templates
  add column if not exists sku text not null default '';
create unique index if not exists work_order_templates_sku_unique
  on public.work_order_templates(workspace_id, sku)
  where retired_at is null and sku <> '';

alter table public.schedule_imports enable row level security;
alter table public.sales_orders enable row level security;
alter table public.sales_order_lines enable row level security;
```

Then, for **each** of the three tables, the four policies (substitute `<T>`):

```sql
drop policy if exists "<T> read" on public.<T>;
create policy "<T> read" on public.<T>
for select to authenticated
using (public.has_space_access(workspace_id, 'planning'));

drop policy if exists "<T> write insert" on public.<T>;
create policy "<T> write insert" on public.<T>
for insert to authenticated
with check (
  public.has_space_access(workspace_id, 'planning')
  and public.has_workspace_role(workspace_id, array['owner', 'admin', 'editor']::public.workspace_role[])
);

drop policy if exists "<T> write update" on public.<T>;
create policy "<T> write update" on public.<T>
for update to authenticated
using (
  public.has_space_access(workspace_id, 'planning')
  and public.has_workspace_role(workspace_id, array['owner', 'admin', 'editor']::public.workspace_role[])
);

drop policy if exists "<T> write delete" on public.<T>;
create policy "<T> write delete" on public.<T>
for delete to authenticated
using (
  public.has_space_access(workspace_id, 'planning')
  and public.has_workspace_role(workspace_id, array['owner', 'admin', 'editor']::public.workspace_role[])
);
```

- [ ] **Step 2: Verify `workspaces.id` type before applying**

Run: `grep -n "workspaces: {" -A 8 src/lib/database.types.ts`
Expected: confirms `id` is `string`. If the existing planning tables use a different FK target or type for `workspace_id`, match them exactly — copy the column definition from `supabase/migrations/20260703150000_planning_work_orders.sql`.

- [ ] **Step 3: Apply the migration**

Run: `node --env-file=.env.local scripts/apply-migration-safely.mjs 20260721120000_planning_sales_orders.sql`
Expected: row-count snapshot unchanged, all 12 policies verified present, `COMMIT`.

- [ ] **Step 4: Regenerate types**

Run: `npm run gen:types` (needs `SUPABASE_ACCESS_TOKEN`)
Then: `npm run typecheck`
Expected: PASS. `order_no` is now `string | null` in `work_orders.Row` — if any existing code breaks on that, note it but do not fix here; Task 6 owns numbering.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20260721120000_planning_sales_orders.sql src/lib/database.types.ts
git commit -m "feat(planning): schedule import, sales order, and SKU config schema"
```

---

## Task 2: Side pane — layout, nav, and placeholder routes

**Files:**
- Create: `app/planning/layout.tsx`, `app/planning/sales-orders/page.tsx`, `app/planning/configuration/page.tsx`, `src/components/planning/planning-nav.tsx`
- Modify: `src/components/planning/planning-shell.tsx`, `app/planning/page.tsx`, `app/planning/work-orders/new/page.tsx`, `app/planning/work-orders/[id]/page.tsx`

**Interfaces:**
- Produces: `PlanningNav` (no props — reads `usePathname()`); layout guarantees `PlanningWorkspaceProvider` + access gate for every `/planning/*` route, so pages no longer wrap themselves in `PlanningRoute`.

- [ ] **Step 1: Create the nav component**

`src/components/planning/planning-nav.tsx`:

```tsx
"use client";

import { ClipboardList, FileSpreadsheet, Settings2 } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { NavSelectionTrack } from "@/components/nav-selection-track";

const ITEMS = [
  { href: "/planning/sales-orders", label: "Sales orders", Icon: FileSpreadsheet },
  { href: "/planning", label: "Work orders", Icon: ClipboardList },
] as const;

/** Which nav entry owns a pathname. `/planning` is exact; others match their subtree. */
function activeHref(pathname: string): string {
  if (pathname === "/planning" || pathname.startsWith("/planning/work-orders")) return "/planning";
  if (pathname.startsWith("/planning/sales-orders")) return "/planning/sales-orders";
  if (pathname.startsWith("/planning/configuration")) return "/planning/configuration";
  return "";
}

export function PlanningNav() {
  const active = activeHref(usePathname() ?? "");
  return (
    <>
      <div className="ui-nav-section">Planning</div>
      <NavSelectionTrack activeIndex={ITEMS.findIndex((item) => item.href === active)} className="space-y-0.5">
        {ITEMS.map(({ href, label, Icon }) => (
          <Link
            key={href}
            href={href}
            className={`ui-nav-item w-full ${active === href ? "ui-nav-item-active" : "ui-nav-item-idle"}`}
          >
            <Icon size={15} strokeWidth={1.75} />
            <span>{label}</span>
          </Link>
        ))}
      </NavSelectionTrack>
      <div className="ui-nav-section mt-3">Setup</div>
      <div className="space-y-0.5">
        <Link
          href="/planning/configuration"
          className={`ui-nav-item ${active === "/planning/configuration" ? "ui-nav-item-active" : "ui-nav-item-idle"}`}
        >
          <Settings2 size={15} strokeWidth={1.75} />
          <span>Product configuration</span>
        </Link>
      </div>
    </>
  );
}
```

- [ ] **Step 2: Create the layout**

`app/planning/layout.tsx` — server component. It fetches once, wraps children in the existing `PlanningRoute` (provider + gate), and renders the sidebar beside them.

```tsx
import type { ReactNode } from "react";
import { PlanningNav } from "@/components/planning/planning-nav";
import { PlanningRoute } from "@/components/planning/planning-route";
import { fetchInitialWorkspaceGroups } from "@/lib/supabase/server-data";

export const metadata = { title: "Planning | Pulse" };

export default async function PlanningLayout({ children }: { children: ReactNode }) {
  return (
    <PlanningRoute initialGroups={await fetchInitialWorkspaceGroups()}>
      <div className="flex h-[100dvh] overflow-hidden bg-canvas text-ink">
        <aside className="ui-nav-sidebar shrink-0 flex-col overflow-hidden">
          <nav className="flex min-h-0 flex-1 flex-col overflow-auto px-2 py-3">
            <PlanningNav />
          </nav>
        </aside>
        <div className="flex min-h-0 min-w-0 flex-1 flex-col">{children}</div>
      </div>
    </PlanningRoute>
  );
}
```

- [ ] **Step 3: Drop the full-height wrapper from `PlanningShell`**

In `src/components/planning/planning-shell.tsx`, the outer element changes — the layout now owns viewport height:

```tsx
// was: <div className="flex h-[100dvh] flex-col bg-canvas text-ink">
return (
  <div className="flex min-h-0 flex-1 flex-col bg-canvas text-ink">
```

Everything else in the component is unchanged.

- [ ] **Step 4: Stop pages from double-wrapping**

Each page under `app/planning/` currently renders `PlanningRouteShell` / `PlanningRoute`, which the layout now provides. Remove that wrapper from `app/planning/page.tsx`, `app/planning/work-orders/new/page.tsx`, and `app/planning/work-orders/[id]/page.tsx` so each renders its client component directly. Read each file first — the exact wrapper differs per page.

Create the two placeholder routes:

```tsx
// app/planning/sales-orders/page.tsx
import { PlanningShell } from "@/components/planning/planning-shell";

export const metadata = { title: "Sales orders | Pulse" };

export default function SalesOrdersPage() {
  return (
    <PlanningShell title="Sales orders">
      <section className="ui-panel p-5">
        <div className="ui-mono-label">Sales orders</div>
        <p className="mt-3 text-sm text-ink-secondary">Schedule upload lands here in Task 10.</p>
      </section>
    </PlanningShell>
  );
}
```

Same shape for `app/planning/configuration/page.tsx` with `title="Product configuration"`.

- [ ] **Step 5: Verify in the browser**

Run: `npm run typecheck && npm run lint`
Then start the preview and drive it: load `/planning`, confirm the sidebar renders with three entries and the correct one highlighted; click each entry and confirm **the sidebar does not flash or re-mount** and no "Loading" state appears between routes. Check the console for errors.

- [ ] **Step 6: Commit**

```bash
git add app/planning src/components/planning/planning-nav.tsx src/components/planning/planning-shell.tsx
git commit -m "feat(planning): persistent side pane via nested layout"
```

---

## Task 3: Domain — `schedule-row.ts`

**Files:**
- Create: `src/domain/planning/schedule-row.ts`, `src/domain/planning/schedule-row.test.ts`
- Delete: `src/domain/schedule-import.ts`, `src/domain/schedule-import.test.ts`

**Interfaces:**
- Produces: `parseModel(model: string): ParsedModel` · `normalizeBrake(raw: string): TrailerLetter | "none"` · `cleanSo(raw: string): { so: string; flag: boolean }` · `aoStatus(raw: string): "ok" | "flag"` · `isSectionHeaderRow(fields: { model: string; so: string; customer: string; fgAo: string }): boolean` · types `ParsedModel`, `ModelKind`, `TrailerLetter`

- [ ] **Step 1: Move the surviving functions verbatim**

Copy `parseModel`, `normalizeBrake`, `cleanSo`, `aoStatus`, `isSectionHeaderRow` and the types `ModelKind`, `ParsedModel`, `TrailerLetter` from `src/domain/schedule-import.ts` into `src/domain/planning/schedule-row.ts`, unchanged. Update the file header comment to say it parses one production-schedule row into typed fields and knows nothing about configs.

Do **not** copy: `normalizeCustomer`, `CUSTOMER_RULES`, `squash`, `words`, `CustomerIdentity`, `parseGenTemplateName`, `comboFromModel`, `parsePmSize`, `buildTemplateIndex`, `resolveLine`, `TemplateRow`, `TemplateIndex*`, `LineResolution`, `ResolutionFlag`, `FlagCode`, `ScheduleLineInput`, `advisory`, `blocking`.

- [ ] **Step 2: Move the surviving tests verbatim**

Copy the `describe` blocks for `parseModel`, `normalizeBrake`, `cleanSo`, `aoStatus`, and `isSectionHeaderRow` from `src/domain/schedule-import.test.ts` into `src/domain/planning/schedule-row.test.ts`, changing only the import path to `./schedule-row`. Leave the assertions untouched — they are the regression guarantee that the move changed no behavior.

- [ ] **Step 3: Run the moved tests**

Run: `npm run test -- src/domain/planning/schedule-row.test.ts`
Expected: PASS, same count as the original file's blocks for those five functions.

- [ ] **Step 4: Delete the old module**

```bash
git rm src/domain/schedule-import.ts src/domain/schedule-import.test.ts
```

Run: `npm run typecheck`
Expected: PASS. Nothing imported `schedule-import` (verified: zero callers), so nothing should break. If anything does, it is a caller added after this plan was written — fix the import to `@/domain/planning/schedule-row`.

- [ ] **Step 5: Commit**

```bash
git add src/domain/planning/schedule-row.ts src/domain/planning/schedule-row.test.ts
git commit -m "refactor(planning): split sheet parsing out of schedule-import

Keeps parseModel/normalizeBrake/cleanSo/aoStatus/isSectionHeaderRow with their
tests; drops customer + template resolution, obsoleted by SKU-keyed configs."
```

---

## Task 4: Domain — `schedule-resolve.ts`

**Files:**
- Create: `src/domain/planning/schedule-resolve.ts`, `src/domain/planning/schedule-resolve.test.ts`

**Interfaces:**
- Consumes: `parseModel`, `normalizeBrake`, `cleanSo`, `aoStatus` from `./schedule-row`
- Produces:

```ts
export type FlagCode =
  | "blank-model" | "unrecognized-model" | "sku-not-configured"
  | "acc-sku-not-configured" | "trailer-letter-unspecified"
  | "trailer-config-missing" | "ao-to-enter" | "so-missing" | "model-mismatch";

export interface ResolutionFlag { code: FlagCode; blocking: boolean; detail: string }

export interface ConfigEntry {
  id: string; sku: string; orderType: string;
  model: string; pmConfigId: string | null; defaultTrailerLetter: string;
}
export interface ConfigIndex {
  bySku: ReadonlyMap<string, ConfigEntry>;
  trailerLetters: ReadonlySet<string>;
}
export function buildConfigIndex(
  entries: readonly ConfigEntry[], trailerLetters: readonly string[]
): ConfigIndex;

export interface ScheduleRowInput {
  model: string; customer: string; brake: string;
  fgSku: string; accSku: string; so: string; fgAo: string;
}
export interface LineResolution {
  status: "resolved" | "flagged";
  so: string; customer: string; model: string;
  fgSku: string; accSku: string;
  genConfigId?: string; pmConfigId?: string | null; accConfigId?: string;
  trailerLetter: string; assemblyOrderNo: string;
  flags: readonly ResolutionFlag[];
}
export function resolveScheduleLine(row: ScheduleRowInput, index: ConfigIndex): LineResolution;
```

- [ ] **Step 1: Write the failing tests**

`src/domain/planning/schedule-resolve.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { buildConfigIndex, resolveScheduleLine, type ConfigEntry } from "./schedule-resolve";

const GEN: ConfigEntry = {
  id: "cfg-gen", sku: "FG-7040-ES", orderType: "head_unit",
  model: "EBOSS70-40", pmConfigId: "cfg-pm", defaultTrailerLetter: "B",
};
const ACC: ConfigEntry = {
  id: "cfg-acc", sku: "ACC-STD", orderType: "accessories",
  model: "", pmConfigId: null, defaultTrailerLetter: "",
};
const index = buildConfigIndex([GEN, ACC], ["A", "B", "C", "D"]);

const row = {
  model: "EBOSS70-40", customer: "Equipment Share", brake: "Electric",
  fgSku: "FG-7040-ES", accSku: "ACC-STD", so: "S-ORD1234", fgAo: "A12345",
};

describe("resolveScheduleLine", () => {
  it("resolves a fully configured line with no flags", () => {
    const result = resolveScheduleLine(row, index);
    expect(result.status).toBe("resolved");
    expect(result.genConfigId).toBe("cfg-gen");
    expect(result.pmConfigId).toBe("cfg-pm");
    expect(result.accConfigId).toBe("cfg-acc");
    expect(result.so).toBe("S-ORD1234");
    expect(result.assemblyOrderNo).toBe("A12345");
    expect(result.flags).toEqual([]);
  });

  it("blocks when the FG SKU has no config", () => {
    const result = resolveScheduleLine({ ...row, fgSku: "FG-NOPE" }, index);
    expect(result.status).toBe("flagged");
    expect(result.flags).toContainEqual(
      expect.objectContaining({ code: "sku-not-configured", blocking: true }),
    );
  });

  it("blocks when a stated ACC SKU has no config", () => {
    const result = resolveScheduleLine({ ...row, accSku: "ACC-NOPE" }, index);
    expect(result.status).toBe("flagged");
    expect(result.flags).toContainEqual(
      expect.objectContaining({ code: "acc-sku-not-configured", blocking: true }),
    );
  });

  it("treats a blank ACC SKU as no accessories, not an error", () => {
    const result = resolveScheduleLine({ ...row, accSku: "" }, index);
    expect(result.status).toBe("resolved");
    expect(result.accConfigId).toBeUndefined();
    expect(result.flags).toEqual([]);
  });

  it("takes the trailer letter from the sheet's brake when present", () => {
    expect(resolveScheduleLine(row, index).trailerLetter).toBe("E");
  });

  it("falls back to the config default and flags an advisory when brake is blank", () => {
    const result = resolveScheduleLine({ ...row, brake: "" }, index);
    expect(result.trailerLetter).toBe("B");
    expect(result.status).toBe("resolved");
    expect(result.flags).toContainEqual(
      expect.objectContaining({ code: "trailer-letter-unspecified", blocking: false }),
    );
  });

  it("advises when the A# is missing but still resolves", () => {
    const result = resolveScheduleLine({ ...row, fgAo: "NEED" }, index);
    expect(result.status).toBe("resolved");
    expect(result.flags).toContainEqual(
      expect.objectContaining({ code: "ao-to-enter", blocking: false }),
    );
  });

  it("advises when the SO number is missing", () => {
    const result = resolveScheduleLine({ ...row, so: "NEED" }, index);
    expect(result.flags).toContainEqual(
      expect.objectContaining({ code: "so-missing", blocking: false }),
    );
  });

  it("advises when the sheet model disagrees with the config's model", () => {
    const result = resolveScheduleLine({ ...row, model: "EBOSS25-25" }, index);
    expect(result.flags).toContainEqual(
      expect.objectContaining({ code: "model-mismatch", blocking: false }),
    );
  });

  it("flags a resolved letter that the trailer catalog does not contain", () => {
    const narrow = buildConfigIndex([GEN, ACC], ["A"]);
    const result = resolveScheduleLine(row, narrow);
    expect(result.flags).toContainEqual(
      expect.objectContaining({ code: "trailer-config-missing", blocking: false }),
    );
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm run test -- src/domain/planning/schedule-resolve.test.ts`
Expected: FAIL — `Failed to resolve import "./schedule-resolve"`.

- [ ] **Step 3: Implement**

Write `src/domain/planning/schedule-resolve.ts` to the interface above. Implementation notes that the tests pin down:
- `buildConfigIndex` builds `bySku` keyed on the **trimmed, upper-cased** SKU; do the same normalization on lookup so casing in the sheet does not matter.
- Blocking flags: `blank-model`, `unrecognized-model`, `sku-not-configured`, `acc-sku-not-configured`. Everything else is advisory.
- `status` is `"flagged"` iff any flag has `blocking: true` — reuse the `finalize` pattern from the old `resolveLine`.
- Trailer letter: `normalizeBrake(row.brake)`; if `"none"`, fall back to the gen config's `defaultTrailerLetter` and push the `trailer-letter-unspecified` advisory. Then, if the resulting letter is non-empty and not in `index.trailerLetters`, push `trailer-config-missing`.
- `model-mismatch` compares `parseModel(row.model).raw` against the config's `model` only when both are non-empty.
- `so` comes from `cleanSo(row.so)`; its `flag` becomes the `so-missing` advisory.

- [ ] **Step 4: Run to verify it passes**

Run: `npm run test -- src/domain/planning/schedule-resolve.test.ts`
Expected: PASS, 10 tests.

- [ ] **Step 5: Commit**

```bash
git add src/domain/planning/schedule-resolve.ts src/domain/planning/schedule-resolve.test.ts
git commit -m "feat(planning): resolve schedule lines against SKU-keyed configs"
```

---

## Task 5: Domain — `export-column.ts`

**Files:**
- Create: `src/domain/planning/export-column.ts`, `src/domain/planning/export-column.test.ts`

**Interfaces:**
- Produces:

```ts
export interface ExportRow { sourceRowNo: number; orderNo: string | null }
export interface RowRange { first: number; last: number }
export interface ExportColumn {
  cells: readonly string[];
  filled: number;
  total: number;
}
export function buildExportColumn(rows: readonly ExportRow[], range: RowRange): ExportColumn;
export function exportColumnText(column: ExportColumn): string;
```

- [ ] **Step 1: Write the failing tests**

`src/domain/planning/export-column.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { buildExportColumn, exportColumnText } from "./export-column";

describe("buildExportColumn", () => {
  it("emits one cell per row in the range, in row order", () => {
    const column = buildExportColumn(
      [
        { sourceRowNo: 4, orderNo: "GEN-0726-01" },
        { sourceRowNo: 5, orderNo: "GEN-0726-02" },
      ],
      { first: 4, last: 5 },
    );
    expect(column.cells).toEqual(["GEN-0726-01", "GEN-0726-02"]);
    expect(column.total).toBe(2);
    expect(column.filled).toBe(2);
  });

  it("leaves a blank cell for a row with no record at all (divider row)", () => {
    const column = buildExportColumn(
      [
        { sourceRowNo: 4, orderNo: "GEN-0726-01" },
        { sourceRowNo: 6, orderNo: "GEN-0726-02" },
      ],
      { first: 4, last: 6 },
    );
    expect(column.cells).toEqual(["GEN-0726-01", "", "GEN-0726-02"]);
    expect(column.filled).toBe(2);
    expect(column.total).toBe(3);
  });

  it("leaves a blank cell for a row whose order is not yet approved", () => {
    const column = buildExportColumn(
      [
        { sourceRowNo: 4, orderNo: "GEN-0726-01" },
        { sourceRowNo: 5, orderNo: null },
      ],
      { first: 4, last: 5 },
    );
    expect(column.cells).toEqual(["GEN-0726-01", ""]);
    expect(column.filled).toBe(1);
  });

  it("is insensitive to input ordering", () => {
    const column = buildExportColumn(
      [
        { sourceRowNo: 6, orderNo: "GEN-0726-03" },
        { sourceRowNo: 4, orderNo: "GEN-0726-01" },
        { sourceRowNo: 5, orderNo: "GEN-0726-02" },
      ],
      { first: 4, last: 6 },
    );
    expect(column.cells).toEqual(["GEN-0726-01", "GEN-0726-02", "GEN-0726-03"]);
  });

  it("ignores rows outside the range rather than shifting the column", () => {
    const column = buildExportColumn(
      [
        { sourceRowNo: 3, orderNo: "GEN-0726-99" },
        { sourceRowNo: 4, orderNo: "GEN-0726-01" },
        { sourceRowNo: 9, orderNo: "GEN-0726-98" },
      ],
      { first: 4, last: 5 },
    );
    expect(column.cells).toEqual(["GEN-0726-01", ""]);
    expect(column.total).toBe(2);
  });

  it("keeps the first value when a source row number is duplicated", () => {
    const column = buildExportColumn(
      [
        { sourceRowNo: 4, orderNo: "GEN-0726-01" },
        { sourceRowNo: 4, orderNo: "GEN-0726-02" },
      ],
      { first: 4, last: 4 },
    );
    expect(column.cells).toEqual(["GEN-0726-01"]);
  });

  it("produces a single cell for a one-row range", () => {
    const column = buildExportColumn([{ sourceRowNo: 7, orderNo: "GEN-0726-01" }], { first: 7, last: 7 });
    expect(column.cells).toEqual(["GEN-0726-01"]);
  });

  it("produces an all-blank column of the right length when nothing is approved", () => {
    const column = buildExportColumn([], { first: 4, last: 8 });
    expect(column.cells).toEqual(["", "", "", "", ""]);
    expect(column.total).toBe(5);
    expect(column.filled).toBe(0);
  });

  it("returns an empty column for an inverted range rather than throwing", () => {
    const column = buildExportColumn([], { first: 8, last: 4 });
    expect(column.cells).toEqual([]);
    expect(column.total).toBe(0);
  });
});

describe("exportColumnText", () => {
  it("joins cells with newlines so one paste fills a spreadsheet column", () => {
    const column = buildExportColumn(
      [
        { sourceRowNo: 4, orderNo: "GEN-0726-01" },
        { sourceRowNo: 6, orderNo: "GEN-0726-02" },
      ],
      { first: 4, last: 6 },
    );
    expect(exportColumnText(column)).toBe("GEN-0726-01\n\nGEN-0726-02");
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm run test -- src/domain/planning/export-column.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```ts
// The copy-paste column handed back to the production schedule. Built by walking the
// import's ROW RANGE -- never by listing created orders -- so a skipped or flagged row
// leaves a blank cell instead of shifting every id below it up one row. That distinction
// is invisible on a clean import and catastrophic on a real one.

export interface ExportRow {
  /** 1-based row in the source spreadsheet. */
  sourceRowNo: number;
  /** The approved GEN order number, or null when the row has no approved order yet. */
  orderNo: string | null;
}

export interface RowRange {
  first: number;
  last: number;
}

export interface ExportColumn {
  /** One cell per row in the range, in row order. Blank string = nothing to paste. */
  cells: readonly string[];
  /** How many cells carry an order number. */
  filled: number;
  /** Cell count -- always `last - first + 1` for a valid range. */
  total: number;
}

/** Build the column. First value wins on a duplicated row number; out-of-range rows are ignored. */
export function buildExportColumn(rows: readonly ExportRow[], range: RowRange): ExportColumn {
  if (range.last < range.first) {
    return { cells: [], filled: 0, total: 0 };
  }

  const byRow = new Map<number, string>();
  for (const row of rows) {
    if (row.sourceRowNo < range.first || row.sourceRowNo > range.last) continue;
    if (byRow.has(row.sourceRowNo)) continue;
    if (row.orderNo) byRow.set(row.sourceRowNo, row.orderNo);
  }

  const cells: string[] = [];
  for (let rowNo = range.first; rowNo <= range.last; rowNo += 1) {
    cells.push(byRow.get(rowNo) ?? "");
  }

  return { cells, filled: byRow.size, total: cells.length };
}

/** Newline-joined, so a single clipboard paste fills one spreadsheet column. */
export function exportColumnText(column: ExportColumn): string {
  return column.cells.join("\n");
}
```

> Note on the duplicate-row test: `byRow.has()` is checked before the `orderNo` truthiness guard so that a duplicated row number with a null first entry does not let a later entry win. Verify the test passes as written; if `filled` disagrees, the guard order is the cause.

- [ ] **Step 4: Run to verify it passes**

Run: `npm run test -- src/domain/planning/export-column.test.ts`
Expected: PASS, 10 tests.

- [ ] **Step 5: Commit**

```bash
git add src/domain/planning/export-column.ts src/domain/planning/export-column.test.ts
git commit -m "feat(planning): build the schedule copy-paste column from row ranges"
```

---

## Task 6: Domain — provisional and approved numbering

**Files:**
- Modify: `src/domain/work-orders.ts`, `src/domain/work-orders.test.ts`

**Interfaces:**
- Produces: `suggestDraftNo(existingDraftNos: readonly string[], orderDate: string): string` returning `D-MMYY-NN`; `suggestOrderNo` unchanged in signature but now documented as scanning approved orders only.

- [ ] **Step 1: Write the failing tests**

Append to `src/domain/work-orders.test.ts`:

```ts
describe("suggestDraftNo", () => {
  it("starts a month's draft series at 01", () => {
    expect(suggestDraftNo([], "2026-07-15")).toBe("D-0726-01");
  });

  it("takes max + 1 within the month", () => {
    expect(suggestDraftNo(["D-0726-01", "D-0726-03"], "2026-07-15")).toBe("D-0726-04");
  });

  it("ignores other months", () => {
    expect(suggestDraftNo(["D-0626-09"], "2026-07-15")).toBe("D-0726-01");
  });

  it("ignores official order numbers", () => {
    expect(suggestDraftNo(["GEN-0726-07", "D-0726-01"], "2026-07-15")).toBe("D-0726-02");
  });

  it("tolerates malformed entries", () => {
    expect(suggestDraftNo(["D-0726-", "junk", "D-0726-02"], "2026-07-15")).toBe("D-0726-03");
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm run test -- src/domain/work-orders.test.ts`
Expected: FAIL — `suggestDraftNo is not exported`.

- [ ] **Step 3: Implement**

Add to `src/domain/work-orders.ts`:

```ts
/** Provisional draft prefix. Deliberately distinct from every ORDER_TYPE_PREFIXES value so a
 *  draft id can never be mistaken for an official work-order number on paper or in a sheet. */
export const DRAFT_PREFIX = "D";

/**
 * Next provisional draft number: `D-MMYY-NN`, restarting at 01 each month. Gaps in this series
 * are expected and harmless -- discarding a draft costs nothing, which is the whole point of
 * minting the OFFICIAL number at approval instead (see the N1 decision in the design spec).
 */
export function suggestDraftNo(existingDraftNos: readonly string[], orderDate: string): string {
  const mmyy = orderNoMonthKey(orderDate);
  const scan = `${DRAFT_PREFIX}-${mmyy}-`;
  let max = 0;
  for (const draftNo of existingDraftNos) {
    const normalized = draftNo.trim().toUpperCase();
    if (!normalized.startsWith(scan)) continue;
    const sequence = Number.parseInt(normalized.slice(scan.length), 10);
    if (Number.isFinite(sequence) && sequence > max) max = sequence;
  }
  return `${DRAFT_PREFIX}-${mmyy}-${String(max + 1).padStart(2, "0")}`;
}
```

Update `suggestOrderNo`'s doc comment to state that callers must pass only **approved** (non-draft) order numbers, since drafts have no `order_no` under N1.

- [ ] **Step 4: Run to verify it passes**

Run: `npm run test -- src/domain/work-orders.test.ts`
Expected: PASS, including the 5 new tests.

- [ ] **Step 5: Commit**

```bash
git add src/domain/work-orders.ts src/domain/work-orders.test.ts
git commit -m "feat(planning): provisional D-MMYY-NN draft numbering"
```

---

## Task 7: Store — SKU-keyed configuration

**Files:**
- Create: `src/lib/planning/config-store.ts`

**Interfaces:**
- Produces: `listConfigs(workspaceId, client?): Promise<ConfigSummary[]>` · `getConfig(workspaceId, id, client?): Promise<ConfigDetail | null>` · `saveConfig(workspaceId, input): Promise<string>` · `retireConfig(workspaceId, id): Promise<void>` · `loadConfigIndex(workspaceId, client?): Promise<ConfigIndex>` (returns the `ConfigIndex` from Task 4)

- [ ] **Step 1: Write the store**

Follow the existing `src/lib/planning/store.ts` conventions exactly: optional injected client (`const supabase = client ?? createPlannerSupabaseClient();`), explicit column projections as module constants, thrown `Error` with the Supabase message on failure, camelCase mapping at the boundary.

`loadConfigIndex` reads non-retired `work_order_templates` (`id, sku, order_type, model, pm_template_id, default_trailer_letter`) plus `trailer_configs.letter`, and returns `buildConfigIndex(entries, letters)` from `@/domain/planning/schedule-resolve`. Configs with a blank `sku` are excluded — they are legacy rows that have not been re-keyed.

`saveConfig` upserts the header then replaces its BOM lines granularly: upsert changed lines by `id`, insert new ones, delete only lines whose `id` is absent from the submitted set **and** belongs to this template. Never a full-table delete.

`retireConfig` sets `retired_at = now()`. There is no delete — `work_orders.template_id` references these rows.

- [ ] **Step 2: Typecheck**

Run: `npm run typecheck && npm run lint`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add src/lib/planning/config-store.ts
git commit -m "feat(planning): SKU-keyed configuration store"
```

---

## Task 8: Configuration manager UI

**Files:**
- Create: `src/components/planning/configuration-workspace.tsx`, `src/components/planning/planning-part-search.tsx`, `src/components/planning/configuration-workspace.css`
- Modify: `app/planning/configuration/page.tsx`

**Interfaces:**
- Consumes: `listConfigs`, `getConfig`, `saveConfig`, `retireConfig` (Task 7); `searchItems` from `@/lib/planning/store`
- Produces: `ConfigurationWorkspace({ initialConfigs }: { initialConfigs?: ConfigSummary[] })`

- [ ] **Step 1: Server page fetches the first paint**

`app/planning/configuration/page.tsx` becomes a server component using `createSupabaseServerClient()` + `auth.getUser()`, passing `initialConfigs` down. Every failure path omits the initial data so the client loads as a fallback — server fetch is an accelerant, never a dependency. Follow the `SopList` / `LineWorkspace` pattern including the `freshnessRef` seeding trick.

- [ ] **Step 2: Build the list + editor**

`ConfigurationWorkspace` is `"use client"` (form state, search). List columns: SKU · name · type · BOM lines · paired PM. Editor fields: `sku`, `name`, `order_type` (`ThemedSelect` over `WORK_ORDER_TYPE_LABELS`), `pm_template_id` (`ThemedSelect` over power-module configs), `default_trailer_letter` (`ThemedSelect` over `trailer_configs`), `notes_default`, plus a BOM line table (`item_no`, `description`, `build_qty`, drag-free `position` by row order).

`planning-part-search.tsx` is a new component over `searchItems()` — **do not** reuse `BomPartSearch`, which is keyed to the Product space's `MasterBom`. Model its UX on `BomPartSearch` (portal dropdown, keyboard nav, `MAX_RESULTS = 50`).

Styles go in `configuration-workspace.css`, imported by the component. Nothing into `app/globals.css`.

- [ ] **Step 3: Verify in the browser**

Run typecheck + lint, then drive it: create a config with a SKU and two BOM lines, reload, confirm it persisted; retire it and confirm it leaves the active list. Check the console and network tab for failures.

- [ ] **Step 4: Commit**

```bash
git add src/components/planning/configuration-workspace.tsx src/components/planning/planning-part-search.tsx src/components/planning/configuration-workspace.css app/planning/configuration/page.tsx
git commit -m "feat(planning): product configuration manager (SKU to BOM)"
```

---

## Task 9: Store — schedule imports and sales orders

**Files:**
- Create: `src/lib/planning/sales-order-store.ts`

**Interfaces:**
- Produces: `listSalesOrders(workspaceId, client?)` · `listImports(workspaceId, client?)` · `getImportLines(workspaceId, importId, client?)` · `importSchedule(workspaceId, input): Promise<{ importId: string; created: number }>` · `listUnconvertedLines(workspaceId, salesOrderId, client?)` · `markLineConverted(workspaceId, lineId, workOrderId)`

- [ ] **Step 1: Write the store**

`importSchedule` takes the already-resolved rows (resolution happens in the domain layer before the write) and, in order: inserts the `schedule_imports` row; upserts `sales_orders` by `(workspace_id, so_no)`; inserts `sales_order_lines` with `status` = `flagged` when the resolution has a blocking flag, else `pending`.

Rows whose resolution came from an `isSectionHeaderRow` are **not passed in at all** — the caller filters them, so they never occupy a `sales_order_lines` row and the export column's range walk leaves them blank naturally.

`getImportLines` returns lines joined to their work order's `order_no` and `status`, which is what feeds `buildExportColumn`.

- [ ] **Step 2: Typecheck and commit**

Run: `npm run typecheck && npm run lint`

```bash
git add src/lib/planning/sales-order-store.ts
git commit -m "feat(planning): schedule import and sales order store"
```

---

## Task 10: Sales orders UI — upload, map, preview, import

**Files:**
- Create: `src/components/planning/sales-orders-workspace.tsx`, `src/components/planning/schedule-upload.tsx`, `src/components/planning/sales-orders-workspace.css`
- Modify: `app/planning/sales-orders/page.tsx`

**Interfaces:**
- Consumes: `readWorkbookFile` from `@/lib/planning/read-files`; `resolveScheduleLine`, `buildConfigIndex` (Task 4); `isSectionHeaderRow` (Task 3); `loadConfigIndex` (Task 7); `importSchedule`, `listSalesOrders`, `listImports` (Task 9)

- [ ] **Step 1: Build the upload pipeline**

Four stages in one client component, each replacing the last:

1. **Pick file** → `readWorkbookFile(file)` returns every sheet at once.
2. **Pick sheet** → list sheet names with row counts.
3. **Confirm column mapping** — auto-detect by fuzzy header match against the known headers (`MODEL TYPE`, `CUSTOMER`, `BRAKE TYPE`, `SO#`, `FG A#`, plus FG SKU and ACC SKU columns), show what matched in a `ThemedSelect` per field, and let the planner remap. **Never import on an assumed mapping** — a renamed header would otherwise load a whole month into the wrong fields silently.
4. **Dry-run preview** — run `isSectionHeaderRow` then `resolveScheduleLine` over every row and show the counts in the shape the existing `scripts/planning/dry-run-schedule-import.ts` produces: *N rows → M divider rows skipped → K importable → R resolved / F flagged*, with each flag's `detail` listed and grouped by `code`. Blocking flags link to `/planning/configuration`.

Nothing is written until the planner confirms. The import write runs in a **client effect / event handler**, never during render.

- [ ] **Step 2: Build the list surface**

Sales orders list (SO# · customer · line count · converted count) and an imports list (file · sheet · row range · imported at). Selecting an import opens its detail, which hosts the export column panel from Task 12.

- [ ] **Step 3: Verify with a real fixture**

Drive the real flow in the browser with a small `.xlsx` containing a divider row, a resolvable row, and a row with an unconfigured SKU. Confirm the preview counts match expectations, the flagged row names its SKU, and the import writes only after confirmation.

- [ ] **Step 4: Commit**

```bash
git add src/components/planning/sales-orders-workspace.tsx src/components/planning/schedule-upload.tsx src/components/planning/sales-orders-workspace.css app/planning/sales-orders/page.tsx
git commit -m "feat(planning): production schedule upload, mapping, and dry-run import"
```

---

## Task 11: Approval RPC and the draft → released transition

**Files:**
- Create: `supabase/migrations/20260721130000_approve_work_order_set.sql`
- Modify: `src/lib/planning/store.ts`

**Interfaces:**
- Produces: `approve_work_order_set(p_workspace_id text, p_main_id uuid) returns table(order_no text, pm_order_no text)`; store wrapper `approveWorkOrderSet(workspaceId, mainId): Promise<{ orderNo: string; pmOrderNo: string | null }>`

- [ ] **Step 1: Read the existing transition guard first**

Run: `cat supabase/migrations/20260703170000_work_order_transition_guard.sql`
The guard may reject a `draft → released` update that also mutates `order_no`. If it does, the migration must adjust it — an approval that cannot set the number is the whole feature failing. Do not skip this step.

- [ ] **Step 2: Write the RPC**

`security invoker` so RLS still applies. Inside one function body: lock the workspace's month series (`select … for update` on the existing approved rows, or an advisory lock keyed on `workspace_id || mmyy`), compute `max + 1` across `GEN-` and `PM-` numbers for the month, then update the Main and its PM (`main_order_id = p_main_id`) with `order_no`, `set_no`, `status = 'released'`, `released_at = now()`. Raise if the Main is not `draft`.

The lock is what makes two concurrent approvals produce distinct contiguous numbers instead of colliding — the client-side `23505` retry cannot guarantee contiguity, only uniqueness.

- [ ] **Step 3: Apply and regenerate types**

Run: `node --env-file=.env.local scripts/apply-migration-safely.mjs 20260721130000_approve_work_order_set.sql`
Then: `npm run gen:types && npm run typecheck`

- [ ] **Step 4: Add the store wrapper and commit**

`approveWorkOrderSet` calls `supabase.rpc("approve_work_order_set", …)` and maps the returned row. Follow store conventions for error messages.

```bash
git add supabase/migrations/20260721130000_approve_work_order_set.sql src/lib/planning/store.ts src/lib/database.types.ts
git commit -m "feat(planning): atomic set approval mints the official order number"
```

---

## Task 12: Work order create-from-sales-order, approval, and export column

**Files:**
- Modify: `src/components/planning/work-order-new.tsx`, `src/components/planning/work-order-detail.tsx`, `src/components/planning/work-order-board.tsx`, `src/lib/planning/store.ts`
- Create: `src/components/planning/export-column-panel.tsx`

**Interfaces:**
- Consumes: `listSalesOrders`, `listUnconvertedLines`, `markLineConverted` (Task 9); `approveWorkOrderSet` (Task 11); `suggestDraftNo` (Task 6); `buildExportColumn`, `exportColumnText` (Task 5)

- [ ] **Step 1: Rewrite the create flow**

`work-order-new.tsx` replaces its free-text Customer/Model inputs with: select a sales order → select one of its unconverted lines → fields fill from the resolution (customer, model, trailer letter, order date, A#) and the BOM fills from the FG SKU's config lines with the ACC SKU's config lines **appended after them, continuing the same `position` sequence**. The planner may edit every field before saving.

Saving creates the GEN + PM pair as **drafts** via `createGenPmSet` with `order_no = null` and the GEN carrying `draft_no` from `suggestDraftNo`, then calls `markLineConverted`.

Keep the existing trailer-letter select and date field — that logic is unchanged.

- [ ] **Step 2: Add the approve action**

On `work-order-detail.tsx`, a draft shows an **Approve** button that calls `approveWorkOrderSet` and, on success, replaces the provisional `D-…` with the official `GEN-…`. Non-draft orders keep the existing transition controls.

- [ ] **Step 3: Show provisional identity on the board**

`work-order-board.tsx` renders `draft_no` in the Order column when `order_no` is null, visually distinguished (`text-ink-tertiary`) so a provisional id never reads as official. `SetCell` already handles an empty `set_no` — verify it shows `—` for drafts.

- [ ] **Step 4: Build the export column panel**

`export-column-panel.tsx` takes an import's lines + range, calls `buildExportColumn`, and renders: the file name and row range, an `N of M rows have approved work orders` count, the column in a monospace scroll box, and a Copy button writing `exportColumnText(column)` to the clipboard. Mount it on the import detail in the Sales orders workspace.

- [ ] **Step 5: Verify end to end in the browser**

Upload the fixture → import → create a work order from a sales order → confirm the BOM filled from both SKUs → approve → confirm the official number appears and is contiguous with the previous one → open the import detail → confirm the export column has a blank cell for the divider row and the flagged row, and that the copied text pastes as a correctly aligned column.

- [ ] **Step 6: Commit**

```bash
git add src/components/planning src/lib/planning/store.ts
git commit -m "feat(planning): create work orders from sales orders, approve, export column"
```

---

## Task 13: Full verification gate

**Files:** none created — this is the merge gate.

- [ ] **Step 1: Static gate**

Run: `npm run typecheck && npm run lint && npm run test`
Expected: all three PASS, lint at `--max-warnings=0`.

- [ ] **Step 2: Confirm no stale references**

Run: `grep -rn "schedule-import" src app scripts docs --include="*.ts" --include="*.tsx"`
Expected: only references inside `docs/` and `scripts/planning/*.mjs`. Update the scripts' imports to `@/domain/planning/schedule-row` if they break, or note them as retired.

- [ ] **Step 3: Live browser pass**

Drive the whole flow once more in a fresh session: side pane navigation across all three modules with no re-mount flash, configuration create/retire, schedule upload with a deliberately misnamed header (confirm the mapping step catches it), import, work-order create, approve, export column copy.

- [ ] **Step 4: Commit any fixes and merge**

```bash
git add -A
git commit -m "fix(planning): verification pass corrections"
git checkout main && git merge --no-ff feat/planning-schedule-to-work-orders
```

---

## Self-Review

**Spec coverage:** §1 architecture → Task 2. §2 data model → Tasks 1, 11. §3 sales orders → Tasks 9, 10; configuration manager → Tasks 7, 8. §4 work-order flow → Tasks 6, 11, 12; export column → Tasks 5, 12; error handling → distributed across 10, 11, 12. §5 domain split → Tasks 3, 4, 5; test plan → each task's TDD steps plus Task 13. D7 (trailer letters A–D) is a **data** change made through the existing trailer-configs screen, with `normalizeBrake`'s mapping updated in Task 3 if the letters change meaning — no dedicated task, by design.

**Known gaps, accepted:** integration tests against a live DB for the RPC and RLS are specified in the spec but exercised here through Task 11's apply-time post-checks and Task 13's live pass rather than an automated suite — this repo has no DB-integration test harness, and building one is out of scope. E2E is likewise driven manually in Task 13; the repo's Playwright setup is not wired for authenticated Planning flows.

**Type consistency checked:** `ConfigIndex` / `ConfigEntry` defined in Task 4 are consumed by name in Tasks 7 and 10. `ExportRow` / `RowRange` / `ExportColumn` defined in Task 5 are consumed in Task 12. `suggestDraftNo` defined in Task 6 is consumed in Task 12. `approveWorkOrderSet` defined in Task 11 is consumed in Task 12.
