# Planning Space Work-Order System — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the planner's manual Excel work-order process with a Pulse Planning space: template-driven work-order creation, monthly order numbering, status tracking, print/batch-print, BC file imports, and an admin-granted access gate.

**Architecture:** Four new workspace-scoped Supabase tables gated by a new generic `space_access` table + `has_space_access()` RLS helper (layered on the existing `has_workspace_role()`). Pure domain logic (`src/domain/work-orders.ts`) and pure parsers (`src/lib/planning/parse-*.ts`) are TDD'd; a thin PostgREST store (`src/lib/planning/store.ts`) mirrors the SOP store pattern; client components under `src/components/planning/` reuse the existing header shell and `ui-*` idioms. Printing is dedicated routes with inline `@media print` CSS (no PDF library).

**Tech Stack:** Next.js 15 App Router, React 19, Supabase (anon client + RLS), `read-excel-file` (existing dep, browser build), vitest.

**Spec:** `docs/superpowers/specs/2026-07-03-planning-work-orders-design.md` — read it before starting.

## Global Constraints

- **Theme fidelity:** zero new fonts, zero new hex values, zero new component idioms. Use existing tokens (`--color-*`, `--type-*`), classes (`ui-panel`, `ui-mono-label`, `ui-btn-primary`, `ui-btn-ghost`, `ui-chip`, `ui-input`, `ui-eyebrow`), and components (`ThemedSelect`, `NothingSpinner`, `NothingLoadingBlock`, `useConfirm`, `ThemedFeedbackLayer`). Exception: print documents render on white paper — `report.ts` already inlines `#fff` for documents; match that precedent inside print-only markup.
- **Statuses:** `draft → released → in_production → shipped`, plus `cancelled`. Order type values: `head_unit | accessories | decal | trailer | rework | mts`. Fulfillment values: `assembly | pull_from | pull_from_stock`.
- **Order numbers:** format `WO-YYMM-NN` (e.g. `WO-2607-01`), sequence resets monthly, month derived from `order_date`, unique per workspace, planner-editable.
- **Roles:** owners/admins implicitly have Planning access; editors/viewers need a `space_access` grant. Write = role in (owner, admin, editor) AND access. Viewer + grant = read-only.
- **Migrations:** applied via `node --env-file=.env.local scripts/apply-migration-safely.mjs <file>`. The applier requires: double-quoted policy names, `create or replace function`, no `drop table`/`drop column`/`truncate`. New SQL functions use `security definer set search_path = ''` with fully-qualified `public.` references.
- **Descriptions are snapshots** on template lines and order lines — never live joins to `planning_item_master`.
- **Templates never carry A-numbers.** Orders copy template lines at creation; `template_id` is provenance only.
- **Tests:** pure-logic vitest colocated next to modules (`*.test.ts`). No component/jsdom tests (repo convention). After every task: `npm run typecheck && npm run test`.
- **Commits:** conventional format (`feat:`, `fix:`, `docs:`), no attribution footer (disabled globally).
- **File size:** keep new components under ~800 lines; split by responsibility.

---

### Task 1: Migration — space_access gate + planning tables + RLS

**Files:**
- Create: `supabase/migrations/20260703150000_planning_work_orders.sql`

**Interfaces:**
- Produces: tables `space_access`, `planning_item_master`, `work_order_templates`, `work_order_template_lines`, `work_orders`, `work_order_lines`; SQL function `public.has_space_access(target_workspace_id text, target_space text) returns boolean`. All later tasks assume these exact table/column names.

- [ ] **Step 1: Read the reference migrations** — `supabase/migrations/20260608120000_add_sops_table.sql` and `20260701121000_sops_org_tool_rls.sql` to confirm the policy/trigger idioms below still match, and `ls supabase/migrations/ | tail -3` to confirm `20260703150000` sorts after the latest migration. Expected: latest is `20260703120000_access_lifecycle_and_audit.sql`.

- [ ] **Step 2: Write the migration file** with exactly this content:

```sql
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
```

Note: hard-deleting a whole work order is owner/admin only; line deletes follow editor because line replacement is part of normal editing.

- [ ] **Step 3: Apply the migration** (this touches the live DB — the applier snapshots row counts and rolls back on anomalies):

Run: `node --env-file=.env.local scripts/apply-migration-safely.mjs --smoke "has_space_access('workspace-default','planning')" 20260703150000_planning_work_orders.sql`
Expected: applies cleanly; post-checks confirm all policies + `has_space_access` exist; zero row-count changes to existing tables.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/20260703150000_planning_work_orders.sql
git commit -m "feat(planning): work-order tables, item master, and space_access RLS gate"
```

---

### Task 2: Domain module — statuses, numbering, A#-completeness

**Files:**
- Create: `src/domain/work-orders.ts`
- Test: `src/domain/work-orders.test.ts`

**Interfaces:**
- Produces (all consumed by Tasks 3, 5, 7-10):
  - `type WorkOrderStatus = "draft" | "released" | "in_production" | "shipped" | "cancelled"`
  - `type WorkOrderFulfillment = "assembly" | "pull_from" | "pull_from_stock"`
  - `type WorkOrderType = "head_unit" | "accessories" | "decal" | "trailer" | "rework" | "mts"`
  - `WORK_ORDER_STATUS_LABELS: Record<WorkOrderStatus, string>`, `WORK_ORDER_TYPE_LABELS: Record<WorkOrderType, string>`
  - `nextForwardStatus(status: WorkOrderStatus): WorkOrderStatus | null`
  - `canTransitionWorkOrder(from: WorkOrderStatus, to: WorkOrderStatus, options: { isManager: boolean }): boolean`
  - `orderNoMonthKey(orderDate: string): string` — `"2026-07-15"` → `"2607"`
  - `suggestOrderNo(existingOrderNos: readonly string[], orderDate: string): string`
  - `buildTransitionPatch(to: WorkOrderStatus, nowIso: string): Record<string, string | null>` — status + timestamp columns to set/clear
  - `lineNeedsAssemblyNo(line: { fulfillment: WorkOrderFulfillment; assemblyOrderNo: string }): boolean`
  - `missingAssemblyCount(lines: readonly { fulfillment: WorkOrderFulfillment; assemblyOrderNo: string }[]): number`

- [ ] **Step 1: Write the failing tests** at `src/domain/work-orders.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
  buildTransitionPatch,
  canTransitionWorkOrder,
  missingAssemblyCount,
  nextForwardStatus,
  orderNoMonthKey,
  suggestOrderNo,
} from "./work-orders";

describe("orderNoMonthKey", () => {
  it("derives YYMM from an ISO date", () => {
    expect(orderNoMonthKey("2026-07-15")).toBe("2607");
    expect(orderNoMonthKey("2027-01-02")).toBe("2701");
  });
  it("falls back to 0000 on malformed input", () => {
    expect(orderNoMonthKey("garbage")).toBe("0000");
  });
});

describe("suggestOrderNo", () => {
  it("starts each month at 01", () => {
    expect(suggestOrderNo([], "2026-07-15")).toBe("WO-2607-01");
  });
  it("continues the month's sequence", () => {
    expect(suggestOrderNo(["WO-2607-01", "WO-2607-03"], "2026-07-20")).toBe("WO-2607-04");
  });
  it("ignores other months and junk", () => {
    expect(suggestOrderNo(["WO-2606-09", "MTS-0705-02", "WO-2607-02"], "2026-07-01")).toBe("WO-2607-03");
  });
  it("is case/whitespace tolerant", () => {
    expect(suggestOrderNo([" wo-2607-07 "], "2026-07-31")).toBe("WO-2607-08");
  });
  it("grows past two digits", () => {
    expect(suggestOrderNo(["WO-2607-99"], "2026-07-01")).toBe("WO-2607-100");
  });
});

