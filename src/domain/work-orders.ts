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
