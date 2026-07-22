/**
 * Schedule imports and sales orders: the intake half of the Planning space.
 *
 * A monthly production schedule is uploaded, each row is resolved against the SKU catalog in the
 * DOMAIN layer, and the already-resolved rows arrive here to be persisted. Resolution never
 * happens in this file — the store writes what it is given.
 *
 * Mirrors the idioms in `./store.ts`: explicit column projections, every query scoped by
 * `workspace_id`, timestamps owned by the DB, snake_case mapped to camelCase at the boundary,
 * Supabase errors re-thrown as human-readable `Error`s, optional injected client.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { ResolutionFlag } from "@/domain/planning/schedule-resolve";
import { createPlannerSupabaseClient, getUserFromSession } from "@/domain/supabase-planner";
import type { Database } from "@/lib/database.types";

type PlanningClient = SupabaseClient<Database>;

// ── types ─────────────────────────────────────────────────────────────────

export type SalesOrderLineStatus = "pending" | "flagged" | "converted" | "skipped";

export interface SalesOrderSummary {
  id: string;
  soNo: string;
  customer: string;
  lineCount: number;
  convertedCount: number;
}

export interface ScheduleImportSummary {
  id: string;
  fileName: string;
  sheetName: string;
  firstRowNo: number;
  lastRowNo: number;
  rowCount: number;
  importedAt: string;
}

export interface SalesOrderLineRow {
  id: string;
  salesOrderId: string | null;
  soNo: string;
  sourceRowNo: number;
  fgSku: string;
  accSku: string;
  trailerLetter: string;
  modelRaw: string;
  customerRaw: string;
  assemblyOrderNo: string;
  status: SalesOrderLineStatus;
  flags: ResolutionFlag[];
  workOrderId: string | null;
  /** The approved GEN number of the work order this line produced, if any. Feeds the export column. */
  orderNo: string | null;
}

/** One already-resolved schedule row, ready to persist. */
export interface ResolvedScheduleRow {
  sourceRowNo: number;
  /** Cleaned sales order number; "" when the sheet had none yet. */
  so: string;
  customer: string;
  fgSku: string;
  accSku: string;
  trailerLetter: string;
  model: string;
  assemblyOrderNo: string;
  status: "resolved" | "flagged";
  flags: readonly ResolutionFlag[];
}

export interface ImportScheduleInput {
  fileName: string;
  sheetName: string;
  /** 1-based spreadsheet row range this import covers — what the export column walks. */
  firstRowNo: number;
  lastRowNo: number;
  /** Rows READ from the sheet, including divider rows that produce no line. */
  rowCount: number;
  /** Importable rows only. Divider rows are filtered by the caller and never stored. */
  rows: readonly ResolvedScheduleRow[];
}

export interface ImportScheduleResult {
  importId: string;
  linesCreated: number;
  salesOrdersCreated: number;
}

// ── column projections ────────────────────────────────────────────────────

const IMPORT_COLUMNS = "id, file_name, sheet_name, first_row_no, last_row_no, row_count, imported_at";
const LINE_COLUMNS =
  "id, sales_order_id, source_row_no, fg_sku, acc_sku, trailer_letter, model_raw, customer_raw, assembly_order_no, status, flags, work_order_id";

/** Insert chunk size — mirrors the item-master importer's batching for large sheets. */
const LINE_INSERT_CHUNK = 200;

/** Normalize a sales order number the same way the DB's unique index does. */
function soKey(soNo: string): string {
  return soNo.trim().toUpperCase();
}

function mapLine(row: Record<string, unknown>, soNo: string, orderNo: string | null): SalesOrderLineRow {
  return {
    id: String(row.id),
    salesOrderId: row.sales_order_id ? String(row.sales_order_id) : null,
    soNo,
    sourceRowNo: Number(row.source_row_no ?? 0),
    fgSku: String(row.fg_sku ?? ""),
    accSku: String(row.acc_sku ?? ""),
    trailerLetter: String(row.trailer_letter ?? ""),
    modelRaw: String(row.model_raw ?? ""),
    customerRaw: String(row.customer_raw ?? ""),
    assemblyOrderNo: String(row.assembly_order_no ?? ""),
    status: (row.status as SalesOrderLineStatus) ?? "pending",
    flags: Array.isArray(row.flags) ? (row.flags as ResolutionFlag[]) : [],
    workOrderId: row.work_order_id ? String(row.work_order_id) : null,
    orderNo,
  };
}