describe("canTransitionWorkOrder", () => {
  const editor = { isManager: false };
  const manager = { isManager: true };
  it("allows the forward step for editors", () => {
    expect(canTransitionWorkOrder("draft", "released", editor)).toBe(true);
    expect(canTransitionWorkOrder("released", "in_production", editor)).toBe(true);
    expect(canTransitionWorkOrder("in_production", "shipped", editor)).toBe(true);
  });
  it("blocks skipping and backwards steps for editors", () => {
    expect(canTransitionWorkOrder("draft", "in_production", editor)).toBe(false);
    expect(canTransitionWorkOrder("released", "draft", editor)).toBe(false);
  });
  it("allows managers one step back", () => {
    expect(canTransitionWorkOrder("released", "draft", manager)).toBe(true);
    expect(canTransitionWorkOrder("shipped", "in_production", manager)).toBe(true);
    expect(canTransitionWorkOrder("shipped", "draft", manager)).toBe(false);
  });
  it("allows cancelling any active order but not shipped ones", () => {
    expect(canTransitionWorkOrder("draft", "cancelled", editor)).toBe(true);
    expect(canTransitionWorkOrder("in_production", "cancelled", editor)).toBe(true);
    expect(canTransitionWorkOrder("shipped", "cancelled", editor)).toBe(false);
  });
  it("lets only managers revive a cancelled order to draft", () => {
    expect(canTransitionWorkOrder("cancelled", "draft", manager)).toBe(true);
    expect(canTransitionWorkOrder("cancelled", "draft", editor)).toBe(false);
    expect(canTransitionWorkOrder("cancelled", "released", manager)).toBe(false);
  });
});

describe("buildTransitionPatch", () => {
  const now = "2026-07-15T12:00:00.000Z";
  it("stamps the reached status and clears later stamps", () => {
    expect(buildTransitionPatch("released", now)).toEqual({
      status: "released",
      released_at: now,
      production_started_at: null,
      shipped_at: null,
      cancelled_at: null,
    });
  });
  it("keeps no stamps when returning to draft", () => {
    expect(buildTransitionPatch("draft", now)).toEqual({
      status: "draft",
      released_at: null,
      production_started_at: null,
      shipped_at: null,
      cancelled_at: null,
    });
  });
  it("stamps cancellation without touching progress stamps forward", () => {
    expect(buildTransitionPatch("cancelled", now)).toEqual({ status: "cancelled", cancelled_at: now });
  });
});

describe("nextForwardStatus", () => {
  it("walks the flow and terminates", () => {
    expect(nextForwardStatus("draft")).toBe("released");
    expect(nextForwardStatus("shipped")).toBeNull();
    expect(nextForwardStatus("cancelled")).toBeNull();
  });
});

