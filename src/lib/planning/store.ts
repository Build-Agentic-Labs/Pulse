/**
 * Supabase-backed persistence for the Planning space: work orders, work-order templates, the
 * item master, and space_access grants. Mirrors the CRUD idioms in `src/lib/sop/store.ts`:
 * explicit column projections (never `select('*')`), every query scoped by `workspace_id`,
 * `created_by` sourced from `supabase.auth.getUser()` on inserts, `created_at`/`updated_at` left
 * for the DB to own, snake_case rows mapped to camelCase types at the store boundary, and
 * Supabase errors re-thrown as human-readable `Error`s.
 */

import {
  buildTransitionPatch,
  ORDER_TYPE_PREFIXES,
  orderNoMonthKey,
  setNoFromOrderNo,
  suggestOrderNo,
  trailerOrderNo,
  type WorkOrderFulfillment,
  type WorkOrderStatus,
  type WorkOrderType,
} from "@/domain/work-orders";
import { createPlannerSupabaseClient } from "@/domain/supabase-planner";
import type { WorkOrderMatchInfo } from "@/components/planning/work-order-print";
import { diffItemMaster, type ParsedItemMasterRow } from "./parse-item-master";
import type { ParsedTemplateSheet } from "./parse-workbook";

type PlannerSupabaseClient = ReturnType<typeof createPlannerSupabaseClient>;

// ── types ─────────────────────────────────────────────────────────────────

/** One row of the work-order list -- the promoted header fields, cheap to fetch for every order. */
export interface WorkOrderSummary {
  id: string;
  orderNo: string;
  customer: string;
  model: string;
  orderType: WorkOrderType;
  status: WorkOrderStatus;
  orderDate: string;
  updatedAt: string;
  /** Short set/match number shared by a Gen↔PM pair, e.g. "01"; "" for unset/legacy orders. */
  setNo: string;
  /** Trailer configuration letter — set on Mains (the trailer they pair with) and TRL orders. "" if none. */
  trailerLetter: string;
  /** On a PM order, the id of the Main it married to; null otherwise. */
  mainOrderId: string | null;
  /** Count of this order's lines still missing their assembly order number (see `lineNeedsAssemblyNo`). */
  missingAssemblyCount: number;
}

export interface WorkOrderLine {
  id: string;
  itemNo: string;
  description: string;
  buildQty: number;
  shippedQty: number | null;
  fulfillment: WorkOrderFulfillment;
  assemblyOrderNo: string;
  pullFromRef: string;
}

/** The full work order -- header fields plus its lines, for the detail/editor surface. */
export interface WorkOrderDetail {
  id: string;
  orderNo: string;
  templateId: string | null;
  customer: string;
  model: string;
  orderType: WorkOrderType;
  status: WorkOrderStatus;
  orderDate: string;
  notes: string;
  /** Short set/match number shared by a Gen↔PM pair, e.g. "01"; "" for unset/legacy orders. */
  setNo: string;
  /** Trailer configuration letter — set on Mains (the trailer they pair with) and TRL orders. "" if none. */
  trailerLetter: string;
  /** On a PM order, the id of the Main it married to; null otherwise. */
  mainOrderId: string | null;
  releasedAt: string | null;
  productionStartedAt: string | null;
  shippedAt: string | null;
  cancelledAt: string | null;
  createdAt: string;
  updatedAt: string;
  lines: WorkOrderLine[];
}

export interface TemplateSummary {
  id: string;
  name: string;
  customer: string;
  model: string;
  orderType: WorkOrderType;
  retiredAt: string | null;
  updatedAt: string;
  /** Set definition: the PM template that auto-creates with a Main built from this template. Null = none. */
  pmTemplateId: string | null;
  /** Set definition: default trailer configuration letter for orders from this template. "" = none. */
  defaultTrailerLetter: string;
  /** Count of the template's lines; filled in separately by `listTemplates`, once counts are known. */
  lineCount: number;
}

export interface TemplateLine {
  id: string;
  itemNo: string;
  description: string;
  buildQty: number;
  position: number;
}

export interface TemplateDetail {
  id: string;
  name: string;
  customer: string;
  model: string;
  orderType: WorkOrderType;
  notesDefault: string;
  /** Set definition: the PM template that auto-creates with a Main built from this template. Null = none. */
  pmTemplateId: string | null;
  /** Set definition: default trailer configuration letter for orders from this template. "" = none. */
  defaultTrailerLetter: string;
  retiredAt: string | null;
  createdAt: string;
  updatedAt: string;
  lines: TemplateLine[];
}

export interface SpaceAccessRow {
  userId: string;
  space: string;
  grantedBy: string | null;
  createdAt: string;
}

/** A trailer supermarket configuration: letter → human name → optional trailer template. */
export interface TrailerConfig {
  letter: string;
  name: string;
  trailerTemplateId: string | null;
  updatedAt: string;
}

/** The auto-created Power Module half of a Gen↔PM set, supplied alongside a `head_unit` order. */
export interface CreateWorkOrderPmInput {
  templateId: string | null;
  lines: Array<Omit<WorkOrderLine, "id">>;
  customer: string;
  model: string;
  notes: string;
}

export interface CreateWorkOrderInput {
  templateId: string | null;
  customer: string;
  model: string;
  orderType: WorkOrderType;
  orderDate: string;
  notes: string;
  lines: Array<Omit<WorkOrderLine, "id">>;
  /** Trailer configuration letter: required for `trailer` orders, the paired trailer for a Main. */
  trailerLetter?: string;
  /** When present on a `head_unit` order, also creates the married Power Module order. */
  pm?: CreateWorkOrderPmInput | null;
}

/** The created order's id + number, plus the PM's when a set was created. */
export interface CreateWorkOrderResult {
  id: string;
  orderNo: string;
  pmId?: string;
  pmOrderNo?: string;
}