// ── reads ─────────────────────────────────────────────────────────────────

/** Sales orders with their line counts, newest first. */
export async function listSalesOrders(workspaceId: string, client?: PlanningClient): Promise<SalesOrderSummary[]> {
  const supabase = client ?? createPlannerSupabaseClient();

  const { data, error } = await supabase
    .from("sales_orders")
    .select("id, so_no, customer, sales_order_lines(status)")
    .eq("workspace_id", workspaceId)
    .order("so_no", { ascending: false });
  if (error) {
    throw new Error(`Could not load sales orders: ${error.message}`);
  }

  return (data ?? []).map((row) => {
    const lines = (row as { sales_order_lines?: Array<{ status: string }> }).sales_order_lines ?? [];
    return {
      id: String(row.id),
      soNo: String(row.so_no ?? ""),
      customer: String(row.customer ?? ""),
      lineCount: lines.length,
      convertedCount: lines.filter((line) => line.status === "converted").length,
    };
  });
}

/** Uploaded schedules, newest first. */
export async function listImports(workspaceId: string, client?: PlanningClient): Promise<ScheduleImportSummary[]> {
  const supabase = client ?? createPlannerSupabaseClient();

  const { data, error } = await supabase
    .from("schedule_imports")
    .select(IMPORT_COLUMNS)
    .eq("workspace_id", workspaceId)
    .order("imported_at", { ascending: false });
  if (error) {
    throw new Error(`Could not load schedule imports: ${error.message}`);
  }

  return (data ?? []).map((row) => ({
    id: String(row.id),
    fileName: String(row.file_name ?? ""),
    sheetName: String(row.sheet_name ?? ""),
    firstRowNo: Number(row.first_row_no ?? 0),
    lastRowNo: Number(row.last_row_no ?? 0),
    rowCount: Number(row.row_count ?? 0),
    importedAt: String(row.imported_at ?? ""),
  }));
}

/**
 * Every stored line of one import, in spreadsheet-row order, joined to its work order's official
 * number. This is what `buildExportColumn` consumes — note it returns only the rows that EXIST,
 * so skipped divider rows are simply absent and the export's range walk leaves their cells blank.
 */
export async function getImportLines(
  workspaceId: string,
  importId: string,
  client?: PlanningClient,
): Promise<SalesOrderLineRow[]> {
  const supabase = client ?? createPlannerSupabaseClient();

  // The work_orders embed MUST name its foreign key. Two FKs join these tables — this one, and
  // work_orders.sales_order_line_id pointing back — so an unqualified `work_orders(...)` embed is
  // ambiguous and PostgREST rejects the whole query. Storing the link in both directions is
  // deliberate (one is live and joinable, the other is the traveler's frozen snapshot), so the
  // disambiguation is the price of that and must not be "simplified" away.
  const { data, error } = await supabase
    .from("sales_order_lines")
    .select(`${LINE_COLUMNS}, sales_orders(so_no), work_orders!sales_order_lines_work_order_id_fkey(order_no)`)
    .eq("workspace_id", workspaceId)
    .eq("import_id", importId)
    .order("source_row_no", { ascending: true });
  if (error) {
    throw new Error(`Could not load the import's lines: ${error.message}`);
  }

  return (data ?? []).map((row) => {
    const record = row as Record<string, unknown>;
    const salesOrder = record.sales_orders as { so_no?: string } | null;
    const workOrder = record.work_orders as { order_no?: string | null } | null;
    return mapLine(record, String(salesOrder?.so_no ?? ""), workOrder?.order_no ? String(workOrder.order_no) : null);
  });
}

