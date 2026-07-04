"use client";

/**
 * Print-ready work-order sheets: one white "paper" document per order, shared by the single-order
 * preview route (`app/planning/work-orders/[id]/print/page.tsx`) and the batch route
 * (`app/planning/print/page.tsx`). `WorkOrderPrintDocument` is a pure render — no data fetching —
 * so both routes can load orders their own way and hand the same markup to the browser's print
 * pipeline (Cmd+P / `window.print()`).
 *
 * The sheet is white paper in both app themes (same precedent as the exported HTML documents in
 * `src/domain/report.ts`): colors are hardcoded rather than pulled from the app's CSS variables,
 * only the font stack (`--type-sans` / `--type-mono`) is shared with the rest of the app.
 */

import { ArrowLeft, Printer } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { NothingLoadingBlock } from "@/components/nothing-ui";
import { WORK_ORDER_TYPE_LABELS } from "@/domain/work-orders";
import { getWorkOrder, type WorkOrderDetail, type WorkOrderLine } from "@/lib/planning/store";
import { usePlanningWorkspace } from "./planning-workspace-provider";

// ── formatting helpers ───────────────────────────────────────────────────

/** "2026-07-15" -> a locale date string. Matches the precedent in work-order-board.tsx. */
function formatOrderDate(iso: string): string {
  if (!iso) return "";
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? iso : date.toLocaleDateString();
}

/** The line's source: an A-number for assembly lines, or a PULL FROM note for the other two. */
function formatSource(line: WorkOrderLine): string {
  if (line.fulfillment === "pull_from") {
    return `PULL FROM ${line.pullFromRef}`.trim();
  }
  if (line.fulfillment === "pull_from_stock") {
    return `PULL FROM STOCK ${line.pullFromRef}`.trim();
  }
  return line.assemblyOrderNo;
}

/** Entered shipped qty, or a signature blank when nothing's been shipped yet. */
function formatShipped(line: WorkOrderLine): string {
  return line.shippedQty === null ? "__________" : String(line.shippedQty);
}

// ── document ─────────────────────────────────────────────────────────────

const PRINT_STYLES = `
.wo-sheet {
  background: #fff;
  color: #13211b;
  font-family: var(--type-sans);
  max-width: 820px;
  margin: 0 auto 24px;
  padding: 48px 56px;
  border: 1px solid #d8d0c2;
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.08);
}
.wo-sheet-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  margin-bottom: 32px;
}
.wo-customer {
  font-size: 28px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.02em;
  line-height: 1.15;
}
.wo-order-type {
  margin-top: 4px;
  font-size: 13px;
  color: #52606d;
}
.wo-meta {
  font-family: var(--type-mono);
  font-size: 12px;
  line-height: 1.7;
  text-align: right;
  color: #13211b;
  white-space: nowrap;
}
.wo-lines {
  width: 100%;
  border-collapse: collapse;
  margin-bottom: 28px;
  font-size: 13px;
}
.wo-lines th {
  border-bottom: 1px solid #13211b;
  padding: 6px 8px;
  font-family: var(--type-mono);
  font-size: 10px;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  color: #52606d;
  text-align: left;
}
.wo-lines td {
  border-bottom: 1px solid #d8d0c2;
  padding: 8px;
  vertical-align: top;
}
.wo-mono {
  font-family: var(--type-mono);
}
.wo-notes {
  margin-bottom: 32px;
}
.wo-notes-label {
  margin-bottom: 6px;
  font-family: var(--type-mono);
  font-size: 10px;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  color: #52606d;
}
.wo-notes p {
  margin: 0;
  white-space: pre-wrap;
  font-size: 13px;
}
.wo-sheet-footer {
  border-top: 1px solid #d8d0c2;
  padding-top: 12px;
  font-family: var(--type-mono);
  font-size: 10px;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  color: #52606d;
}
@media print {
  body {
    background: #fff;
  }
  /* The on-screen preview scrolls inside a fixed-height container (document scrolling is
     disabled app-wide); when printing, that container must expand or output gets clipped
     to the first page-height of content. */
  .wo-print-scroll {
    height: auto !important;
    overflow: visible !important;
  }
  .wo-print-chrome {
    display: none;
  }
  .wo-sheet {
    break-after: page;
    margin: 0;
    border: none;
    box-shadow: none;
  }
  tr {
    break-inside: avoid;
  }
}
@page {
  margin: 14mm;
}
`;