// ── column projections ───────────────────────────────────────────────────

const WORK_ORDER_LIST_COLUMNS =
  "id, order_no, customer, model, order_type, status, order_date, set_no, trailer_letter, main_order_id, updated_at";
const WORK_ORDER_COLUMNS =
  "id, order_no, template_id, customer, model, order_type, status, order_date, notes, set_no, trailer_letter, main_order_id, released_at, production_started_at, shipped_at, cancelled_at, created_at, updated_at";
const WORK_ORDER_LINE_COLUMNS =
  "id, item_no, description, build_qty, shipped_qty, fulfillment, assembly_order_no, pull_from_ref, position";

const TEMPLATE_LIST_COLUMNS =
  "id, name, customer, model, order_type, pm_template_id, default_trailer_letter, retired_at, updated_at";
const TEMPLATE_COLUMNS =
  "id, name, customer, model, order_type, notes_default, pm_template_id, default_trailer_letter, retired_at, created_at, updated_at";
const TEMPLATE_LINE_COLUMNS = "id, item_no, description, build_qty, position";

const TRAILER_CONFIG_COLUMNS = "letter, name, trailer_template_id, updated_at";

// ── validation helpers ───────────────────────────────────────────────────

/**
 * Normalize an optional trailer-configuration letter (a Main's override or a template's default):
 * trimmed + uppercased, and required to be either "" (none) or a single A–Z. Same rule and message
 * as the trailer-order path, applied wherever a letter is persisted rather than used to build a number.
 */
function normalizeOptionalTrailerLetter(value: string | null | undefined): string {
  const letter = (value ?? "").trim().toUpperCase();
  if (letter !== "" && !/^[A-Z]$/.test(letter)) {
    throw new Error("A trailer configuration letter must be a single letter A–Z.");
  }
  return letter;
}

// ── mappers (snake_case rows -> camelCase types) ─────────────────────────

/** `missingAssemblyCount` is filled in separately by `listWorkOrders`, once counts are known. */
function mapWorkOrderSummary(row: Record<string, unknown>): WorkOrderSummary {
  return {
    id: String(row.id),
    orderNo: String(row.order_no ?? ""),
    customer: String(row.customer ?? ""),
    model: String(row.model ?? ""),
    orderType: (row.order_type as WorkOrderType) ?? "mts",
    status: (row.status as WorkOrderStatus) ?? "draft",
    orderDate: String(row.order_date ?? ""),
    updatedAt: String(row.updated_at ?? ""),
    setNo: String(row.set_no ?? ""),
    trailerLetter: String(row.trailer_letter ?? ""),
    mainOrderId: row.main_order_id ? String(row.main_order_id) : null,
    missingAssemblyCount: 0,
  };
}

function mapWorkOrderLine(row: Record<string, unknown>): WorkOrderLine {
  return {
    id: String(row.id),
    itemNo: String(row.item_no ?? ""),
    description: String(row.description ?? ""),
    buildQty: Number(row.build_qty ?? 0),
    shippedQty: row.shipped_qty === null || row.shipped_qty === undefined ? null : Number(row.shipped_qty),
    fulfillment: (row.fulfillment as WorkOrderFulfillment) ?? "assembly",
    assemblyOrderNo: String(row.assembly_order_no ?? ""),
    pullFromRef: String(row.pull_from_ref ?? ""),
  };
}

function mapWorkOrderDetail(header: Record<string, unknown>, lines: Record<string, unknown>[]): WorkOrderDetail {
  return {
    id: String(header.id),
    orderNo: String(header.order_no ?? ""),
    templateId: header.template_id ? String(header.template_id) : null,
    customer: String(header.customer ?? ""),
    model: String(header.model ?? ""),
    orderType: (header.order_type as WorkOrderType) ?? "mts",
    status: (header.status as WorkOrderStatus) ?? "draft",
    orderDate: String(header.order_date ?? ""),
    notes: String(header.notes ?? ""),
    setNo: String(header.set_no ?? ""),
    trailerLetter: String(header.trailer_letter ?? ""),
    mainOrderId: header.main_order_id ? String(header.main_order_id) : null,
    releasedAt: header.released_at ? String(header.released_at) : null,
    productionStartedAt: header.production_started_at ? String(header.production_started_at) : null,
    shippedAt: header.shipped_at ? String(header.shipped_at) : null,
    cancelledAt: header.cancelled_at ? String(header.cancelled_at) : null,
    createdAt: String(header.created_at ?? ""),
    updatedAt: String(header.updated_at ?? ""),
    lines: lines.map(mapWorkOrderLine),
  };
}

/** `lineCount` is filled in separately by `listTemplates`, once counts are known. */
function mapTemplateSummary(row: Record<string, unknown>): TemplateSummary {
  return {
    id: String(row.id),
    name: String(row.name ?? ""),
    customer: String(row.customer ?? ""),
    model: String(row.model ?? ""),
    orderType: (row.order_type as WorkOrderType) ?? "mts",
    pmTemplateId: row.pm_template_id ? String(row.pm_template_id) : null,
    defaultTrailerLetter: String(row.default_trailer_letter ?? ""),
    retiredAt: row.retired_at ? String(row.retired_at) : null,
    updatedAt: String(row.updated_at ?? ""),
    lineCount: 0,
  };
}

function mapTemplateLine(row: Record<string, unknown>): TemplateLine {
  return {
    id: String(row.id),
    itemNo: String(row.item_no ?? ""),
    description: String(row.description ?? ""),
    buildQty: Number(row.build_qty ?? 0),
    position: Number(row.position ?? 0),
  };
}

