"use client";

import { Settings } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { WorkOrderTableSkeleton } from "@/components/space-loading-states";
import { ThemedSelect, type ThemedSelectOption } from "@/components/themed-select";
import { WORK_ORDER_STATUS_LABELS, WORK_ORDER_TYPE_LABELS } from "@/domain/work-orders";
import { listWorkOrders, purgeLegacyWorkOrderTemplates, type WorkOrderSummary } from "@/lib/planning/store";
import { PlanningShell } from "./planning-shell";
import { usePlanningWorkspace } from "./planning-workspace-provider";

/** One-time client flag so we only attempt the MTS-template purge once per browser session. */
const PURGE_SESSION_KEY = "pulse:planning:purged-legacy-templates";

const ALL_FILTER = "all";

function formatOrderDate(iso: string): string {
  if (!iso) return "";
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? "" : date.toLocaleDateString();
}

/** "2026-07-15" -> "2026-07"; used both to bucket orders by month and as the filter's value. */
function monthKey(orderDate: string): string {
  return orderDate.slice(0, 7);
}

function monthLabel(key: string): string {
  const match = /^(\d{4})-(\d{2})$/.exec(key);
  if (!match) return key;
  const date = new Date(Number(match[1]), Number(match[2]) - 1, 1);
  return Number.isNaN(date.getTime()) ? key : date.toLocaleDateString(undefined, { month: "long", year: "numeric" });
}

/**
 * The board's "Set" cell, read per order type: a generator shows its set number and paired trailer
 * letter; a power module shows its set number plus a link back to its Main; a trailer shows its
 * configuration letter; everything else shows a dash.
 */
function SetCell({ order, onOpenMain }: { order: WorkOrderSummary; onOpenMain: (id: string) => void }) {
  if (order.orderType === "head_unit") {
    return (
      <span className="font-mono text-xs text-ink-secondary">
        {order.setNo ? `SET ${order.setNo}` : "—"}
        {order.trailerLetter ? ` · ${order.trailerLetter}` : ""}
      </span>
    );
  }
  if (order.orderType === "power_module") {
    return (
      <span className="flex items-center gap-2">
        <span className="font-mono text-xs text-ink-secondary">{order.setNo ? `SET ${order.setNo}` : "—"}</span>
        {order.mainOrderId ? (
          <button
            type="button"
            className="ui-mono-label text-ink-tertiary underline-offset-2 hover:text-ink hover:underline"
            onClick={(event) => {
              event.stopPropagation();
              onOpenMain(order.mainOrderId as string);
            }}
          >
            → Main
          </button>
        ) : null}
      </span>
    );
  }
  if (order.orderType === "trailer") {
    return <span className="ui-chip">{order.trailerLetter || "—"}</span>;
  }
  return <span className="text-ink-tertiary">—</span>;
}

/**
 * The Planning space's work-order board: filterable/searchable list of every work order in the
 * workspace, with checkbox selection for batch print. Owns its own `PlanningShell` (see
 * project-route-shells.tsx's `PlanningRouteShell`, which renders provider > gate > this component
 * with no extra shell wrapper).
 */