describe("missingAssemblyCount", () => {
  it("counts assembly lines without an A-number", () => {
    expect(
      missingAssemblyCount([
        { fulfillment: "assembly", assemblyOrderNo: "" },
        { fulfillment: "assembly", assemblyOrderNo: "  " },
        { fulfillment: "assembly", assemblyOrderNo: "A35987" },
        { fulfillment: "pull_from", assemblyOrderNo: "" },
        { fulfillment: "pull_from_stock", assemblyOrderNo: "" },
      ]),
    ).toBe(2);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/domain/work-orders.test.ts`
Expected: FAIL — cannot resolve `./work-orders`.

- [ ] **Step 3: Write the implementation** at `src/domain/work-orders.ts`:

```ts
// Work-order domain rules: status flow, monthly order numbering, and
// A-number completeness. Pure logic — no I/O.

export type WorkOrderStatus = "draft" | "released" | "in_production" | "shipped" | "cancelled";
export type WorkOrderFulfillment = "assembly" | "pull_from" | "pull_from_stock";
export type WorkOrderType = "head_unit" | "accessories" | "decal" | "trailer" | "rework" | "mts";

export const WORK_ORDER_STATUS_FLOW = ["draft", "released", "in_production", "shipped"] as const;

export const WORK_ORDER_STATUS_LABELS: Record<WorkOrderStatus, string> = {
  draft: "Draft",
  released: "Released",
  in_production: "In production",
  shipped: "Shipped",
  cancelled: "Cancelled",
};

export const WORK_ORDER_TYPE_LABELS: Record<WorkOrderType, string> = {
  head_unit: "Head unit",
  accessories: "Accessories",
  decal: "Decal",
  trailer: "Trailer",
  rework: "Rework",
  mts: "Make-to-stock",
};

export const WORK_ORDER_TYPES = Object.keys(WORK_ORDER_TYPE_LABELS) as WorkOrderType[];

export function nextForwardStatus(status: WorkOrderStatus): WorkOrderStatus | null {
  const index = WORK_ORDER_STATUS_FLOW.indexOf(status as (typeof WORK_ORDER_STATUS_FLOW)[number]);
  if (index < 0 || index === WORK_ORDER_STATUS_FLOW.length - 1) {
    return null;
  }
  return WORK_ORDER_STATUS_FLOW[index + 1];
}

/**
 * Editors move forward one step and may cancel active orders.
 * Managers (owner/admin) may additionally step back one status or revive a
 * cancelled order to draft. Shipped orders cannot be cancelled.
 */
export function canTransitionWorkOrder(
  from: WorkOrderStatus,
  to: WorkOrderStatus,
  options: { isManager: boolean },
): boolean {
  if (from === to) {
    return false;
  }
  if (nextForwardStatus(from) === to) {
    return true;
  }
  if (to === "cancelled") {
    return from !== "shipped" && from !== "cancelled";
  }
  if (!options.isManager) {
    return false;
  }
  if (from === "cancelled") {
    return to === "draft";
  }
  const fromIndex = WORK_ORDER_STATUS_FLOW.indexOf(from as (typeof WORK_ORDER_STATUS_FLOW)[number]);
  const toIndex = WORK_ORDER_STATUS_FLOW.indexOf(to as (typeof WORK_ORDER_STATUS_FLOW)[number]);
  return fromIndex > 0 && toIndex === fromIndex - 1;
}

export const WORK_ORDER_NO_PREFIX = "WO";

/** "2026-07-15" → "2607". Malformed dates bucket to "0000" rather than throwing. */
export function orderNoMonthKey(orderDate: string): string {
  const match = /^(\d{4})-(\d{2})/.exec(orderDate.trim());
  if (!match) {
    return "0000";
  }
  return `${match[1].slice(2)}${match[2]}`;
}

/** Next number in the month's series: WO-YYMM-NN, restarting at 01 each month. */
export function suggestOrderNo(existingOrderNos: readonly string[], orderDate: string): string {
  const prefix = `${WORK_ORDER_NO_PREFIX}-${orderNoMonthKey(orderDate)}-`;
  let max = 0;
  for (const orderNo of existingOrderNos) {
    const normalized = orderNo.trim().toUpperCase();
    if (!normalized.startsWith(prefix)) {
      continue;
    }
    const sequence = Number.parseInt(normalized.slice(prefix.length), 10);
    if (Number.isFinite(sequence) && sequence > max) {
      max = sequence;
    }
  }
  return `${prefix}${String(max + 1).padStart(2, "0")}`;
}

const STATUS_TIMESTAMP_COLUMNS = ["released_at", "production_started_at", "shipped_at"] as const;

/**
 * DB patch for a status transition. Reaching a flow status stamps it and clears
 * every later stamp (so stepping back erases the future). Cancelling stamps
 * cancelled_at only, preserving progress stamps for a possible revive.
 */
export function buildTransitionPatch(to: WorkOrderStatus, nowIso: string): Record<string, string | null> {
  if (to === "cancelled") {
    return { status: "cancelled", cancelled_at: nowIso };
  }
  const reachedIndex = WORK_ORDER_STATUS_FLOW.indexOf(to as (typeof WORK_ORDER_STATUS_FLOW)[number]);
  const patch: Record<string, string | null> = { status: to, cancelled_at: null };
  STATUS_TIMESTAMP_COLUMNS.forEach((column, index) => {
    // Column index n stamps flow status n + 1 (draft has no stamp).
    patch[column] = index + 1 === reachedIndex ? nowIso : index + 1 < reachedIndex ? patch[column] ?? null : null;
  });
  if (reachedIndex > 0) {
    patch[STATUS_TIMESTAMP_COLUMNS[reachedIndex - 1]] = nowIso;
  }
  return patch;
}

export function lineNeedsAssemblyNo(line: { fulfillment: WorkOrderFulfillment; assemblyOrderNo: string }): boolean {
  return line.fulfillment === "assembly" && line.assemblyOrderNo.trim() === "";
}

export function missingAssemblyCount(
  lines: readonly { fulfillment: WorkOrderFulfillment; assemblyOrderNo: string }[],
): number {
  return lines.filter(lineNeedsAssemblyNo).length;
}
```

Note on `buildTransitionPatch`: the loop + final assignment leaves earlier stamps `null` when stepping straight to a later status is impossible in the UI (transitions are single-step), so only the reached status's stamp is set and later ones cleared — exactly what the tests assert. If the tests disagree with the implementation, fix the implementation, not the tests.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/domain/work-orders.test.ts`
Expected: PASS (all describe blocks).

- [ ] **Step 5: Typecheck and commit**

```bash
npm run typecheck
git add src/domain/work-orders.ts src/domain/work-orders.test.ts
git commit -m "feat(planning): work-order domain rules (status flow, monthly numbering, A# completeness)"
```

---

### Task 3: Workbook template parser

**Files:**
- Create: `src/lib/planning/parse-workbook.ts`
- Test: `src/lib/planning/parse-workbook.test.ts`

**Interfaces:**
- Consumes: `WorkOrderType` from `@/domain/work-orders`.
- Produces (consumed by Tasks 5 and 11):
  - `type WorkbookCell = string | number | boolean | Date | null`
  - `type ParsedTemplateLine = { itemNo: string; description: string; buildQty: number; position: number }`
  - `type ParsedTemplateSheet = { sheetName: string; templateName: string; customer: string; model: string; orderType: WorkOrderType; notes: string; lines: ParsedTemplateLine[]; warnings: string[] }`
  - `parseTemplateSheet(sheetName: string, rows: readonly (readonly WorkbookCell[])[]): ParsedTemplateSheet | null` — `null` means "not a template sheet" (e.g. the DATA sheet).

Parser facts verified against the real workbook (do not "simplify" these away):
- The header row (`ITEM NO.`) is usually row 8 but sometimes row 6; **locate it, never hardcode**. `Build Quantity` is at column 16 in 29 sheets and column 17 in 18 sheets — read the index from the header row.
- Line blocks: item row (item no at the header's item column, qty at the qty column) with the description on the **next** row at the same column. Blocks repeat every 4 rows but stray qty-only rows exist — only rows with an item number start a line.
- A-number cells (col 9) are **ignored entirely** — templates don't carry A-numbers.
- The notes row has `Notes:` in column 1 and the value in column 3.
- Title rows are free text (`UNITED RENTALS WORK ORDER HEAD UNIT`, `T MOBILE REWORK UNIT`, `Red D Arc SHARE WORK ORDER`, bare `WORK ORDER`); customer extraction is best-effort and the import preview lets the planner correct it.

- [ ] **Step 1: Write the failing tests** at `src/lib/planning/parse-workbook.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { parseTemplateSheet, type WorkbookCell } from "./parse-workbook";

function sheet(cells: Record<number, Record<number, WorkbookCell>>, rowCount: number): WorkbookCell[][] {
  return Array.from({ length: rowCount }, (_, r) =>
    Array.from({ length: 22 }, (_, c) => cells[r]?.[c] ?? null),
  );
}

// Mirrors "ACC 70-45 OES": header on row 8, qty col 16, shipped col 20.
const ACC_SHEET = sheet(
  {
    0: { 0: "Kiewit WORK ORDER ACCESSORIES" },
    6: { 0: "BOSS70-40" },
    8: { 2: "ITEM NO.", 16: "Build Quantity", 20: "Shipped Quantity" },
    10: { 2: "BOSS70-001", 9: "A35987", 16: 1, 20: "__________" },
    11: { 2: "ENERGY BOSS 70 DUAL AXLE SURGE TRAILER" },
    14: { 2: "5000000075", 9: "PULL FROM A35988", 16: 2, 20: "__________" },
    15: { 2: "CHARGER SOLAR BATTERY 12V KIT" },
    18: { 16: 1, 20: "__________" }, // stray qty-only row — must be skipped
    22: { 2: "7000000155", 9: "PULL FROM STOCK A35989", 16: 1, 20: "__________" },
    23: { 2: "DECAL EB70 FULL HYBRID KIT" },
    26: { 1: "Notes:", 3: "Baltimore, MD" },
  },
  30,
);

// Mirrors "HEAD UNIT 70-40 UR": header row 8 but qty col 17; a unit-count row ("7") above the model.
const HEAD_UNIT_SHEET = sheet(
  {
    0: { 0: "UNITED RENTALS WORK ORDER HEAD UNIT" },
    3: { 0: "7" },
    6: { 0: "BOSS70-40" },
    8: { 2: "ITEM NO.", 17: "Build Quantity", 21: "Shipped Quantity" },
    10: { 2: "BOSS70-20HCS", 9: "A36424", 17: 1, 21: "__________" },
    11: { 2: "ENERGY BOSS 70KVA CS HEAD UNIT ASSEMBLY" },
    14: { 2: "HYBRID", 21: "__________" }, // marker line without qty
    15: { 2: "FIT FOR HYBRID" },
    18: { 1: "Notes:", 3: "Waukesha, WI" },
  },
  22,
);

const DATA_SHEET = sheet(
  {
    0: { 0: "No.", 1: "Description", 2: "Vendor No." },
    1: { 0: "135121164", 1: "Copper Gasket", 2: "V100014" },
  },
  3,
);

describe("parseTemplateSheet", () => {
  it("parses a standard accessories sheet", () => {
    const parsed = parseTemplateSheet("ACC 70-45 OES", ACC_SHEET);
    expect(parsed).not.toBeNull();
    expect(parsed?.customer).toBe("Kiewit");
    expect(parsed?.model).toBe("BOSS70-40");
    expect(parsed?.orderType).toBe("accessories");
    expect(parsed?.notes).toBe("Baltimore, MD");
    expect(parsed?.lines).toEqual([
      { itemNo: "BOSS70-001", description: "ENERGY BOSS 70 DUAL AXLE SURGE TRAILER", buildQty: 1, position: 0 },
      { itemNo: "5000000075", description: "CHARGER SOLAR BATTERY 12V KIT", buildQty: 2, position: 1 },
      { itemNo: "7000000155", description: "DECAL EB70 FULL HYBRID KIT", buildQty: 1, position: 2 },
    ]);
  });

  it("reads quantity from the header-declared column (17 variant) and skips the unit-count row for model", () => {
    const parsed = parseTemplateSheet("HEAD UNIT 70-40 UR", HEAD_UNIT_SHEET);
    expect(parsed?.model).toBe("BOSS70-40");
    expect(parsed?.orderType).toBe("head_unit");
    expect(parsed?.customer).toBe("UNITED RENTALS");
    expect(parsed?.lines[0]?.buildQty).toBe(1);
  });

  it("defaults missing quantities to 1 with a warning", () => {
    const parsed = parseTemplateSheet("HEAD UNIT 70-40 UR", HEAD_UNIT_SHEET);
    const hybrid = parsed?.lines.find((line) => line.itemNo === "HYBRID");
    expect(hybrid?.buildQty).toBe(1);
    expect(parsed?.warnings.some((w) => w.includes("HYBRID"))).toBe(true);
  });

  it("returns null for the DATA sheet (no ITEM NO. header)", () => {
    expect(parseTemplateSheet("DATA", DATA_SHEET)).toBeNull();
  });

  it("detects rework and extracts the customer before the REWORK marker", () => {
    const rework = sheet(
      {
        0: { 0: "T MOBILE REWORK UNIT" },
        2: { 0: "BOSS70-45 SOLAR" },
        6: { 2: "ITEM NO.", 17: "Build Quantity", 21: "Shipped Quantity" },
        8: { 2: "110034-LARM ELECTRIC", 17: 2, 21: "__________" },
        9: { 2: "END UNIT AXLE ARM LEFT" },
      },
      12,
    );
    const parsed = parseTemplateSheet("REWORK", rework);
    expect(parsed?.orderType).toBe("rework");
    expect(parsed?.customer).toBe("T MOBILE");
    expect(parsed?.model).toBe("BOSS70-45 SOLAR");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/lib/planning/parse-workbook.test.ts`
Expected: FAIL — cannot resolve `./parse-workbook`.

- [ ] **Step 3: Write the implementation** at `src/lib/planning/parse-workbook.ts`:

```ts
// Parses one sheet of the planner's "MTS Work Orders Master" workbook into a
// work-order template draft. Pure: takes a cell matrix, returns data + warnings.
import type { WorkOrderType } from "@/domain/work-orders";

export type WorkbookCell = string | number | boolean | Date | null;

export type ParsedTemplateLine = {
  itemNo: string;
  description: string;
  buildQty: number;
  position: number;
};

export type ParsedTemplateSheet = {
  sheetName: string;
  templateName: string;
  customer: string;
  model: string;
  orderType: WorkOrderType;
  notes: string;
  lines: ParsedTemplateLine[];
  warnings: string[];
};

const TYPE_PATTERNS: Array<[RegExp, WorkOrderType]> = [
  [/head unit/i, "head_unit"],
  [/\bacc\b|accessor/i, "accessories"],
  [/decal/i, "decal"],
  [/rework/i, "rework"],
  [/trailer/i, "trailer"],
];

function cellText(cell: WorkbookCell | undefined): string {
  if (cell === null || cell === undefined) {
    return "";
  }
  return String(cell).replace(/\s+/g, " ").trim();
}

function detectOrderType(text: string): WorkOrderType {
  for (const [pattern, type] of TYPE_PATTERNS) {
    if (pattern.test(text)) {
      return type;
    }
  }
  return "mts";
}

/**
 * Titles read like "UNITED RENTALS WORK ORDER HEAD UNIT" or "T MOBILE REWORK
 * UNIT" — the customer is everything before the marker. Best-effort: the
 * import preview lets the planner correct it per sheet.
 */
function extractCustomer(title: string): string {
  const match =
    /^(.*?)(?:\s+S-ORD\S+)?\s+(?:WORK ORDER|AO PACKAGE|REWORK|SHARE WORK ORDER|ACCESSORIES WORK ORDER|WO PACKAGE)/i.exec(
      title,
    );
  return (match ? match[1] : "").trim();
}

export function parseTemplateSheet(
  sheetName: string,
  rows: readonly (readonly WorkbookCell[])[],
): ParsedTemplateSheet | null {
  const headerRowIndex = rows.findIndex((row) =>
    row.some((cell) => cellText(cell).toUpperCase() === "ITEM NO."),
  );
  if (headerRowIndex < 0) {
    return null; // Not a template sheet (e.g. the DATA item-master export).
  }

  const headerRow = rows[headerRowIndex];
  const itemCol = headerRow.findIndex((cell) => cellText(cell).toUpperCase() === "ITEM NO.");
  const qtyCol = headerRow.findIndex((cell) => /build quantity/i.test(cellText(cell)));

  const warnings: string[] = [];
  if (qtyCol < 0) {
    warnings.push("No “Build Quantity” column found; quantities default to 1.");
  }

  const title = cellText(rows[0]?.[0]);
  const orderType = detectOrderType(`${sheetName} ${title}`);
  const customer = extractCustomer(title);

  // Model: first non-numeric single value between the title and the header row
  // (skips stray unit-count rows like a bare "7").
  let model = "";
  for (let r = 1; r < headerRowIndex; r += 1) {
    const value = cellText(rows[r]?.[0]);
    if (value !== "" && !/^\d+$/.test(value)) {
      model = value;
      break;
    }
  }

  const lines: ParsedTemplateLine[] = [];
  let notes = "";
  let r = headerRowIndex + 1;
  while (r < rows.length) {
    const row = rows[r] ?? [];
    if (cellText(row[1]) === "Notes:") {
      notes = cellText(row[3]);
      break;
    }
    const itemNo = cellText(row[itemCol]);
    if (itemNo === "") {
      r += 1;
      continue;
    }
    const description = cellText(rows[r + 1]?.[itemCol]);
    const rawQty = qtyCol >= 0 ? row[qtyCol] : null;
    const parsedQty = typeof rawQty === "number" ? rawQty : Number.parseFloat(cellText(rawQty));
    const hasQty = Number.isFinite(parsedQty) && parsedQty > 0;
    if (!hasQty) {
      warnings.push(`Line “${itemNo}”: no build quantity; defaulted to 1.`);
    }
    lines.push({ itemNo, description, buildQty: hasQty ? parsedQty : 1, position: lines.length });
    r += 2; // Skip the description row.
  }

  if (lines.length === 0) {
    return null;
  }

  return {
    sheetName,
    templateName: sheetName.replace(/\s+/g, " ").trim(),
    customer,
    model,
    orderType,
    notes,
    lines,
    warnings,
  };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/lib/planning/parse-workbook.test.ts`
Expected: PASS. If `extractCustomer` fails the "UNITED RENTALS" case, check alternation order in the regex — the lazy prefix must stop at the first marker.

- [ ] **Step 5: Commit**

```bash
npm run typecheck
git add src/lib/planning/parse-workbook.ts src/lib/planning/parse-workbook.test.ts
git commit -m "feat(planning): workbook template-sheet parser"
```

---

### Task 4: Item-master parser

**Files:**
- Create: `src/lib/planning/parse-item-master.ts`
- Test: `src/lib/planning/parse-item-master.test.ts`

**Interfaces:**
- Consumes: `WorkbookCell` from `./parse-workbook`.
- Produces (consumed by Tasks 5 and 11):
  - `type ParsedItemMasterRow = { itemNo: string; description: string; vendorNo: string | null }`
  - `type ItemMasterParseResult = { items: ParsedItemMasterRow[]; rejectedRows: number[]; error: string | null }` — `rejectedRows` are 1-based spreadsheet row numbers
  - `parseItemMasterRows(rows: readonly (readonly WorkbookCell[])[]): ItemMasterParseResult`
  - `diffItemMaster(existingItemNos: ReadonlySet<string>, incoming: readonly ParsedItemMasterRow[]): { added: number; updated: number }`

- [ ] **Step 1: Write the failing tests** at `src/lib/planning/parse-item-master.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { diffItemMaster, parseItemMasterRows } from "./parse-item-master";

describe("parseItemMasterRows", () => {
  it("parses the BC export shape (No. / Description / Vendor No.)", () => {
    const result = parseItemMasterRows([
      ["No.", "Description", "Vendor No."],
      ["135121164", "Copper Gasket 15/16\"", "V100014"],
      ["206160000", "End Mounting Bracket", null],
    ]);
    expect(result.error).toBeNull();
    expect(result.items).toEqual([
      { itemNo: "135121164", description: "Copper Gasket 15/16\"", vendorNo: "V100014" },
      { itemNo: "206160000", description: "End Mounting Bracket", vendorNo: null },
    ]);
    expect(result.rejectedRows).toEqual([]);
  });

  it("rejects rows without an item number, reporting 1-based row numbers", () => {
    const result = parseItemMasterRows([
      ["No.", "Description", "Vendor No."],
      [null, "Orphan description", "V1"],
      ["100", "Valid", null],
    ]);
    expect(result.items).toHaveLength(1);
    expect(result.rejectedRows).toEqual([2]);
  });

  it("dedupes repeated item numbers, last row wins", () => {
    const result = parseItemMasterRows([
      ["No.", "Description", "Vendor No."],
      ["100", "Old", null],
      ["100", "New", "V2"],
    ]);
    expect(result.items).toEqual([{ itemNo: "100", description: "New", vendorNo: "V2" }]);
  });

  it("errors when no header row is present", () => {
    const result = parseItemMasterRows([["random", "cells"]]);
    expect(result.error).toContain("header");
    expect(result.items).toEqual([]);
  });
});

describe("diffItemMaster", () => {
  it("splits incoming items into added vs updated", () => {
    const existing = new Set(["100", "200"]);
    const incoming = [
      { itemNo: "100", description: "", vendorNo: null },
      { itemNo: "300", description: "", vendorNo: null },
    ];
    expect(diffItemMaster(existing, incoming)).toEqual({ added: 1, updated: 1 });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/lib/planning/parse-item-master.test.ts`
Expected: FAIL — cannot resolve `./parse-item-master`.

- [ ] **Step 3: Write the implementation** at `src/lib/planning/parse-item-master.ts`:

```ts
// Parses a Business Central item-master export (xlsx/csv cell matrix) for the
// planning item_master table. Pure: no I/O.
import type { WorkbookCell } from "./parse-workbook";

export type ParsedItemMasterRow = {
  itemNo: string;
  description: string;
  vendorNo: string | null;
};

export type ItemMasterParseResult = {
  items: ParsedItemMasterRow[];
  rejectedRows: number[];
  error: string | null;
};

function cellText(cell: WorkbookCell | undefined): string {
  if (cell === null || cell === undefined) {
    return "";
  }
  return String(cell).replace(/\s+/g, " ").trim();
}

export function parseItemMasterRows(rows: readonly (readonly WorkbookCell[])[]): ItemMasterParseResult {
  const headerIndex = rows.findIndex((row) => {
    const texts = row.map((cell) => cellText(cell).toLowerCase());
    const hasNo = texts.some((text) => text === "no." || text === "no" || text === "item no.");
    const hasDescription = texts.some((text) => text.startsWith("description"));
    return hasNo && hasDescription;
  });
  if (headerIndex < 0) {
    return { items: [], rejectedRows: [], error: "No header row with “No.” and “Description” columns found." };
  }

  const headerTexts = rows[headerIndex].map((cell) => cellText(cell).toLowerCase());
  const itemCol = headerTexts.findIndex((text) => text === "no." || text === "no" || text === "item no.");
  const descriptionCol = headerTexts.findIndex((text) => text.startsWith("description"));
  const vendorCol = headerTexts.findIndex((text) => text.startsWith("vendor"));

  const byItemNo = new Map<string, ParsedItemMasterRow>();
  const rejectedRows: number[] = [];
  for (let r = headerIndex + 1; r < rows.length; r += 1) {
    const row = rows[r] ?? [];
    const itemNo = cellText(row[itemCol]);
    const hasAnyContent = row.some((cell) => cellText(cell) !== "");
    if (itemNo === "") {
      if (hasAnyContent) {
        rejectedRows.push(r + 1); // 1-based spreadsheet row number
      }
      continue;
    }
    const vendorNo = vendorCol >= 0 ? cellText(row[vendorCol]) : "";
    byItemNo.set(itemNo, {
      itemNo,
      description: descriptionCol >= 0 ? cellText(row[descriptionCol]) : "",
      vendorNo: vendorNo === "" ? null : vendorNo,
    });
  }

  return { items: [...byItemNo.values()], rejectedRows, error: null };
}

export function diffItemMaster(
  existingItemNos: ReadonlySet<string>,
  incoming: readonly ParsedItemMasterRow[],
): { added: number; updated: number } {
  let added = 0;
  let updated = 0;
  for (const item of incoming) {
    if (existingItemNos.has(item.itemNo)) {
      updated += 1;
    } else {
      added += 1;
    }
  }
  return { added, updated };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/lib/planning/parse-item-master.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
npm run typecheck
git add src/lib/planning/parse-item-master.ts src/lib/planning/parse-item-master.test.ts
git commit -m "feat(planning): item-master export parser"
```

---

### Task 5: File readers + Supabase store

**Files:**
- Create: `src/lib/planning/read-files.ts` (browser xlsx/csv → cell matrices)
- Create: `src/lib/planning/store.ts` (PostgREST CRUD; mirrors `src/lib/sop/store.ts` idioms)

**Interfaces:**
- Consumes: `parseTemplateSheet`, `parseItemMasterRows`, domain types, `createPlannerSupabaseClient` from `@/domain/supabase-planner`, `suggestOrderNo`, `buildTransitionPatch`, `orderNoMonthKey`, `WORK_ORDER_NO_PREFIX`.
- Produces (consumed by all UI tasks):
  - `readWorkbookFile(file: File): Promise<{ sheets: Array<{ name: string; rows: WorkbookCell[][] }> }>`
  - `readItemMasterFile(file: File): Promise<WorkbookCell[][]>` (handles .csv via the same RFC-4180 approach as `src/lib/parse-bom.ts` — read that file first and reuse its CSV parser by import if exported, otherwise copy the minimal logic)
  - Store types: `WorkOrderSummary`, `WorkOrderDetail`, `WorkOrderLine`, `TemplateSummary`, `TemplateDetail`, `TemplateLine`, `SpaceAccessRow`
  - Store functions (exact signatures):
    - `listWorkOrders(workspaceId: string): Promise<WorkOrderSummary[]>`
    - `getWorkOrder(workspaceId: string, id: string): Promise<WorkOrderDetail | null>`
    - `createWorkOrder(workspaceId: string, input: { templateId: string | null; customer: string; model: string; orderType: WorkOrderType; orderDate: string; notes: string; lines: Array<Omit<WorkOrderLine, "id">> }): Promise<string>` — computes `order_no` via `suggestOrderNo`, retries once on unique-violation (Postgres error code `23505`)
    - `updateWorkOrderHeader(workspaceId: string, id: string, patch: { customer?: string; model?: string; orderDate?: string; notes?: string; orderNo?: string }): Promise<void>`
    - `saveWorkOrderLine(workspaceId: string, lineId: string, patch: Partial<Omit<WorkOrderLine, "id">>): Promise<void>`
    - `addWorkOrderLine(workspaceId: string, workOrderId: string, line: Omit<WorkOrderLine, "id">): Promise<string>`
    - `deleteWorkOrderLine(workspaceId: string, lineId: string): Promise<void>`
    - `transitionWorkOrder(workspaceId: string, id: string, from: WorkOrderStatus, to: WorkOrderStatus): Promise<boolean>` — `update(buildTransitionPatch(to, new Date().toISOString())).eq("id", id).eq("status", from)`, returns false when zero rows matched (concurrent transition)
    - `listTemplates(workspaceId: string, options?: { includeRetired?: boolean }): Promise<TemplateSummary[]>`
    - `getTemplate(workspaceId: string, id: string): Promise<TemplateDetail | null>`
    - `saveTemplate(workspaceId: string, template: TemplateDetail): Promise<void>` (header update + line replace: delete lines by `template_id`, insert new set)
    - `retireTemplate(workspaceId: string, id: string, retired: boolean): Promise<void>`
    - `importTemplates(workspaceId: string, sheets: readonly ParsedTemplateSheet[]): Promise<{ imported: number; failed: Array<{ sheetName: string; message: string }> }>`
    - `upsertItemMaster(workspaceId: string, items: readonly ParsedItemMasterRow[]): Promise<{ added: number; updated: number }>` — fetch existing `item_no`s first (`select("item_no")` paged by 1000), compute counts with `diffItemMaster`, then upsert in chunks of 500 with `onConflict: "workspace_id,item_no"`
    - `searchItems(workspaceId: string, query: string, limit?: number): Promise<Array<{ itemNo: string; description: string }>>` — `or(\`item_no.ilike.%${q}%,description.ilike.%${q}%\`)`, default limit 12; escape `%` and `,` in the query by stripping them
    - `listSpaceAccess(workspaceId: string): Promise<SpaceAccessRow[]>`
    - `grantSpaceAccess(workspaceId: string, userId: string, space: string): Promise<void>`
    - `revokeSpaceAccess(workspaceId: string, userId: string, space: string): Promise<void>`
    - `fetchMySpaceAccess(workspaceId: string, space: string): Promise<boolean>` — selects own row; used by non-admin clients to learn access

Store implementation rules (copied from the SOP store — read `src/lib/sop/store.ts` before writing this file):
- Explicit column projections; never `select('*')`.
- Every read/write scoped by `.eq("workspace_id", workspaceId)`.
- `created_by` from `supabase.auth.getUser()` on inserts; omit `created_at`/`updated_at` (DB owns them).
- Map snake_case rows to camelCase types at the store boundary; components never see snake_case.
- Throw `Error` with a human-readable message on Supabase errors (`error.message`), per SOP-store convention.

- [ ] **Step 1: Read the reference files** — `src/lib/sop/store.ts` (CRUD idioms, error handling), `src/lib/parse-bom.ts` (browser `read-excel-file` usage: `const { readSheet } = await import("read-excel-file/browser")`, CSV handling). For multi-sheet reads, use the documented browser API: `const mod = await import("read-excel-file"); const names = await mod.readSheetNames(file); const rows = await mod.default(file, { sheet: name });` — verify against `node_modules/read-excel-file/index.d.ts` before assuming.

- [ ] **Step 2: Write `src/lib/planning/read-files.ts`** — thin async wrappers, lazy-importing the excel lib; `.csv` files go through the CSV path for the item master. No tests (I/O shims); the parsers behind them are tested.

- [ ] **Step 3: Write `src/lib/planning/store.ts`** implementing every signature above. Key excerpt for order creation (write the rest in the same style):

```ts
export async function createWorkOrder(workspaceId: string, input: CreateWorkOrderInput): Promise<string> {
  const supabase = createPlannerSupabaseClient();
  const { data: userData } = await supabase.auth.getUser();
  const monthPrefix = `${WORK_ORDER_NO_PREFIX}-${orderNoMonthKey(input.orderDate)}-%`;

  for (let attempt = 0; attempt < 2; attempt += 1) {
    const { data: existing, error: existingError } = await supabase
      .from("work_orders")
      .select("order_no")
      .eq("workspace_id", workspaceId)
      .ilike("order_no", monthPrefix);
    if (existingError) {
      throw new Error(`Could not load existing order numbers: ${existingError.message}`);
    }
    const orderNo = suggestOrderNo((existing ?? []).map((row) => row.order_no), input.orderDate);

    const { data: inserted, error: insertError } = await supabase
      .from("work_orders")
      .insert({
        workspace_id: workspaceId,
        order_no: orderNo,
        template_id: input.templateId,
        customer: input.customer,
        model: input.model,
        order_type: input.orderType,
        order_date: input.orderDate,
        notes: input.notes,
        created_by: userData.user?.id ?? null,
      })
      .select("id")
      .single();
    if (insertError) {
      if (insertError.code === "23505" && attempt === 0) {
        continue; // Someone took the number between select and insert — recompute.
      }
      throw new Error(`Could not create the work order: ${insertError.message}`);
    }

    if (input.lines.length > 0) {
      const { error: linesError } = await supabase.from("work_order_lines").insert(
        input.lines.map((line, index) => ({
          work_order_id: inserted.id,
          workspace_id: workspaceId,
          item_no: line.itemNo,
          description: line.description,
          build_qty: line.buildQty,
          shipped_qty: line.shippedQty,
          fulfillment: line.fulfillment,
          assembly_order_no: line.assemblyOrderNo,
          pull_from_ref: line.pullFromRef,
          position: index,
        })),
      );
      if (linesError) {
        throw new Error(`Order ${orderNo} was created but its lines failed: ${linesError.message}`);
      }
    }
    return inserted.id;
  }
  throw new Error("Could not allocate a unique order number; try again.");
}
```

- [ ] **Step 4: Typecheck + full test run**

Run: `npm run typecheck && npm run test`
Expected: PASS (no new tests here; existing suite stays green).

- [ ] **Step 5: Commit**

```bash
git add src/lib/planning/read-files.ts src/lib/planning/store.ts
git commit -m "feat(planning): planning store and workbook/item-master file readers"
```

---

### Task 6: Planning workspace provider + access gate + shell

**Files:**
- Create: `src/components/planning/planning-workspace-provider.tsx`
- Create: `src/components/planning/planning-shell.tsx`
- Modify: `src/components/project-route-shells.tsx` (replace the `PlanningRouteShell` placeholder body)

**Interfaces:**
- Consumes: `AuthProjectGate` + `DashboardHomeContext` from `@/components/auth-project-gate`, `fetchMySpaceAccess` from `@/lib/planning/store`, header idiom from `space-placeholder.tsx`.
- Produces:
  - `usePlanningWorkspace(): { workspaceId: string; workspaceName: string; role: string; hasAccess: boolean | null; canWrite: boolean; canManage: boolean }` (`hasAccess === null` while loading)
  - `PlanningWorkspaceProvider({ groups, children })`
  - `PlanningShell({ title, actions, children })` — sticky header (BackToDashboardButton, `ui-brand-compact` Pulse link, divider, `ui-mono-label` "Planning" + `title`, flexible spacer, `actions`, `UserNav`) over a `max-w-[1100px]` main
  - `PlanningAccessGate({ children })` — renders children when `hasAccess`, a `NothingLoadingBlock` while `null`, and the request-access panel otherwise

- [ ] **Step 1: Read the wiring you're about to touch** — `src/components/project-route-shells.tsx:16-72` (confirm the exact `renderHome` signature and what context it receives), `src/components/sop/sop-workspace-provider.tsx` (how it derives `{ workspaceId, role }` from groups and which workspace it picks — mirror that selection exactly), `src/components/space-placeholder.tsx:25-34` (header block to copy).

- [ ] **Step 2: Write the provider.** Derive `role` and `workspaceId` the same way the SOP provider does. Compute access:

```tsx
const isManager = role === "owner" || role === "admin" || isSuperAdmin;
const canWrite = isManager || (role === "editor" && hasAccess === true);
useEffect(() => {
  if (!workspaceId) return;
  if (isManager) { setHasAccess(true); return; }
  let cancelled = false;
  fetchMySpaceAccess(workspaceId, "planning")
    .then((granted) => { if (!cancelled) setHasAccess(granted); })
    .catch(() => { if (!cancelled) setHasAccess(false); });
  return () => { cancelled = true; };
}, [workspaceId, isManager]);
```

- [ ] **Step 3: Write `PlanningShell` + `PlanningAccessGate`.** The no-access panel is a `ui-panel` with `ui-mono-label` "Restricted", a sentence ("Planning requires access. Ask a workspace admin to grant it from Settings → Members."), and a `ui-btn-ghost` link back to the dashboard. Copy the header JSX from `space-placeholder.tsx` verbatim, swapping the space label.

- [ ] **Step 4: Rewire `PlanningRouteShell`** — keep the `AuthProjectGate` wrapper, replace the `SpacePlaceholder` render with:

```tsx
renderHome={(home) => (
  <PlanningWorkspaceProvider groups={home.groups}>
    <PlanningAccessGate>
      <WorkOrderBoard />
    </PlanningAccessGate>
  </PlanningWorkspaceProvider>
)}
```

(`WorkOrderBoard` arrives in Task 7 — for this task render a `ui-panel` stub with a `NothingLoadingBlock` so the app compiles, then Task 7 replaces it.) Delete the now-unused Planning `SpacePlaceholder` usage and its `TemplateRow` preview if nothing else imports them.

- [ ] **Step 5: Verify** — `npm run typecheck && npm run test`, then `npm run dev`: `/planning` as an admin shows the shell; as a viewer (or with the provider's `isManager` temporarily hardcoded false) shows the restricted panel.

- [ ] **Step 6: Commit**

```bash
git add src/components/planning/ src/components/project-route-shells.tsx
git commit -m "feat(planning): workspace provider, access gate, and space shell"
```

---

### Task 7: Work-order board

**Files:**
- Create: `src/components/planning/work-order-board.tsx`
- Modify: `src/components/project-route-shells.tsx` (swap the Task 6 stub for the real board)

**Interfaces:**
- Consumes: `usePlanningWorkspace`, `listWorkOrders`, domain labels, `missingAssemblyCount` (per-order counts come from `WorkOrderSummary.missingAssemblyCount` — compute it in the store's list query by selecting lines' `fulfillment, assembly_order_no` alongside, or a second grouped query; pick the simpler second query).
- Produces: `WorkOrderBoard()` — default board component used by the route shell; navigates to `/planning/work-orders/[id]` on row click and `/planning/print?ids=…` for batch print.

- [ ] **Step 1: Build the board.** Layout, using only existing idioms:
  - Toolbar row: `ui-mono-label` count ("14 work orders"), `ThemedSelect` filters for status + customer + month (options derived from loaded data; "All" default), a text `ui-input` search (matches order no or customer, client-side), spacer, `ui-btn-ghost` "Print selected (N)" (disabled at 0), `ui-btn-primary` "New work order" → `/planning/work-orders/new`.
  - Table inside `ui-panel`: checkbox column, Order (mono), Customer, Model, Type label, Status (`ui-chip`, `ui-chip-accent` for `in_production`), Order date, A# column ("3 missing" in `text-danger` when > 0, "—" when complete).
  - States: `NothingLoadingBlock` while loading; empty state panel with "No work orders yet" + the New button; error state with retry (mirror `sop-list.tsx`'s `loading|ready|error` status pattern).
- [ ] **Step 2: Wire selection → batch print**: `router.push(\`/planning/print?ids=${selected.join(",")}\`)`.
- [ ] **Step 3: Verify** — `npm run typecheck && npm run test`; in `npm run dev`, the board renders empty-state (no orders exist yet).
- [ ] **Step 4: Commit**

```bash
git add src/components/planning/work-order-board.tsx src/components/project-route-shells.tsx
git commit -m "feat(planning): work-order board with filters, search, and batch-print selection"
```

---

### Task 8: New work-order flow

**Files:**
- Create: `src/components/planning/work-order-new.tsx`
- Create: `app/planning/work-orders/new/page.tsx`
- Create: `app/planning/work-orders/[id]/page.tsx` (route only; detail component arrives Task 9 — render a stub that loads the order and shows its order no)
- Create: `src/components/planning/planning-route.tsx` — shared wrapper so sub-routes get the same gate: `PlanningRoute({ children })` renders `AuthProjectGate` + `PlanningWorkspaceProvider` + `PlanningAccessGate` around `children` (extract this from what Task 6 put inline in `PlanningRouteShell`, and reuse it there).

**Interfaces:**
- Consumes: `listTemplates`, `getTemplate`, `createWorkOrder`, `suggestOrderNo` (display-only preview), `usePlanningWorkspace`.
- Produces: `WorkOrderNew()` — template picker + create form; on save navigates to `/planning/work-orders/[id]`.

- [ ] **Step 1: Read `app/sops/[sopId]/page.tsx`** for the App Router params-to-client-component idiom and copy it for the two new routes.
- [ ] **Step 2: Build the flow** (single screen, no wizard):
  - Left `ui-panel`: searchable template list grouped by `model` (group heading = `ui-mono-label`), each row shows name, customer, type label, line count; a "Start blank" row at top.
  - Right `ui-panel`: form — customer (`ui-input`, prefilled from template), model, `ThemedSelect` for type, order date (`ui-input type="date"`, default today), notes (`textarea` with existing `ui-input` styling), read-only "Order no. (suggested)" preview computed from already-loaded orders, line-count summary ("14 lines from template").
  - Create button (`ui-btn-primary`) → `createWorkOrder` with lines copied from `getTemplate` (fulfillment `assembly`, empty `assemblyOrderNo`/`pullFromRef`, `shippedQty: null`) → `router.push` to the detail route. Errors surface via the feedback layer (mirror how `sop-list.tsx` calls it).
- [ ] **Step 3: Verify** — typecheck + tests; dev-run: creating from "Start blank" produces `WO-YYMM-01` and lands on the stub detail page.
- [ ] **Step 4: Commit**

```bash
git add src/components/planning/work-order-new.tsx src/components/planning/planning-route.tsx app/planning/work-orders/
git commit -m "feat(planning): new work-order flow with template picker and monthly numbering"
```

---

### Task 9: Work-order detail editor

**Files:**
- Create: `src/components/planning/work-order-detail.tsx`
- Modify: `app/planning/work-orders/[id]/page.tsx` (swap stub for the real component)

**Interfaces:**
- Consumes: `getWorkOrder`, `updateWorkOrderHeader`, `saveWorkOrderLine`, `addWorkOrderLine`, `deleteWorkOrderLine`, `transitionWorkOrder`, `searchItems`, domain: `canTransitionWorkOrder`, `nextForwardStatus`, `missingAssemblyCount`, `lineNeedsAssemblyNo`, labels; `useConfirm` for destructive/irreversible actions.
- Produces: `WorkOrderDetail({ workOrderId }: { workOrderId: string })`.

- [ ] **Step 1: Header band** — order no (editable `ui-input` for managers, mono), customer/model/date/notes fields (editable while `draft` or `released`; read-only from `in_production` on), status `ui-chip`, "A#s incomplete — N missing" badge (`text-danger`) when `missingAssemblyCount > 0`.
- [ ] **Step 2: Transition button** — primary action shows the forward step (`Release`, `Start production`, `Mark shipped`) guarded by `canTransitionWorkOrder(status, next, { isManager: canManage })`; a `ui-btn-ghost` overflow offers Cancel order (with `useConfirm`) and, for managers, Step back. On `transitionWorkOrder` returning `false`, show "This order changed elsewhere — reloading" and refetch.
- [ ] **Step 3: Line table** — columns: Item no (`ui-input` with autocomplete dropdown fed by `searchItems`, description auto-fills on pick but stays editable), Description, Build qty (number), Fulfillment (`ThemedSelect`: Assembly / Pull from / Pull from stock), A# or Pull ref (single `ui-input` bound to `assemblyOrderNo` or `pullFromRef` per fulfillment; red-bordered when `lineNeedsAssemblyNo`), Shipped qty (enabled only from `in_production`), row delete (ghost icon button + confirm). "Add line" `ui-btn-ghost` at the bottom. Persist per-field on blur via `saveWorkOrderLine`; read-only rendering for viewers (`!canWrite`).
- [ ] **Step 4: Print button** in the header → `/planning/work-orders/[id]/print`.
- [ ] **Step 5: Verify** — typecheck + tests; dev-run a full lifecycle: create → fill A#s → release → start production → enter shipped qty → mark shipped.
- [ ] **Step 6: Commit**

```bash
git add src/components/planning/work-order-detail.tsx app/planning/work-orders/
git commit -m "feat(planning): work-order detail editor with lines, A# tracking, and status transitions"
```

---

### Task 10: Print document + preview + batch routes

**Files:**
- Create: `src/components/planning/work-order-print.tsx`
- Create: `app/planning/work-orders/[id]/print/page.tsx`
- Create: `app/planning/print/page.tsx`

**Interfaces:**
- Consumes: `getWorkOrder`, `usePlanningWorkspace`, `PlanningRoute`, domain labels.
- Produces: `WorkOrderPrintDocument({ order, lines })` (pure render, reused by both routes), `WorkOrderPrintPreview({ workOrderId })`, `BatchPrintPreview({ ids })`.

- [ ] **Step 1: Build the document component.** One printed page per order:
  - Document header: customer (uppercase, large, sans) + order-type label; right-aligned mono block: `Order ${orderNo}` / order date / model.
  - Line table: Item No (mono) | Description | Source (A-number, or "PULL FROM {ref}" / "PULL FROM STOCK {ref}") | Build Qty | Shipped — Shipped renders the entered qty or a signature blank (`__________`).
  - Notes block at the bottom, then a footer rule with "Pulse · printed {date}" in mono caption size.
  - Styling: the sheet is white paper in both themes (precedent: `src/domain/report.ts` documents). Screen preview wraps sheets in the app canvas with a centered `max-w-[820px]` white sheet; include a scoped `<style>` block:

```css
@media print {
  body { background: #fff; }
  .wo-print-chrome { display: none; }
  .wo-sheet { box-shadow: none; margin: 0; border: none; break-after: page; }
  tr { break-inside: avoid; }
}
@page { margin: 14mm; }
```

- [ ] **Step 2: Preview route** — `PlanningRoute`-wrapped client page: slim toolbar (`wo-print-chrome` class): back link (`ui-btn-ghost`), spacer, `ui-btn-primary` "Print" calling `window.print()`. Below, the document.
- [ ] **Step 3: Batch route** — reads `ids` from `useSearchParams()`, loads each order (`Promise.all`), renders documents in sequence (each `.wo-sheet` breaks after page), same toolbar with "Print N work orders". Orders that fail to load are listed by id in a `ui-panel` warning above the stack — never silently dropped.
- [ ] **Step 4: Verify** — typecheck + tests; dev-run: preview one order, print-preview in browser (Cmd+P) shows one clean page; batch with 2 ids shows 2 pages.
- [ ] **Step 5: Commit**

```bash
git add src/components/planning/work-order-print.tsx app/planning/work-orders/ app/planning/print/
git commit -m "feat(planning): print documents with single preview and batch print routes"
```

---

### Task 11: Settings — imports + template library

**Files:**
- Create: `src/components/planning/planning-settings.tsx`
- Create: `src/components/planning/template-library.tsx`
- Modify: `src/components/planning/planning-shell.tsx` (settings entry point: `ui-btn-ghost` gear in the header actions, opens the settings surface — a full-width section below the board header is fine; no new modal idiom)

**Interfaces:**
- Consumes: `readWorkbookFile`, `readItemMasterFile`, `parseTemplateSheet`, `parseItemMasterRows`, `diffItemMaster`, `importTemplates`, `upsertItemMaster`, `listTemplates`, `getTemplate`, `saveTemplate`, `retireTemplate`, `usePlanningWorkspace` (`canWrite` gates everything here).
- Produces: `PlanningSettings()`, `TemplateLibrary()`.

- [ ] **Step 1: Item-master upload** — hidden `<input type="file" accept=".xlsx,.xls,.csv">` behind a `ui-btn-ghost` "Upload item master" (idiom: `project-catalog-setup-panel.tsx`). Flow: read → parse → preview panel ("9,034 items parsed · 2 rows rejected (rows 14, 890)" + first 5 items as a sample table) → "Apply" runs `upsertItemMaster` → feedback toast "128 added, 8,906 updated". Parse errors render in the panel, not a toast.
- [ ] **Step 2: Workbook import** — same file-input idiom, "Import work-order workbook". After parsing every sheet: preview table, one row per sheet — parsed name, customer (editable `ui-input`), model (editable), type (`ThemedSelect`), line count, warnings expandable; unparseable sheets listed in a separate "Skipped" list with reasons. "Import N templates" commits via `importTemplates`; failures reported per sheet.
- [ ] **Step 3: Template library** — list grouped by model: name, customer, type, line count, retired chip; actions: edit (inline expansion with the same line-editing table pattern as Task 9 minus A#/shipped columns), duplicate (copy with " (copy)" suffix), retire/unretire (confirm). Retired templates hidden from the Task 8 picker (`listTemplates` default excludes them).
- [ ] **Step 4: Verify** — typecheck + tests; dev-run: upload the real workbook (`~/Downloads/MTS Work Orders Master - DEC - CYP.xlsx`), confirm ~48 sheets parse with sane customers/models and DATA is skipped; import; upload the DATA sheet re-exported as its own file (or any BC export) for the item master.
- [ ] **Step 5: Commit**

```bash
git add src/components/planning/planning-settings.tsx src/components/planning/template-library.tsx src/components/planning/planning-shell.tsx
git commit -m "feat(planning): item-master upload, workbook template import, and template library"
```

---

### Task 12: Admin access toggle + dashboard lock

**Files:**
- Modify: `src/components/workspace-members-settings.tsx` (Planning access toggle per member)
- Modify: `src/components/company-dashboard.tsx` (locked Planning card)
- Modify: `src/components/spaces.tsx` (only if the locked-state needs a label helper; prefer reusing `spaceDisabledLabel`)

**Interfaces:**
- Consumes: `listSpaceAccess`, `grantSpaceAccess`, `revokeSpaceAccess`, `fetchMySpaceAccess`.

- [ ] **Step 1: Read `src/components/workspace-members-settings.tsx`** to find the member-row render. Add a "Planning" column visible to managers: owners/admins show a static "Included" (`ui-chip`); editors/viewers get a toggle (existing checkbox/switch idiom in that file — reuse whatever it uses; if it has none, a `ui-btn-ghost` Grant/Revoke text button is fine). Wire to `grantSpaceAccess`/`revokeSpaceAccess` with optimistic update + error rollback.
- [ ] **Step 2: Dashboard lock** — in `company-dashboard.tsx`, for the `planning` card: when the user's role is editor/viewer and `fetchMySpaceAccess(workspaceId, "planning")` resolves false, render the card in the existing disabled style with chip text "Restricted" (reuse the `disabled` branch in `DashboardCard`, adding an optional `lockedLabel` prop rather than a new visual treatment). While access is unknown, render the card normally (the route gate still protects it).
- [ ] **Step 3: Verify** — typecheck + tests; dev-run: revoke your own grant on a non-admin test account (or temporarily force role) and confirm: dashboard card restricted, `/planning` shows the request-access panel, RLS blocks direct fetches (network tab shows empty results, not errors).
- [ ] **Step 4: Commit**

```bash
git add src/components/workspace-members-settings.tsx src/components/company-dashboard.tsx src/components/spaces.tsx
git commit -m "feat(planning): admin-managed planning access with locked dashboard card"
```

---

### Task 13: Full verification gate + push

- [ ] **Step 1: Full gate**

Run: `npm run typecheck && npm run test && npm run lint && npm run build`
Expected: typecheck clean; all tests pass (195 pre-existing + new domain/parser suites); lint introduces no new warnings in planning files; build succeeds with the new `/planning/*` routes listed.

- [ ] **Step 2: End-to-end smoke in dev** — the planner's day: import workbook → create order from "HEAD UNIT 70-40 UR" → fill two A#s → release → print preview → batch print with a second order → start production → shipped qty → mark shipped → board shows the lifecycle.

- [ ] **Step 3: Push**

```bash
git push
```

---

## Self-review notes (completed)

- **Spec coverage:** data model (T1), monthly numbering (T2/T5), board+filters+batch select (T7), creation flow (T8), detail/A#/status/shipped (T9), print preview + batch (T10), workbook + item-master imports + template library (T11), space gate at RLS/route/dashboard + admin UI (T6/T12), theme fidelity (global constraint), testing (T2/T3/T4 TDD + T13 gate). Out-of-scope items from the spec remain out.
- **Type consistency:** `WorkOrderStatus/WorkOrderType/WorkOrderFulfillment` defined once in `src/domain/work-orders.ts`; store maps snake_case→camelCase at its boundary; `ParsedTemplateSheet`/`ParsedItemMasterRow` flow from parsers → store import functions → settings UI.
- **Known judgment calls:** `buildTransitionPatch` preserves progress stamps on cancel (revive-friendly); line hard-deletes are editor-level while order hard-deletes are admin-level; `space_access.space` check-constrained to `('planning','production')`.