function mapTemplateDetail(header: Record<string, unknown>, lines: Record<string, unknown>[]): TemplateDetail {
  return {
    id: String(header.id),
    name: String(header.name ?? ""),
    customer: String(header.customer ?? ""),
    model: String(header.model ?? ""),
    orderType: (header.order_type as WorkOrderType) ?? "mts",
    notesDefault: String(header.notes_default ?? ""),
    pmTemplateId: header.pm_template_id ? String(header.pm_template_id) : null,
    defaultTrailerLetter: String(header.default_trailer_letter ?? ""),
    retiredAt: header.retired_at ? String(header.retired_at) : null,
    createdAt: String(header.created_at ?? ""),
    updatedAt: String(header.updated_at ?? ""),
    lines: lines.map(mapTemplateLine),
  };
}

function mapSpaceAccessRow(row: Record<string, unknown>): SpaceAccessRow {
  return {
    userId: String(row.user_id),
    space: String(row.space ?? ""),
    grantedBy: row.granted_by ? String(row.granted_by) : null,
    createdAt: String(row.created_at ?? ""),
  };
}

function mapTrailerConfig(row: Record<string, unknown>): TrailerConfig {
  return {
    letter: String(row.letter ?? ""),
    name: String(row.name ?? ""),
    trailerTemplateId: row.trailer_template_id ? String(row.trailer_template_id) : null,
    updatedAt: String(row.updated_at ?? ""),
  };
}

// ── work orders ───────────────────────────────────────────────────────────

export async function listWorkOrders(workspaceId: string): Promise<WorkOrderSummary[]> {
  const supabase = createPlannerSupabaseClient();
  const { data, error } = await supabase
    .from("work_orders")
    .select(WORK_ORDER_LIST_COLUMNS)
    .eq("workspace_id", workspaceId)
    .order("order_date", { ascending: false })
    .order("order_no", { ascending: false });
  if (error) {
    throw new Error(`Could not load work orders: ${error.message}`);
  }
  const summaries = (data ?? []).map(mapWorkOrderSummary);
  if (summaries.length === 0) {
    return summaries;
  }

  // Second, simple query for the board's A#-completeness column: fetch only the lines that are
  // actually missing their assembly order number (assembly fulfillment, blank assembly_order_no)
  // and tally them per order, client-side. Keeps the primary list query a flat header projection
  // rather than a join/aggregate, and keeps this one narrow instead of fetching every line.
  const { data: lineRows, error: linesError } = await supabase
    .from("work_order_lines")
    .select("work_order_id")
    .eq("workspace_id", workspaceId)
    .eq("fulfillment", "assembly")
    .eq("assembly_order_no", "");
  if (linesError) {
    throw new Error(`Could not load work-order completeness: ${linesError.message}`);
  }

  const missingByOrderId = new Map<string, number>();
  for (const row of lineRows ?? []) {
    const orderId = String(row.work_order_id);
    missingByOrderId.set(orderId, (missingByOrderId.get(orderId) ?? 0) + 1);
  }

  return summaries.map((summary) => ({
    ...summary,
    missingAssemblyCount: missingByOrderId.get(summary.id) ?? 0,
  }));
}

export async function getWorkOrder(workspaceId: string, id: string): Promise<WorkOrderDetail | null> {
  const supabase = createPlannerSupabaseClient();
  const { data: header, error: headerError } = await supabase
    .from("work_orders")
    .select(WORK_ORDER_COLUMNS)
    .eq("workspace_id", workspaceId)
    .eq("id", id)
    .maybeSingle();
  if (headerError) {
    throw new Error(`Could not load the work order: ${headerError.message}`);
  }
  if (!header) {
    return null;
  }

  const { data: lines, error: linesError } = await supabase
    .from("work_order_lines")
    .select(WORK_ORDER_LINE_COLUMNS)
    .eq("workspace_id", workspaceId)
    .eq("work_order_id", id)
    .order("position", { ascending: true });
  if (linesError) {
    throw new Error(`Could not load the work order's lines: ${linesError.message}`);
  }

  return mapWorkOrderDetail(header, lines ?? []);
}

/**
 * Insert a work order's lines, positioned by array order. Throws a message naming the (already
 * created) order so a partial failure surfaces the number rather than a bare Postgres error.
 */