/** Lines on one sales order that have no work order yet — what the create flow picks from. */
export async function listUnconvertedLines(
  workspaceId: string,
  salesOrderId: string,
  client?: PlanningClient,
): Promise<SalesOrderLineRow[]> {
  const supabase = client ?? createPlannerSupabaseClient();

  const { data, error } = await supabase
    .from("sales_order_lines")
    .select(`${LINE_COLUMNS}, sales_orders(so_no)`)
    .eq("workspace_id", workspaceId)
    .eq("sales_order_id", salesOrderId)
    .neq("status", "converted")
    .order("source_row_no", { ascending: true });
  if (error) {
    throw new Error(`Could not load the sales order's lines: ${error.message}`);
  }

  return (data ?? []).map((row) => {
    const record = row as Record<string, unknown>;
    const salesOrder = record.sales_orders as { so_no?: string } | null;
    return mapLine(record, String(salesOrder?.so_no ?? ""), null);
  });
}

// ── writes ────────────────────────────────────────────────────────────────

/**
 * Persist one uploaded schedule: the import header, any sales orders it introduces, and one line
 * per IMPORTABLE row.
 *
 * Divider rows are filtered by the caller and never reach here — their `source_row_no` therefore
 * has no record at all, which is exactly why the export column walks the row RANGE rather than
 * listing what was created.
 *
 * Sales orders are resolved by select-then-insert rather than upsert: the uniqueness is a partial
 * expression index (`lower(btrim(so_no))`), which PostgREST's `on_conflict` cannot target.
 */
export async function importSchedule(
  workspaceId: string,
  input: ImportScheduleInput,
): Promise<ImportScheduleResult> {
  const supabase = createPlannerSupabaseClient();
  const { data: userData } = await getUserFromSession(supabase);
  const importedBy = userData.user?.id ?? null;

  const { data: importRow, error: importError } = await supabase
    .from("schedule_imports")
    .insert({
      workspace_id: workspaceId,
      file_name: input.fileName,
      sheet_name: input.sheetName,
      first_row_no: input.firstRowNo,
      last_row_no: input.lastRowNo,
      row_count: input.rowCount,
      imported_by: importedBy,
    })
    .select("id")
    .single();
  if (importError) {
    throw new Error(`Could not record the schedule import: ${importError.message}`);
  }
  const importId = String(importRow.id);

  const salesOrderIdByKey = await resolveSalesOrders(supabase, workspaceId, input.rows);

  const payload = input.rows.map((row) => ({
    workspace_id: workspaceId,
    import_id: importId,
    sales_order_id: row.so ? (salesOrderIdByKey.get(soKey(row.so)) ?? null) : null,
    source_row_no: row.sourceRowNo,
    fg_sku: row.fgSku,
    acc_sku: row.accSku,
    trailer_letter: row.trailerLetter,
    model_raw: row.model,
    customer_raw: row.customer,
    assembly_order_no: row.assemblyOrderNo,
    status: row.status === "flagged" ? "flagged" : "pending",
    flags: row.flags as unknown as Database["public"]["Tables"]["sales_order_lines"]["Insert"]["flags"],
  }));

  // A partially written import is worse than none: the header carries the full row RANGE, so the
  // export column would walk it and emit blanks for the rows that never landed — indistinguishable
  // from "not approved yet". On any failure, remove the header (lines cascade) so the planner sees
  // a failed import to retry rather than a plausible-looking wrong one.
  try {
    for (let index = 0; index < payload.length; index += LINE_INSERT_CHUNK) {
      const chunk = payload.slice(index, index + LINE_INSERT_CHUNK);
      const { error } = await supabase.from("sales_order_lines").insert(chunk);
      if (error) {
        throw new Error(`Could not import the schedule's lines: ${error.message}`);
      }
    }
  } catch (cause) {
    const { error: rollbackError } = await supabase
      .from("schedule_imports")
      .delete()
      .eq("workspace_id", workspaceId)
      .eq("id", importId)
      .select("id");
    const detail = cause instanceof Error ? cause.message : "the schedule could not be imported";
    if (rollbackError) {
      throw new Error(
        `${detail}. The partial import could not be cleaned up either (${rollbackError.message}) — delete "${input.fileName}" from the import list before retrying.`,
      );
    }
    throw new Error(detail);
  }

  return {
    importId,
    linesCreated: payload.length,
    salesOrdersCreated: salesOrderIdByKey.size,
  };
}

/**
 * Map every sales order number in the batch to a row id, creating the ones that do not exist.
 * Keyed by the same normalization the DB's unique index uses, so "s-ord1234" and "S-ORD1234"
 * resolve to one sales order rather than colliding on insert.
 */
