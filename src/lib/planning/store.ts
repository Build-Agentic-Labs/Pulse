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
  orderNoMonthKey,
  suggestOrderNo,
  WORK_ORDER_NO_PREFIX,
  type WorkOrderFulfillment,
  type WorkOrderStatus,
  type WorkOrderType,
} from "@/domain/work-orders";
import { createPlannerSupabaseClient } from "@/domain/supabase-planner";
import { diffItemMaster, type ParsedItemMasterRow } from "./parse-item-master";
import type { ParsedTemplateSheet } from "./parse-workbook";

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

export interface CreateWorkOrderInput {
  templateId: string | null;
  customer: string;
  model: string;
  orderType: WorkOrderType;
  orderDate: string;
  notes: string;
  lines: Array<Omit<WorkOrderLine, "id">>;
}

// ── column projections ───────────────────────────────────────────────────

const WORK_ORDER_LIST_COLUMNS = "id, order_no, customer, model, order_type, status, order_date, updated_at";
const WORK_ORDER_COLUMNS =
  "id, order_no, template_id, customer, model, order_type, status, order_date, notes, released_at, production_started_at, shipped_at, cancelled_at, created_at, updated_at";
const WORK_ORDER_LINE_COLUMNS =
  "id, item_no, description, build_qty, shipped_qty, fulfillment, assembly_order_no, pull_from_ref, position";

const TEMPLATE_LIST_COLUMNS = "id, name, customer, model, order_type, retired_at, updated_at";
const TEMPLATE_COLUMNS = "id, name, customer, model, order_type, notes_default, retired_at, created_at, updated_at";
const TEMPLATE_LINE_COLUMNS = "id, item_no, description, build_qty, position";

// ── mappers (snake_case rows -> camelCase types) ─────────────────────────

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
    releasedAt: header.released_at ? String(header.released_at) : null,
    productionStartedAt: header.production_started_at ? String(header.production_started_at) : null,
    shippedAt: header.shipped_at ? String(header.shipped_at) : null,
    cancelledAt: header.cancelled_at ? String(header.cancelled_at) : null,
    createdAt: String(header.created_at ?? ""),
    updatedAt: String(header.updated_at ?? ""),
    lines: lines.map(mapWorkOrderLine),
  };
}

function mapTemplateSummary(row: Record<string, unknown>): TemplateSummary {
  return {
    id: String(row.id),
    name: String(row.name ?? ""),
    customer: String(row.customer ?? ""),
    model: String(row.model ?? ""),
    orderType: (row.order_type as WorkOrderType) ?? "mts",
    retiredAt: row.retired_at ? String(row.retired_at) : null,
    updatedAt: String(row.updated_at ?? ""),
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
  return (data ?? []).map(mapWorkOrderSummary);
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
  return (data ?? []).map(mapTemplateSummary);
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

  const { error: headerError } = await supabase
    .from("work_order_templates")
    .update({
      name: template.name,
      customer: template.customer,
      model: template.model,
      order_type: template.orderType,
      notes_default: template.notesDefault,
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
): Promise<{ imported: number; failed: Array<{ sheetName: string; message: string }> }> {
  const supabase = createPlannerSupabaseClient();
  const { data: userData } = await supabase.auth.getUser();

  let imported = 0;
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
        continue;
      }
    }

    imported += 1;
  }

  return { imported, failed };
}

// ── item master ───────────────────────────────────────────────────────────

const ITEM_MASTER_PAGE_SIZE = 1000;
const ITEM_MASTER_UPSERT_CHUNK_SIZE = 500;

export async function upsertItemMaster(
  workspaceId: string,
  items: readonly ParsedItemMasterRow[],
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