async function insertWorkOrderLines(
  supabase: PlannerSupabaseClient,
  workspaceId: string,
  workOrderId: string,
  orderNo: string,
  lines: ReadonlyArray<Omit<WorkOrderLine, "id">>,
): Promise<void> {
  if (lines.length === 0) {
    return;
  }
  const { error } = await supabase.from("work_order_lines").insert(
    lines.map((line, index) => ({
      work_order_id: workOrderId,
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
  if (error) {
    throw new Error(`Order ${orderNo} was created but its lines failed: ${error.message}`);
  }
}

/** The month's existing GEN+PM order numbers — the shared pool a set's NN is drawn from. */
async function fetchGenPmOrderNos(
  supabase: PlannerSupabaseClient,
  workspaceId: string,
  mmyy: string,
): Promise<string[]> {
  const monthOrFilter = [ORDER_TYPE_PREFIXES.head_unit, ORDER_TYPE_PREFIXES.power_module]
    .map((prefix) => `order_no.ilike.${prefix}-${mmyy}-%`)
    .join(",");
  const { data, error } = await supabase
    .from("work_orders")
    .select("order_no")
    .eq("workspace_id", workspaceId)
    .or(monthOrFilter);
  if (error) {
    throw new Error(`Could not load existing order numbers: ${error.message}`);
  }
  return (data ?? []).map((row) => String(row.order_no));
}

/**
 * Create a work order. Three shapes:
 *  - `head_unit` with `pm`: creates the married Gen↔PM set — Main `GEN-MMYY-NN` and Power Module
 *    `PM-MMYY-NN` sharing one NN (computed once from the shared GEN+PM pool). Retries the pair once
 *    on a 23505 race; if the PM cannot land after the Main did, throws naming the Main (never drops it).
 *  - `trailer`: requires a valid A–Z `trailerLetter`, numbers as `TRL-MMYY-{LETTER}`; a duplicate in
 *    the month is a semantic collision (one order per config/month) surfaced as a friendly Error — no retry.
 *  - everything else (including a `head_unit` with no `pm`): the type's own prefix, recompute-once on race.
 */
export async function createWorkOrder(
  workspaceId: string,
  input: CreateWorkOrderInput,
): Promise<CreateWorkOrderResult> {
  const supabase = createPlannerSupabaseClient();
  const { data: userData } = await supabase.auth.getUser();
  const createdBy = userData.user?.id ?? null;
  const mmyy = orderNoMonthKey(input.orderDate);

  if (input.orderType === "trailer") {
    return createTrailerWorkOrder(supabase, workspaceId, input, createdBy);
  }
  if (input.orderType === "head_unit" && input.pm) {
    return createGenPmSet(supabase, workspaceId, input, input.pm, mmyy, createdBy);
  }

  // Default path: the type's own prefix (head_unit/power_module share the GEN+PM pool via suggestOrderNo).
  // A Main with no PM may still carry a trailer letter; other types never do.
  const defaultTrailerLetter =
    input.orderType === "head_unit" ? normalizeOptionalTrailerLetter(input.trailerLetter) : "";
  const scanPrefixes =
    input.orderType === "head_unit" || input.orderType === "power_module"
      ? [ORDER_TYPE_PREFIXES.head_unit, ORDER_TYPE_PREFIXES.power_module]
      : [ORDER_TYPE_PREFIXES[input.orderType]];
  const monthOrFilter = scanPrefixes.map((prefix) => `order_no.ilike.${prefix}-${mmyy}-%`).join(",");

  for (let attempt = 0; attempt < 2; attempt += 1) {
    const { data: existing, error: existingError } = await supabase
      .from("work_orders")
      .select("order_no")
      .eq("workspace_id", workspaceId)
      .or(monthOrFilter);
    if (existingError) {
      throw new Error(`Could not load existing order numbers: ${existingError.message}`);
    }
    const orderNo = suggestOrderNo(
      (existing ?? []).map((row) => row.order_no),
      input.orderDate,
      input.orderType,
    );

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
        set_no: setNoFromOrderNo(orderNo),
        trailer_letter: defaultTrailerLetter,
        created_by: createdBy,
      })
      .select("id")
      .single();
    if (insertError) {
      if (insertError.code === "23505" && attempt === 0) {
        continue; // Someone took the number between select and insert — recompute.
      }
      throw new Error(`Could not create the work order: ${insertError.message}`);
    }

    await insertWorkOrderLines(supabase, workspaceId, inserted.id, orderNo, input.lines);
    return { id: inserted.id, orderNo };
  }
  throw new Error("Could not allocate a unique order number; try again.");
}

/** Trailer supermarket order: one per config letter per month; a 23505 is a semantic duplicate. */
async function createTrailerWorkOrder(
  supabase: PlannerSupabaseClient,
  workspaceId: string,
  input: CreateWorkOrderInput,
  createdBy: string | null,
): Promise<CreateWorkOrderResult> {
  const letter = (input.trailerLetter ?? "").trim().toUpperCase();
  // The domain's trailerOrderNo does not validate the letter — reject here before building a number.
  if (!/^[A-Z]$/.test(letter)) {
    throw new Error("A trailer configuration letter (A–Z) is required to create a trailer order.");
  }
  const orderNo = trailerOrderNo(input.orderDate, letter);

  const { data: inserted, error: insertError } = await supabase
    .from("work_orders")
    .insert({
      workspace_id: workspaceId,
      order_no: orderNo,
      template_id: input.templateId,
      customer: input.customer,
      model: input.model,
      order_type: "trailer",
      order_date: input.orderDate,
      notes: input.notes,
      trailer_letter: letter,
      set_no: setNoFromOrderNo(orderNo),
      created_by: createdBy,
    })
    .select("id")
    .single();
  if (insertError) {
    if (insertError.code === "23505") {
      throw new Error(
        `${orderNo} already exists for this month — open it and raise its build quantity instead.`,
      );
    }
    throw new Error(`Could not create the work order: ${insertError.message}`);
  }

  await insertWorkOrderLines(supabase, workspaceId, inserted.id, orderNo, input.lines);
  return { id: inserted.id, orderNo };
}

/**
 * Create the married Gen↔PM set. NN is computed ONCE per attempt from the shared GEN+PM pool so the
 * Main (`GEN-MMYY-NN`) and Power Module (`PM-MMYY-NN`) always carry the same set number. A 23505 on
 * either insert retries the whole pair once with a fresh NN (the Main is deleted first — its lines
 * cascade — so no orphan). If the PM still cannot land after the Main did, the Main is left in place
 * and an Error naming it is thrown, so the created Main is never silently dropped.
 */
async function createGenPmSet(
  supabase: PlannerSupabaseClient,
  workspaceId: string,
  input: CreateWorkOrderInput,
  pm: CreateWorkOrderPmInput,
  mmyy: string,
  createdBy: string | null,
): Promise<CreateWorkOrderResult> {
  const mainTrailerLetter = normalizeOptionalTrailerLetter(input.trailerLetter);

  for (let attempt = 0; attempt < 2; attempt += 1) {
    const existing = await fetchGenPmOrderNos(supabase, workspaceId, mmyy);
    const mainOrderNo = suggestOrderNo(existing, input.orderDate, "head_unit");
    const setNo = setNoFromOrderNo(mainOrderNo);
    const pmOrderNo = `${ORDER_TYPE_PREFIXES.power_module}-${mmyy}-${setNo}`;

    const { data: mainInserted, error: mainError } = await supabase
      .from("work_orders")
      .insert({
        workspace_id: workspaceId,
        order_no: mainOrderNo,
        template_id: input.templateId,
        customer: input.customer,
        model: input.model,
        order_type: "head_unit",
        order_date: input.orderDate,
        notes: input.notes,
        set_no: setNo,
        trailer_letter: mainTrailerLetter,
        created_by: createdBy,
      })
      .select("id")
      .single();
    if (mainError) {
      if (mainError.code === "23505" && attempt === 0) {
        continue; // NN taken between scan and insert — recompute the pair.
      }
      throw new Error(`Could not create the work order: ${mainError.message}`);
    }

    // Main landed. Its lines cascade on delete, so it is safe to insert them before the PM.
    await insertWorkOrderLines(supabase, workspaceId, mainInserted.id, mainOrderNo, input.lines);

    const { data: pmInserted, error: pmError } = await supabase
      .from("work_orders")
      .insert({
        workspace_id: workspaceId,
        order_no: pmOrderNo,
        template_id: pm.templateId,
        customer: pm.customer,
        model: pm.model,
        order_type: "power_module",
        order_date: input.orderDate,
        notes: pm.notes,
        set_no: setNo,
        main_order_id: mainInserted.id,
        created_by: createdBy,
      })
      .select("id")
      .single();
    if (pmError) {
      if (pmError.code === "23505" && attempt === 0) {
        // Roll the Main back (lines cascade) and retry the pair once with a fresh NN. `.select("id")`
        // verifies a row was actually deleted: RLS can permit an INSERT but silently drop a DELETE
        // (0 rows, no error), which would otherwise strand an orphan Main AND let the retry create a
        // duplicate set. On a failed rollback, surface a clear error instead of silently retrying.
        const { data: rolledBack, error: rollbackError } = await supabase
          .from("work_orders")
          .delete()
          .eq("workspace_id", workspaceId)
          .eq("id", mainInserted.id)
          .select("id");
        if (rollbackError || !rolledBack || rolledBack.length === 0) {
          throw new Error(
            `${mainOrderNo} was created but its power module could not be assigned a number and the generator ` +
              `could not be rolled back automatically. Ask a workspace admin to delete order ${mainOrderNo}, then try again.`,
          );
        }
        continue;
      }
      throw new Error(`${mainOrderNo} was created but its power module failed: ${pmError.message}`);
    }

    await insertWorkOrderLines(supabase, workspaceId, pmInserted.id, pmOrderNo, pm.lines);
    return { id: mainInserted.id, orderNo: mainOrderNo, pmId: pmInserted.id, pmOrderNo };
  }
  throw new Error("Could not allocate a unique set number; try again.");
}

export async function updateWorkOrderHeader(
  workspaceId: string,
  id: string,
  patch: { customer?: string; model?: string; orderDate?: string; notes?: string; orderNo?: string },
): Promise<void> {
  const supabase = createPlannerSupabaseClient();
  const row: Record<string, unknown> = {};
  if (patch.customer !== undefined) row.customer = patch.customer;
  if (patch.model !== undefined) row.model = patch.model;
  if (patch.orderDate !== undefined) row.order_date = patch.orderDate;
  if (patch.notes !== undefined) row.notes = patch.notes;
  if (patch.orderNo !== undefined) row.order_no = patch.orderNo;

  const { error } = await supabase.from("work_orders").update(row).eq("workspace_id", workspaceId).eq("id", id);
  if (error) {
    throw new Error(`Could not update the work order: ${error.message}`);
  }
}

export async function saveWorkOrderLine(
  workspaceId: string,
  lineId: string,
  patch: Partial<Omit<WorkOrderLine, "id">>,
): Promise<void> {
  const supabase = createPlannerSupabaseClient();
  const row: Record<string, unknown> = {};
  if (patch.itemNo !== undefined) row.item_no = patch.itemNo;
  if (patch.description !== undefined) row.description = patch.description;
  if (patch.buildQty !== undefined) row.build_qty = patch.buildQty;
  if (patch.shippedQty !== undefined) row.shipped_qty = patch.shippedQty;
  if (patch.fulfillment !== undefined) row.fulfillment = patch.fulfillment;
  if (patch.assemblyOrderNo !== undefined) row.assembly_order_no = patch.assemblyOrderNo;
  if (patch.pullFromRef !== undefined) row.pull_from_ref = patch.pullFromRef;

  const { error } = await supabase
    .from("work_order_lines")
    .update(row)
    .eq("workspace_id", workspaceId)
    .eq("id", lineId);
  if (error) {
    throw new Error(`Could not save the line: ${error.message}`);
  }
}

export async function addWorkOrderLine(
  workspaceId: string,
  workOrderId: string,
  line: Omit<WorkOrderLine, "id">,
): Promise<string> {
  const supabase = createPlannerSupabaseClient();

  // Append at the end: look at the highest existing position rather than a row count, so a
  // prior deletion doesn't cause a duplicate position.
  const { data: lastLine, error: lastLineError } = await supabase
    .from("work_order_lines")
    .select("position")
    .eq("workspace_id", workspaceId)
    .eq("work_order_id", workOrderId)
    .order("position", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (lastLineError) {
    throw new Error(`Could not determine the next line position: ${lastLineError.message}`);
  }
  const nextPosition = lastLine ? Number(lastLine.position ?? 0) + 1 : 0;

  const { data: inserted, error: insertError } = await supabase
    .from("work_order_lines")
    .insert({
      work_order_id: workOrderId,
      workspace_id: workspaceId,
      item_no: line.itemNo,
      description: line.description,
      build_qty: line.buildQty,
      shipped_qty: line.shippedQty,
      fulfillment: line.fulfillment,
      assembly_order_no: line.assemblyOrderNo,
      pull_from_ref: line.pullFromRef,
      position: nextPosition,
    })
    .select("id")
    .single();
  if (insertError) {
    throw new Error(`Could not add the line: ${insertError.message}`);
  }
  return inserted.id;
}

export async function deleteWorkOrderLine(workspaceId: string, lineId: string): Promise<void> {
  const supabase = createPlannerSupabaseClient();
  const { error } = await supabase
    .from("work_order_lines")
    .delete()
    .eq("workspace_id", workspaceId)
    .eq("id", lineId);
  if (error) {
    throw new Error(`Could not delete the line: ${error.message}`);
  }
}

/**
 * Guarded status transition: the update only applies if the row is still in the `from` status,
 * so a concurrent transition (another tab/user moving the same order) loses the race safely
 * instead of silently overwriting it. Returns false when zero rows matched.
 */
export async function transitionWorkOrder(
  workspaceId: string,
  id: string,
  from: WorkOrderStatus,
  to: WorkOrderStatus,
): Promise<boolean> {
  const supabase = createPlannerSupabaseClient();
  const { data, error } = await supabase
    .from("work_orders")
    .update(buildTransitionPatch(to, new Date().toISOString()))
    .eq("workspace_id", workspaceId)
    .eq("id", id)
    .eq("status", from)
    .select("id");
  if (error) {
    throw new Error(`Could not transition the work order: ${error.message}`);
  }
  return (data ?? []).length > 0;
}

/**
 * The final-assembly match strip for a Main (`head_unit`) order: its set number, the paired PM's
 * order number (reverse lookup by `main_order_id`), and the trailer letter with its catalog name.
 * Returns null for non-Main types — PM and trailer sheets do not carry the strip in v1.
 */
export async function getWorkOrderMatch(
  workspaceId: string,
  order: {
    id: string;
    orderNo: string;
    orderType: WorkOrderType;
    setNo: string;
    trailerLetter: string;
    mainOrderId: string | null;
  },
): Promise<WorkOrderMatchInfo | null> {
  if (order.orderType !== "head_unit") {
    return null;
  }
  const supabase = createPlannerSupabaseClient();

  // Paired Power Module: the PM order whose main_order_id points back at this Main. Take the
  // earliest by created_at (rather than .maybeSingle(), which errors if a Main ever has more
  // than one PM pointing at it — degrade to the first marriage instead of throwing).
  const { data: pmRows, error: pmError } = await supabase
    .from("work_orders")
    .select("order_no")
    .eq("workspace_id", workspaceId)
    .eq("main_order_id", order.id)
    .order("created_at", { ascending: true })
    .limit(1);
  if (pmError) {
    throw new Error(`Could not load the paired power module: ${pmError.message}`);
  }
  const pmRow = pmRows?.[0] ?? null;

  const trailerLetter = order.trailerLetter.trim().toUpperCase() || null;
  let trailerConfigName: string | null = null;
  if (trailerLetter) {
    const { data: configRow, error: configError } = await supabase
      .from("trailer_configs")
      .select("name")
      .eq("workspace_id", workspaceId)
      .eq("letter", trailerLetter)
      .maybeSingle();
    if (configError) {
      throw new Error(`Could not load the trailer configuration: ${configError.message}`);
    }
    trailerConfigName = configRow ? String(configRow.name ?? "") || null : null;
  }

  return {
    setNo: order.setNo || setNoFromOrderNo(order.orderNo),
    pmOrderNo: pmRow ? String(pmRow.order_no ?? "") || null : null,
    trailerLetter,
    trailerConfigName,
  };
}

// ── templates ─────────────────────────────────────────────────────────────

export async function listTemplates(
  workspaceId: string,
  options: { includeRetired?: boolean } = {},
): Promise<TemplateSummary[]> {
  const supabase = createPlannerSupabaseClient();
  const base = supabase.from("work_order_templates").select(TEMPLATE_LIST_COLUMNS).eq("workspace_id", workspaceId);
  const scoped = options.includeRetired ? base : base.is("retired_at", null);
  const { data, error } = await scoped.order("name", { ascending: true });
  if (error) {
    throw new Error(`Could not load templates: ${error.message}`);
  }
  const summaries = (data ?? []).map(mapTemplateSummary);
  if (summaries.length === 0) {
    return summaries;
  }

  // Second, simple query for each template's line count: fetch every template line's template_id
  // for the workspace and tally client-side. Same idiom as listWorkOrders' missingAssemblyCount
  // bulk query — one flat query instead of a per-template detail fetch (N+1).
  const { data: lineRows, error: linesError } = await supabase
    .from("work_order_template_lines")
    .select("template_id")
    .eq("workspace_id", workspaceId);
  if (linesError) {
    throw new Error(`Could not load template line counts: ${linesError.message}`);
  }

  const countByTemplateId = new Map<string, number>();
  for (const row of lineRows ?? []) {
    const templateId = String(row.template_id);
    countByTemplateId.set(templateId, (countByTemplateId.get(templateId) ?? 0) + 1);
  }

  return summaries.map((summary) => ({
    ...summary,
    lineCount: countByTemplateId.get(summary.id) ?? 0,
  }));
}

export async function getTemplate(workspaceId: string, id: string): Promise<TemplateDetail | null> {
  const supabase = createPlannerSupabaseClient();
  const { data: header, error: headerError } = await supabase
    .from("work_order_templates")
    .select(TEMPLATE_COLUMNS)
    .eq("workspace_id", workspaceId)
    .eq("id", id)
    .maybeSingle();
  if (headerError) {
    throw new Error(`Could not load the template: ${headerError.message}`);
  }
  if (!header) {
    return null;
  }

  const { data: lines, error: linesError } = await supabase
    .from("work_order_template_lines")
    .select(TEMPLATE_LINE_COLUMNS)
    .eq("workspace_id", workspaceId)
    .eq("template_id", id)
    .order("position", { ascending: true });
  if (linesError) {
    throw new Error(`Could not load the template's lines: ${linesError.message}`);
  }

  return mapTemplateDetail(header, lines ?? []);
}

/** Header update + full line replace: delete the template's lines, then insert the new set. */
export async function saveTemplate(workspaceId: string, template: TemplateDetail): Promise<void> {
  const supabase = createPlannerSupabaseClient();
  const defaultTrailerLetter = normalizeOptionalTrailerLetter(template.defaultTrailerLetter);

  const { error: headerError } = await supabase
    .from("work_order_templates")
    .update({
      name: template.name,
      customer: template.customer,
      model: template.model,
      order_type: template.orderType,
      notes_default: template.notesDefault,
      pm_template_id: template.pmTemplateId,
      default_trailer_letter: defaultTrailerLetter,
    })
    .eq("workspace_id", workspaceId)
    .eq("id", template.id);
  if (headerError) {
    throw new Error(`Could not save the template: ${headerError.message}`);
  }

  const { error: deleteError } = await supabase
    .from("work_order_template_lines")
    .delete()
    .eq("workspace_id", workspaceId)
    .eq("template_id", template.id);
  if (deleteError) {
    throw new Error(`Could not replace the template's lines: ${deleteError.message}`);
  }

  if (template.lines.length > 0) {
    const { error: insertError } = await supabase.from("work_order_template_lines").insert(
      template.lines.map((line, index) => ({
        template_id: template.id,
        workspace_id: workspaceId,
        item_no: line.itemNo,
        description: line.description,
        build_qty: line.buildQty,
        position: index,
      })),
    );
    if (insertError) {
      throw new Error(`Could not save the template's lines: ${insertError.message}`);
    }
  }
}

export async function retireTemplate(workspaceId: string, id: string, retired: boolean): Promise<void> {
  const supabase = createPlannerSupabaseClient();
  const { error } = await supabase
    .from("work_order_templates")
    .update({ retired_at: retired ? new Date().toISOString() : null })
    .eq("workspace_id", workspaceId)
    .eq("id", id);
  if (error) {
    throw new Error(`Could not update the template: ${error.message}`);
  }
}

export async function importTemplates(
  workspaceId: string,
  sheets: readonly ParsedTemplateSheet[],
  /** Called after each sheet finishes (imported or failed), so the UI can show live progress. */
  onProgress?: (done: number, total: number, sheetName: string) => void,
): Promise<{ imported: number; failed: Array<{ sheetName: string; message: string }> }> {
  const supabase = createPlannerSupabaseClient();
  const { data: userData } = await supabase.auth.getUser();

  let imported = 0;
  let done = 0;
  const failed: Array<{ sheetName: string; message: string }> = [];

  for (const sheet of sheets) {
    const { data: inserted, error: insertError } = await supabase
      .from("work_order_templates")
      .insert({
        workspace_id: workspaceId,
        name: sheet.templateName,
        customer: sheet.customer,
        model: sheet.model,
        order_type: sheet.orderType,
        notes_default: sheet.notes,
        created_by: userData.user?.id ?? null,
      })
      .select("id")
      .single();
    if (insertError) {
      failed.push({ sheetName: sheet.sheetName, message: insertError.message });
      done += 1;
      onProgress?.(done, sheets.length, sheet.sheetName);
      continue;
    }

    if (sheet.lines.length > 0) {
      const { error: linesError } = await supabase.from("work_order_template_lines").insert(
        sheet.lines.map((line) => ({
          template_id: inserted.id,
          workspace_id: workspaceId,
          item_no: line.itemNo,
          description: line.description,
          build_qty: line.buildQty,
          position: line.position,
        })),
      );
      if (linesError) {
        failed.push({ sheetName: sheet.sheetName, message: linesError.message });
        done += 1;
        onProgress?.(done, sheets.length, sheet.sheetName);
        continue;
      }
    }

    imported += 1;
    done += 1;
    onProgress?.(done, sheets.length, sheet.sheetName);
  }

  return { imported, failed };
}

// ── trailer configs ─────────────────────────────────────────────────────────

export async function listTrailerConfigs(workspaceId: string): Promise<TrailerConfig[]> {
  const supabase = createPlannerSupabaseClient();
  const { data, error } = await supabase
    .from("trailer_configs")
    .select(TRAILER_CONFIG_COLUMNS)
    .eq("workspace_id", workspaceId)
    .order("letter", { ascending: true });
  if (error) {
    throw new Error(`Could not load trailer configurations: ${error.message}`);
  }
  return (data ?? []).map(mapTrailerConfig);
}

/**
 * Upsert a trailer configuration keyed on (workspace_id, letter). The letter is uppercased/trimmed
 * and must be a single A–Z character; anything else is rejected before touching the database.
 */
export async function saveTrailerConfig(workspaceId: string, config: TrailerConfig): Promise<void> {
  const letter = config.letter.trim().toUpperCase();
  if (!/^[A-Z]$/.test(letter)) {
    throw new Error("A trailer configuration letter must be a single letter A–Z.");
  }
  const supabase = createPlannerSupabaseClient();
  const { data: userData } = await supabase.auth.getUser();
  const { error } = await supabase.from("trailer_configs").upsert(
    {
      workspace_id: workspaceId,
      letter,
      name: config.name,
      trailer_template_id: config.trailerTemplateId,
      created_by: userData.user?.id ?? null,
    },
    { onConflict: "workspace_id,letter" },
  );
  if (error) {
    throw new Error(`Could not save the trailer configuration: ${error.message}`);
  }
}

export async function deleteTrailerConfig(workspaceId: string, letter: string): Promise<void> {
  const supabase = createPlannerSupabaseClient();
  const { error } = await supabase
    .from("trailer_configs")
    .delete()
    .eq("workspace_id", workspaceId)
    .eq("letter", letter.trim().toUpperCase());
  if (error) {
    throw new Error(`Could not delete the trailer configuration: ${error.message}`);
  }
}

// ── item master ───────────────────────────────────────────────────────────

const ITEM_MASTER_PAGE_SIZE = 1000;
const ITEM_MASTER_UPSERT_CHUNK_SIZE = 500;

export async function upsertItemMaster(
  workspaceId: string,
  items: readonly ParsedItemMasterRow[],
  /** Called after each saved chunk with the number of rows written so far. */
  onProgress?: (done: number, total: number) => void,
): Promise<{ added: number; updated: number }> {
  const supabase = createPlannerSupabaseClient();

  const existingItemNos = new Set<string>();
  for (let offset = 0; ; offset += ITEM_MASTER_PAGE_SIZE) {
    // An explicit .order() is required for stable pagination: without one, PostgREST row order
    // can shift between pages, so rows get skipped/duplicated and the added/updated counts come
    // out wrong on item masters larger than one page. (Same idiom as the wbs-ordered paging in
    // supabase-planner.ts.)
    const { data, error } = await supabase
      .from("planning_item_master")
      .select("item_no")
      .eq("workspace_id", workspaceId)
      .order("item_no")
      .range(offset, offset + ITEM_MASTER_PAGE_SIZE - 1);
    if (error) {
      throw new Error(`Could not load the existing item master: ${error.message}`);
    }
    for (const row of data ?? []) {
      existingItemNos.add(String(row.item_no));
    }
    if (!data || data.length < ITEM_MASTER_PAGE_SIZE) {
      break;
    }
  }

  const counts = diffItemMaster(existingItemNos, items);

  for (let i = 0; i < items.length; i += ITEM_MASTER_UPSERT_CHUNK_SIZE) {
    const chunk = items.slice(i, i + ITEM_MASTER_UPSERT_CHUNK_SIZE);
    const { error } = await supabase.from("planning_item_master").upsert(
      chunk.map((item) => ({
        workspace_id: workspaceId,
        item_no: item.itemNo,
        description: item.description,
        vendor_no: item.vendorNo,
      })),
      { onConflict: "workspace_id,item_no" },
    );
    if (error) {
      throw new Error(`Could not save the item master: ${error.message}`);
    }
    onProgress?.(Math.min(i + ITEM_MASTER_UPSERT_CHUNK_SIZE, items.length), items.length);
  }

  return counts;
}

export async function searchItems(
  workspaceId: string,
  query: string,
  limit = 12,
): Promise<Array<{ itemNo: string; description: string }>> {
  const supabase = createPlannerSupabaseClient();
  // `%`, `,`, `(` and `)` are structural in PostgREST's `.or()` filter syntax (wildcard, clause
  // separator, and grouping); strip them from the search term rather than let them alter the
  // query or throw a filter-parse error (real item descriptions contain parens, e.g. "WIDGET (RED)").
  // Character class mirrors assertSafeOrFilterValue in src/domain/supabase-planner.ts.
  const escaped = query.replace(/[%,()]/g, "");
  if (escaped === "") {
    return [];
  }

  const { data, error } = await supabase
    .from("planning_item_master")
    .select("item_no, description")
    .eq("workspace_id", workspaceId)
    .or(`item_no.ilike.%${escaped}%,description.ilike.%${escaped}%`)
    .limit(limit);
  if (error) {
    throw new Error(`Could not search items: ${error.message}`);
  }
  return (data ?? []).map((row) => ({ itemNo: String(row.item_no), description: String(row.description ?? "") }));
}

// ── space access ──────────────────────────────────────────────────────────

export async function listSpaceAccess(workspaceId: string): Promise<SpaceAccessRow[]> {
  const supabase = createPlannerSupabaseClient();
  const { data, error } = await supabase
    .from("space_access")
    .select("user_id, space, granted_by, created_at")
    .eq("workspace_id", workspaceId);
  if (error) {
    throw new Error(`Could not load space access: ${error.message}`);
  }
  return (data ?? []).map(mapSpaceAccessRow);
}

export async function grantSpaceAccess(workspaceId: string, userId: string, space: string): Promise<void> {
  const supabase = createPlannerSupabaseClient();
  const { data: userData } = await supabase.auth.getUser();
  const { error } = await supabase.from("space_access").insert({
    workspace_id: workspaceId,
    user_id: userId,
    space,
    granted_by: userData.user?.id ?? null,
  });
  if (error) {
    throw new Error(`Could not grant access: ${error.message}`);
  }
}

export async function revokeSpaceAccess(workspaceId: string, userId: string, space: string): Promise<void> {
  const supabase = createPlannerSupabaseClient();
  const { error } = await supabase
    .from("space_access")
    .delete()
    .eq("workspace_id", workspaceId)
    .eq("user_id", userId)
    .eq("space", space);
  if (error) {
    throw new Error(`Could not revoke access: ${error.message}`);
  }
}

/** Used by non-admin clients to learn their own access -- RLS lets a user read their own row. */
export async function fetchMySpaceAccess(workspaceId: string, space: string): Promise<boolean> {
  const supabase = createPlannerSupabaseClient();
  const { data: userData } = await supabase.auth.getUser();
  const userId = userData.user?.id;
  if (!userId) {
    return false;
  }

  const { data, error } = await supabase
    .from("space_access")
    .select("user_id")
    .eq("workspace_id", workspaceId)
    .eq("user_id", userId)
    .eq("space", space)
    .maybeSingle();
  if (error) {
    throw new Error(`Could not check space access: ${error.message}`);
  }
  return Boolean(data);
}
