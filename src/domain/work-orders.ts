// Work-order domain rules: status flow, monthly order numbering, and
// A-number completeness. Pure logic — no I/O.

export type WorkOrderStatus = "draft" | "released" | "in_production" | "shipped" | "cancelled";
export type WorkOrderFulfillment = "assembly" | "pull_from" | "pull_from_stock";
export type WorkOrderType =
  | "head_unit"
  | "power_module"
  | "accessories"
  | "decal"
  | "trailer"
  | "rework"
  | "mts";

export const WORK_ORDER_STATUS_FLOW = ["draft", "released", "in_production", "shipped"] as const;

export const WORK_ORDER_STATUS_LABELS: Record<WorkOrderStatus, string> = {
  draft: "Draft",
  released: "Released",
  in_production: "In production",
  shipped: "Shipped",
  cancelled: "Cancelled",
};

export const WORK_ORDER_TYPE_LABELS: Record<WorkOrderType, string> = {
  head_unit: "Generator (Main)",
  power_module: "Power module",
  accessories: "Accessories",
  decal: "Decal",
  trailer: "Trailer",
  rework: "Rework",
  mts: "Make-to-stock",
};

export const WORK_ORDER_TYPES = Object.keys(WORK_ORDER_TYPE_LABELS) as WorkOrderType[];

/** Order-number prefix per type. GEN and PM share one per-month sequence pool (see `suggestOrderNo`). */
export const ORDER_TYPE_PREFIXES: Record<WorkOrderType, string> = {
  head_unit: "GEN",
  power_module: "PM",
  trailer: "TRL",
  accessories: "ACC",
  decal: "DEC",
  rework: "RWK",
  mts: "MTS",
};

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

/** "2026-07-15" → "0726". Malformed dates bucket to "0000" rather than throwing. */
export function orderNoMonthKey(orderDate: string): string {
  const match = /^(\d{4})-(\d{2})/.exec(orderDate.trim());
  if (!match) {
    return "0000";
  }
  return `${match[2]}${match[1].slice(2)}`;
}

/**
 * Next number in the month's series: `{PREFIX}-MMYY-NN`, restarting at 01 each month.
 *
 * Pass only APPROVED order numbers. Under decision N1 a draft has no `order_no` at all, so
 * counting drafts here would burn numbers on orders that may never be approved and leave
 * permanent holes in the sequence production builds against. Drafts carry `suggestDraftNo`.
 * GEN (head_unit) and PM (power_module) share a single per-month sequence pool — a set's
 * Main and Power Module carry the same NN — so numbering either one scans BOTH GEN- and PM-
 * numbers for the month, ensuring a set's NN is never reused by either side. Other types
 * scan only their own prefix.
 */
export function suggestOrderNo(
  existingOrderNos: readonly string[],
  orderDate: string,
  orderType: WorkOrderType,
): string {
  const mmyy = orderNoMonthKey(orderDate);
  const prefix = ORDER_TYPE_PREFIXES[orderType];
  const sharesGenPmPool = orderType === "head_unit" || orderType === "power_module";
  const scanPrefixes = sharesGenPmPool
    ? [`${ORDER_TYPE_PREFIXES.head_unit}-${mmyy}-`, `${ORDER_TYPE_PREFIXES.power_module}-${mmyy}-`]
    : [`${prefix}-${mmyy}-`];

  let max = 0;
  for (const orderNo of existingOrderNos) {
    const normalized = orderNo.trim().toUpperCase();
    const matched = scanPrefixes.find((candidate) => normalized.startsWith(candidate));
    if (!matched) {
      continue;
    }
    const sequence = Number.parseInt(normalized.slice(matched.length), 10);
    if (Number.isFinite(sequence) && sequence > max) {
      max = sequence;
    }
  }
  return `${prefix}-${mmyy}-${String(max + 1).padStart(2, "0")}`;
}

/**
 * Provisional draft prefix. Deliberately distinct from every `ORDER_TYPE_PREFIXES` value so a
 * draft id can never be mistaken for an official work-order number on paper or in a spreadsheet.
 * The trailing hyphen matters when scanning: `DEC-` (decal) also begins with D.
 */
export const DRAFT_PREFIX = "D";

/**
 * Next provisional draft number: `D-MMYY-NN`, restarting at 01 each month.
 *
 * Gaps in THIS series are expected and harmless — that is the entire point of minting the
 * OFFICIAL number at approval instead (design decision N1). Discarding a draft costs nothing,
 * which is what keeps the `GEN-` sequence production builds against contiguous.
 *
 * Pass only draft numbers; official numbers are ignored anyway, but the two series are separate
 * pools and mixing them would be a category error at the call site.
 */
export function suggestDraftNo(existingDraftNos: readonly string[], orderDate: string): string {
  const mmyy = orderNoMonthKey(orderDate);
  const scan = `${DRAFT_PREFIX}-${mmyy}-`;
  let max = 0;
  for (const draftNo of existingDraftNos) {
    const normalized = (draftNo ?? "").trim().toUpperCase();
    if (!normalized.startsWith(scan)) {
      continue;
    }
    const sequence = Number.parseInt(normalized.slice(scan.length), 10);
    if (Number.isFinite(sequence) && sequence > max) {
      max = sequence;
    }
  }
  return `${scan}${String(max + 1).padStart(2, "0")}`;
}

/** Trailer supermarket order number: `TRL-MMYY-{LETTER}` (one per config letter per month). */
export function trailerOrderNo(orderDate: string, letter: string): string {
  return `${ORDER_TYPE_PREFIXES.trailer}-${orderNoMonthKey(orderDate)}-${letter.trim().toUpperCase()}`;
}

/** The short set/match number — the trailing segment of an order no. `GEN-0726-01` → `01`; junk → "". */
export function setNoFromOrderNo(orderNo: string): string {
  const match = /^[A-Za-z]+-\d{4}-(.+)$/.exec(orderNo.trim());
  return match ? match[1] : "";
}

const STATUS_TIMESTAMP_COLUMNS = ["released_at", "production_started_at", "shipped_at"] as const;

/**
 * DB patch for a status transition. Reaching a flow status stamps it and clears
 * every LATER stamp (so stepping back erases the future); earlier stamps are
 * omitted entirely so the DB keeps that prior history. Cancelling stamps
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
    if (index + 1 === reachedIndex) {
      patch[column] = nowIso;
    } else if (index + 1 > reachedIndex) {
      patch[column] = null;
    }
    // index + 1 < reachedIndex: earlier stamp, omit so the DB keeps its prior value.
  });
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