export interface WorkOrderPrintDocumentProps {
  order: WorkOrderDetail;
  lines: WorkOrderLine[];
}

/** One printed page for a single work order. Pure render — reused by both print routes. */
export function WorkOrderPrintDocument({ order, lines }: WorkOrderPrintDocumentProps) {
  return (
    <>
      <style>{PRINT_STYLES}</style>
      <article className="wo-sheet">
        <header className="wo-sheet-header">
          <div>
            <div className="wo-customer">{order.customer}</div>
            <div className="wo-order-type">{WORK_ORDER_TYPE_LABELS[order.orderType]}</div>
          </div>
          <div className="wo-meta">
            <div>Order {order.orderNo}</div>
            <div>{formatOrderDate(order.orderDate)}</div>
            <div>{order.model}</div>
          </div>
        </header>

        <table className="wo-lines">
          <thead>
            <tr>
              <th>Item no</th>
              <th>Description</th>
              <th>Source</th>
              <th>Build qty</th>
              <th>Shipped</th>
            </tr>
          </thead>
          <tbody>
            {lines.map((line) => (
              <tr key={line.id}>
                <td className="wo-mono">{line.itemNo}</td>
                <td>{line.description}</td>
                <td>{formatSource(line)}</td>
                <td>{line.buildQty}</td>
                <td className="wo-mono">{formatShipped(line)}</td>
              </tr>
            ))}
          </tbody>
        </table>

        {order.notes.trim() ? (
          <div className="wo-notes">
            <div className="wo-notes-label">Notes</div>
            <p>{order.notes}</p>
          </div>
        ) : null}

        <footer className="wo-sheet-footer">Pulse · printed {new Date().toLocaleString()}</footer>
      </article>
    </>
  );
}

// ── shared toolbar ───────────────────────────────────────────────────────

function PrintToolbar({ backHref, label }: { backHref: string; label: string }) {
  return (
    <div className="wo-print-chrome sticky top-0 z-10 flex items-center gap-3 border-b border-line bg-surface px-4 py-2">
      <Link href={backHref} className="ui-btn-ghost h-8 gap-1.5 px-3">
        <ArrowLeft size={13} />
        Back
      </Link>
      <span className="flex-1" />
      <span className="ui-mono-label text-ink-tertiary">{label}</span>
      <button type="button" className="ui-btn-primary h-8 gap-1.5 px-3" onClick={() => window.print()}>
        <Printer size={13} />
        Print
      </button>
    </div>
  );
}

// ── single-order preview ─────────────────────────────────────────────────

/** Screen preview + print trigger for one work order. Used by the `[id]/print` route. */
export function WorkOrderPrintPreview({ workOrderId }: { workOrderId: string }) {
  const { workspaceId } = usePlanningWorkspace();
  const [order, setOrder] = useState<WorkOrderDetail | null>(null);
  const [status, setStatus] = useState<"loading" | "ready" | "error" | "not-found">("loading");
  const [error, setError] = useState("");

  // Stale-response guard, same idiom as work-order-detail.tsx's loadSeqRef: only the latest load
  // may commit state.
  const loadSeqRef = useRef(0);

  const refresh = useCallback(async () => {
    const seq = ++loadSeqRef.current;
    if (!workspaceId || !workOrderId) return;
    setStatus("loading");
    setError("");
    try {
      const found = await getWorkOrder(workspaceId, workOrderId);
      if (seq !== loadSeqRef.current) return;
      if (!found) {
        setOrder(null);
        setStatus("not-found");
        return;
      }
      setOrder(found);
      setStatus("ready");
    } catch (caught) {
      if (seq !== loadSeqRef.current) return;
      setError(caught instanceof Error ? caught.message : "Could not load the work order.");
      setStatus("error");
    }
  }, [workspaceId, workOrderId]);

  useEffect(() => {
    void refresh();
    return () => {
      loadSeqRef.current += 1;
    };
  }, [refresh]);

  return (
    <div className="wo-print-scroll h-[100dvh] overflow-y-auto bg-canvas">
      <PrintToolbar backHref={`/planning/work-orders/${workOrderId}`} label={order ? order.orderNo : "Work order"} />
      <div className="px-8 py-8">
        {status === "loading" ? (
          <NothingLoadingBlock title="Loading work order" />
        ) : status === "not-found" ? (
          <section className="wo-print-chrome ui-panel mx-auto max-w-[820px] p-5">
            <p className="ui-section-subtitle text-ink-tertiary">No work order found for this id.</p>
          </section>
        ) : status === "error" ? (
          <section className="wo-print-chrome ui-panel mx-auto max-w-[820px] p-5">
            <p className="ui-section-subtitle text-ink-tertiary">{error || "Could not load the work order."}</p>
            <button type="button" className="ui-btn-ghost mt-3 inline-flex h-9 px-3" onClick={() => void refresh()}>
              Retry
            </button>
          </section>
        ) : order ? (
          <WorkOrderPrintDocument order={order} lines={order.lines} />
        ) : null}
      </div>
    </div>
  );
}