export function WorkOrderBoard() {
  const router = useRouter();
  const { workspaceId, canWrite } = usePlanningWorkspace();

  const [orders, setOrders] = useState<WorkOrderSummary[]>([]);
  const [listStatus, setListStatus] = useState<"loading" | "ready" | "error">("loading");
  const [error, setError] = useState("");
  const [purgeNotice, setPurgeNotice] = useState("");

  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState(ALL_FILTER);
  const [customerFilter, setCustomerFilter] = useState(ALL_FILTER);
  const [monthFilter, setMonthFilter] = useState(ALL_FILTER);
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());

  // Stale-response guard (same intent as sop-list.tsx's `active` flag / the provider's
  // `cancelled` flag): each load takes a ticket from this counter, and only the latest ticket
  // may commit state. Covers both the workspace-change effect and the manual Retry path, which
  // share `refresh`.
  const loadSeqRef = useRef(0);

  const refresh = useCallback(async () => {
    const seq = ++loadSeqRef.current;
    if (!workspaceId) {
      setOrders([]);
      setListStatus("ready");
      return;
    }
    setListStatus("loading");
    setError("");
    try {
      const next = await listWorkOrders(workspaceId);
      if (seq !== loadSeqRef.current) return;
      setOrders(next);
      setListStatus("ready");
    } catch (caught) {
      if (seq !== loadSeqRef.current) return;
      setError(caught instanceof Error ? caught.message : "Could not load work orders.");
      setListStatus("error");
    }
  }, [workspaceId]);

  useEffect(() => {
    void refresh();
    return () => {
      // Invalidate any in-flight load when the workspace changes or the board unmounts.
      loadSeqRef.current += 1;
    };
  }, [refresh]);

  // One-time purge of MTS Excel "work order templates" (layout clones, not product truth).
  // Editors only; failures are non-fatal so a permission miss doesn't block the board.
  useEffect(() => {
    if (!workspaceId || !canWrite) return;
    let sessionDone = false;
    try {
      sessionDone = window.sessionStorage.getItem(PURGE_SESSION_KEY) === workspaceId;
    } catch {
      // private browsing — still attempt once per mount via sessionDone=false
    }
    if (sessionDone) return;

    let cancelled = false;
    void purgeLegacyWorkOrderTemplates(workspaceId)
      .then(({ deleted }) => {
        if (cancelled) return;
        try {
          window.sessionStorage.setItem(PURGE_SESSION_KEY, workspaceId);
        } catch {
          // ignore
        }
        if (deleted > 0) {
          setPurgeNotice(
            `Removed ${deleted} legacy work-order template${deleted === 1 ? "" : "s"} from the MTS Excel import. Existing orders were not changed.`,
          );
        }
      })
      .catch(() => {
        // Non-fatal: board still works if purge is denied by RLS or offline.
      });

    return () => {
      cancelled = true;
    };
  }, [workspaceId, canWrite]);

  const statusOptions = useMemo<ThemedSelectOption[]>(() => {
    const statuses = Array.from(new Set(orders.map((order) => order.status)));
    return [
      { value: ALL_FILTER, label: "All statuses" },
      ...statuses.map((status) => ({ value: status, label: WORK_ORDER_STATUS_LABELS[status] })),
    ];
  }, [orders]);

  const customerOptions = useMemo<ThemedSelectOption[]>(() => {
    const customers = Array.from(new Set(orders.map((order) => order.customer).filter(Boolean))).sort((a, b) =>
      a.localeCompare(b),
    );
    return [{ value: ALL_FILTER, label: "All customers" }, ...customers.map((customer) => ({ value: customer, label: customer }))];
  }, [orders]);

  const monthOptions = useMemo<ThemedSelectOption[]>(() => {
    const months = Array.from(new Set(orders.map((order) => monthKey(order.orderDate)).filter(Boolean))).sort((a, b) =>
      b.localeCompare(a),
    );
    return [{ value: ALL_FILTER, label: "All months" }, ...months.map((key) => ({ value: key, label: monthLabel(key) }))];
  }, [orders]);

  const filteredOrders = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return orders.filter((order) => {
      if (statusFilter !== ALL_FILTER && order.status !== statusFilter) return false;
      if (customerFilter !== ALL_FILTER && order.customer !== customerFilter) return false;
      if (monthFilter !== ALL_FILTER && monthKey(order.orderDate) !== monthFilter) return false;
      if (needle) {
        // Search the provisional draft id and the sales order too — a draft has no official
        // number, so matching only on orderNo would make every draft unfindable.
        const haystack = [order.orderNo, order.draftNo, order.salesOrderNo, order.customer]
          .join(" ")
          .toLowerCase();
        if (!haystack.includes(needle)) return false;
      }
      return true;
    });
  }, [orders, statusFilter, customerFilter, monthFilter, query]);

  function toggleSelected(id: string) {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }

  function handlePrintSelected() {
    if (selected.size === 0) return;
    router.push(`/planning/print?ids=${Array.from(selected).join(",")}`);
  }

  function handleNewWorkOrder() {
    router.push("/planning/work-orders/new");
  }

  return (
    <PlanningShell
      title="Work orders"
      actions={
        canWrite ? (
          <Link
            href="/settings?section=planning"
            className="ui-btn-ghost inline-flex h-8 w-8 items-center justify-center px-0"
            aria-label="Planning settings"
            title="Planning settings"
          >
            <Settings size={14} />
          </Link>
        ) : null
      }
    >
      <div className="space-y-5">
        {purgeNotice ? (
          <div className="ui-notice px-4 py-3 ui-section-subtitle flex flex-wrap items-start justify-between gap-3">
            <p className="min-w-0 flex-1 text-ink-secondary">{purgeNotice}</p>
            <button type="button" className="ui-btn-ghost h-8 shrink-0 px-3" onClick={() => setPurgeNotice("")}>
              Dismiss
            </button>
          </div>
        ) : null}
        <div className="ui-wo-toolbar flex flex-wrap items-center gap-2">
          <span className="ui-mono-label whitespace-nowrap text-ink-secondary">
            {orders.length} work order{orders.length === 1 ? "" : "s"}
          </span>
          <ThemedSelect
            value={statusFilter}
            onChange={setStatusFilter}
            options={statusOptions}
            ariaLabel="Filter by status"
            disabled={listStatus !== "ready" || orders.length === 0}
          />
          <ThemedSelect
            value={customerFilter}
            onChange={setCustomerFilter}
            options={customerOptions}
            ariaLabel="Filter by customer"
            disabled={listStatus !== "ready" || orders.length === 0}
          />
          <ThemedSelect
            value={monthFilter}
            onChange={setMonthFilter}
            options={monthOptions}
            ariaLabel="Filter by month"
            disabled={listStatus !== "ready" || orders.length === 0}
          />
          <input
            type="search"
            className="ui-input w-[140px] max-w-[220px] grow"
            placeholder="Search orders"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            disabled={listStatus !== "ready" || orders.length === 0}
          />
          <span className="flex-1" />
          <button
            type="button"
            className="ui-btn-ghost h-8 px-3 disabled:cursor-not-allowed disabled:opacity-40"
            disabled={selected.size === 0}
            onClick={handlePrintSelected}
          >
            Print selected ({selected.size})
          </button>
          {canWrite ? (
            <button type="button" className="ui-btn-primary h-8 px-3" onClick={handleNewWorkOrder}>
              New work order
            </button>
          ) : null}
        </div>

        <section className="ui-data-table-frame">
          {listStatus === "loading" ? (
            <WorkOrderTableSkeleton />
          ) : listStatus === "error" ? (
            <div className="px-4 py-10 text-center">
              <p className="ui-section-subtitle text-ink-tertiary">{error || "Could not load work orders."}</p>
              <button type="button" className="ui-btn-ghost mt-3 inline-flex h-9 px-3" onClick={() => void refresh()}>
                Retry
              </button>
            </div>
          ) : orders.length === 0 ? (
            <div className="px-4 py-10 text-center">
              <p className="ui-section-subtitle text-ink-tertiary">No work orders yet.</p>
              <p className="ui-section-subtitle mx-auto mt-1 max-w-md text-ink-tertiary">
                Create a blank order and add items from the item master. Excel MTS sheet copies are not used as
                templates.
              </p>
              {canWrite ? (
                <button
                  type="button"
                  className="ui-btn-primary mt-3 inline-flex h-9 px-4"
                  onClick={handleNewWorkOrder}
                >
                  New work order
                </button>
              ) : null}
            </div>
          ) : filteredOrders.length === 0 ? (
            <div className="px-4 py-10 text-center">
              <p className="ui-section-subtitle text-ink-tertiary">No work orders match these filters.</p>
            </div>
          ) : (
            <div className="ui-table-scroll">
              <table className="w-full min-w-[1000px] border-collapse text-sm">
                <thead>
                  <tr>
                    <th className="w-10 border-b border-line px-4 py-2.5" aria-hidden="true" />
                    <th className="ui-mono-label whitespace-nowrap border-b border-line px-3 py-2.5 text-left">Order</th>
                    <th className="ui-mono-label whitespace-nowrap border-b border-line px-3 py-2.5 text-left">Customer</th>
                    <th className="ui-mono-label whitespace-nowrap border-b border-line px-3 py-2.5 text-left">Model</th>
                    <th className="ui-mono-label whitespace-nowrap border-b border-line px-3 py-2.5 text-left">Type</th>
                    <th className="ui-mono-label whitespace-nowrap border-b border-line px-3 py-2.5 text-left">Status</th>
                    <th className="ui-mono-label whitespace-nowrap border-b border-line px-3 py-2.5 text-left">Set</th>
                    <th className="ui-mono-label whitespace-nowrap border-b border-line px-3 py-2.5 text-left">Order date</th>
                    <th className="ui-mono-label whitespace-nowrap border-b border-line px-3 py-2.5 text-left">A#</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredOrders.map((order) => (
                    <tr
                      key={order.id}
                      tabIndex={0}
                      className="cursor-pointer border-b border-line/60 outline-none last:border-b-0 hover:bg-surface-hover focus-visible:bg-surface-hover"
                      onClick={() => router.push(`/planning/work-orders/${order.id}`)}
                      onKeyDown={(event) => {
                        if (event.key === "Enter") {
                          router.push(`/planning/work-orders/${order.id}`);
                        }
                      }}
                    >
                      <td className="px-4 py-2.5" onClick={(event) => event.stopPropagation()}>
                        <input
                          type="checkbox"
                          className="h-4 w-4 accent-accent"
                          checked={selected.has(order.id)}
                          onChange={() => toggleSelected(order.id)}
                          aria-label={`Select order ${order.orderNo || order.draftNo}`}
                        />
                      </td>
                      <td className="whitespace-nowrap px-3 py-2.5 font-mono">
                        {order.orderNo ? (
                          <span className="text-ink">{order.orderNo}</span>
                        ) : (
                          // A draft has no official number yet (decision N1). Its provisional id is
                          // shown dimmed so it can never be mistaken for one on screen.
                          <span className="text-ink-tertiary" title="Provisional — approve to assign the official number">
                            {order.draftNo || "draft"}
                          </span>
                        )}
                      </td>
                      <td className="max-w-[220px] truncate px-3 py-2.5 text-ink" title={order.customer}>
                        {order.customer}
                      </td>
                      <td className="max-w-[180px] truncate px-3 py-2.5 text-ink-secondary" title={order.model}>
                        {order.model}
                      </td>
                      <td className="whitespace-nowrap px-3 py-2.5 text-ink-secondary">
                        {WORK_ORDER_TYPE_LABELS[order.orderType]}
                      </td>
                      <td className="whitespace-nowrap px-3 py-2.5">
                        <span className={order.status === "in_production" ? "ui-chip-accent" : "ui-chip"}>
                          {WORK_ORDER_STATUS_LABELS[order.status]}
                        </span>
                      </td>
                      <td className="whitespace-nowrap px-3 py-2.5">
                        <SetCell order={order} onOpenMain={(id) => router.push(`/planning/work-orders/${id}`)} />
                      </td>
                      <td className="ui-mono-label whitespace-nowrap px-3 py-2.5 text-ink-tertiary">
                        {formatOrderDate(order.orderDate)}
                      </td>
                      <td className="whitespace-nowrap px-3 py-2.5">
                        {order.missingAssemblyCount > 0 ? (
                          <span className="text-danger">{order.missingAssemblyCount} missing</span>
                        ) : (
                          <span className="text-ink-tertiary">—</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </div>
    </PlanningShell>
  );
}