async function resolveSalesOrders(
  supabase: PlanningClient,
  workspaceId: string,
  rows: readonly ResolvedScheduleRow[],
): Promise<Map<string, string>> {
  const wanted = new Map<string, { soNo: string; customer: string }>();
  for (const row of rows) {
    const key = soKey(row.so);
    if (!key || wanted.has(key)) continue;
    wanted.set(key, { soNo: row.so.trim(), customer: row.customer });
  }
  if (wanted.size === 0) {
    return new Map();
  }

  const { data: existing, error: existingError } = await supabase
    .from("sales_orders")
    .select("id, so_no")
    .eq("workspace_id", workspaceId);
  if (existingError) {
    throw new Error(`Could not load existing sales orders: ${existingError.message}`);
  }

  const byKey = new Map<string, string>();
  for (const row of existing ?? []) {
    byKey.set(soKey(String(row.so_no ?? "")), String(row.id));
  }

  const missing = [...wanted.entries()].filter(([key]) => !byKey.has(key));
  if (missing.length > 0) {
    const { data: inserted, error: insertError } = await supabase
      .from("sales_orders")
      .insert(
        missing.map(([, value]) => ({
          workspace_id: workspaceId,
          so_no: value.soNo,
          customer: value.customer,
        })),
      )
      .select("id, so_no");
    if (insertError) {
      throw new Error(`Could not create sales orders: ${insertError.message}`);
    }
    for (const row of inserted ?? []) {
      byKey.set(soKey(String(row.so_no ?? "")), String(row.id));
    }
  }

  // Return only the keys this batch actually referenced.
  const result = new Map<string, string>();
  for (const key of wanted.keys()) {
    const id = byKey.get(key);
    if (id) result.set(key, id);
  }
  return result;
}

/**
 * Mark a line converted once its work order exists. The DB rejects `converted` with no order.
 *
 * Guarded on the line having NO work order yet, so two planners (or two tabs) converting the same
 * unit cannot both succeed and silently leave two work orders built for one physical unit. A
 * no-op result is reported as a conflict rather than swallowed.
 */
export async function markLineConverted(
  workspaceId: string,
  lineId: string,
  workOrderId: string,
): Promise<void> {
  const supabase = createPlannerSupabaseClient();
  const { data, error } = await supabase
    .from("sales_order_lines")
    .update({ status: "converted", work_order_id: workOrderId })
    .eq("workspace_id", workspaceId)
    .eq("id", lineId)
    .is("work_order_id", null)
    .select("id");
  if (error) {
    throw new Error(`Could not link the line to its work order: ${error.message}`);
  }
  if (!data || data.length === 0) {
    throw new Error(
      "This unit already has a work order — someone else converted it. Reload the sales order before creating another.",
    );
  }
}

/**
 * Units already built from a previous import, keyed `SO#|FG SKU` (both normalized).
 *
 * The preview uses this to warn before a corrected re-upload quietly double-builds a month: the
 * new import creates fresh `pending` lines for units that already have work orders, and nothing
 * else in the pipeline would notice.
 */
export async function listConvertedUnitKeys(
  workspaceId: string,
  client?: PlanningClient,
): Promise<ReadonlySet<string>> {
  const supabase = client ?? createPlannerSupabaseClient();
  const { data, error } = await supabase
    .from("sales_order_lines")
    .select("fg_sku, sales_orders(so_no)")
    .eq("workspace_id", workspaceId)
    .eq("status", "converted");
  if (error) {
    throw new Error(`Could not check for already-built units: ${error.message}`);
  }
  const keys = new Set<string>();
  for (const row of data ?? []) {
    const salesOrder = (row as { sales_orders?: { so_no?: string } | null }).sales_orders;
    keys.add(unitKey(String(salesOrder?.so_no ?? ""), String(row.fg_sku ?? "")));
  }
  return keys;
}

/** The identity of a physical unit across imports: its sales order plus its finished-goods SKU. */
export function unitKey(soNo: string, fgSku: string): string {
  return `${soNo.trim().toUpperCase()}|${fgSku.trim().toUpperCase()}`;
}