// ── batch preview ────────────────────────────────────────────────────────

/** Screen preview + print trigger for a batch of work orders, stacked one sheet per page. */
export function BatchPrintPreview({ ids }: { ids: string[] }) {
  const { workspaceId } = usePlanningWorkspace();
  const [orders, setOrders] = useState<WorkOrderDetail[]>([]);
  const [failedIds, setFailedIds] = useState<string[]>([]);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [error, setError] = useState("");

  const loadSeqRef = useRef(0);

  const refresh = useCallback(async () => {
    const seq = ++loadSeqRef.current;
    if (ids.length === 0) {
      setOrders([]);
      setFailedIds([]);
      setStatus("ready");
      return;
    }
    if (!workspaceId) return;
    setStatus("loading");
    setError("");
    try {
      const results = await Promise.all(
        ids.map(async (id) => {
          try {
            const found = await getWorkOrder(workspaceId, id);
            return { id, order: found };
          } catch {
            return { id, order: null };
          }
        }),
      );
      if (seq !== loadSeqRef.current) return;
      setOrders(results.filter((result) => result.order !== null).map((result) => result.order as WorkOrderDetail));
      setFailedIds(results.filter((result) => result.order === null).map((result) => result.id));
      setStatus("ready");
    } catch (caught) {
      if (seq !== loadSeqRef.current) return;
      setError(caught instanceof Error ? caught.message : "Could not load the work orders.");
      setStatus("error");
    }
  }, [workspaceId, ids]);

  useEffect(() => {
    void refresh();
    return () => {
      loadSeqRef.current += 1;
    };
  }, [refresh]);

  return (
    <div className="wo-print-scroll h-[100dvh] overflow-y-auto bg-canvas">
      <PrintToolbar backHref="/planning" label={`Print ${ids.length} work order${ids.length === 1 ? "" : "s"}`} />
      <div className="px-8 py-8">
        {status === "loading" ? (
          <NothingLoadingBlock title="Loading work orders" />
        ) : status === "error" ? (
          <section className="wo-print-chrome ui-panel mx-auto max-w-[820px] p-5">
            <p className="ui-section-subtitle text-ink-tertiary">{error || "Could not load the work orders."}</p>
            <button type="button" className="ui-btn-ghost mt-3 inline-flex h-9 px-3" onClick={() => void refresh()}>
              Retry
            </button>
          </section>
        ) : (
          <>
            {failedIds.length > 0 ? (
              <div className="wo-print-chrome ui-notice ui-notice-warn mx-auto mb-6 max-w-[820px]">
                <p className="ui-section-subtitle">
                  {failedIds.length} order{failedIds.length === 1 ? "" : "s"} could not be loaded and{" "}
                  {failedIds.length === 1 ? "is" : "are"} not included below:
                </p>
                <p className="ui-mono-label mt-1 text-ink-tertiary">{failedIds.join(", ")}</p>
              </div>
            ) : null}
            {orders.length === 0 && failedIds.length === 0 ? (
              <section className="wo-print-chrome ui-panel mx-auto max-w-[820px] p-5">
                <p className="ui-section-subtitle text-ink-tertiary">No work orders were selected to print.</p>
              </section>
            ) : null}
            {orders.map((order) => (
              <WorkOrderPrintDocument key={order.id} order={order} lines={order.lines} />
            ))}
          </>
        )}
      </div>
    </div>
  );
}
