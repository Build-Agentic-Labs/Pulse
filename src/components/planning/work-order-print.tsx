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
import { getWorkOrder, getWorkOrderMatch, type WorkOrderDetail, type WorkOrderLine } from "@/lib/planning/store";
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
  padding: 44px 52px;
  border: 1px solid #d8d0c2;
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.08);
  /* US Letter proportions on screen, so the preview reads as the real page. */
  aspect-ratio: 8.5 / 11;
  display: flex;
  flex-direction: column;
}
.wo-sheet-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  margin-bottom: 24px;
}
.wo-logo {
  height: 40px;
  width: auto;
}
.wo-meta {
  font-family: var(--type-mono);
  font-size: 13px;
  line-height: 1.7;
  text-align: right;
  color: #13211b;
  white-space: nowrap;
}
.wo-title {
  font-size: 26px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.02em;
  line-height: 1.2;
}
.wo-order-type {
  margin-top: 2px;
  font-family: var(--type-mono);
  font-size: 12px;
  text-transform: uppercase;
  letter-spacing: 0.08em;
  color: #52606d;
}
.wo-model {
  margin-top: 14px;
  margin-bottom: 26px;
  font-family: var(--type-mono);
  font-size: 18px;
  font-weight: 700;
}
/* Final-assembly match block: the one strip the operator reads to pick the set.
   Three tags — GEN set number, PM set number, trailer letter — big and unmissable. */
.wo-match {
  display: flex;
  border: 2px solid #13211b;
  margin-bottom: 26px;
}
.wo-match-cell {
  flex: 1;
  padding: 10px 14px 12px;
  border-right: 1px solid #13211b;
}
.wo-match-cell:last-child {
  border-right: none;
}
.wo-match-label {
  font-family: var(--type-mono);
  font-size: 9px;
  text-transform: uppercase;
  letter-spacing: 0.12em;
  color: #52606d;
}
.wo-match-value {
  margin-top: 2px;
  font-family: var(--type-mono);
  font-size: 30px;
  font-weight: 700;
  line-height: 1.1;
}
.wo-match-sub {
  margin-top: 2px;
  font-family: var(--type-mono);
  font-size: 10px;
  color: #52606d;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.wo-match-title {
  font-family: var(--type-mono);
  font-size: 9px;
  text-transform: uppercase;
  letter-spacing: 0.12em;
  color: #13211b;
  margin-bottom: 6px;
}
.wo-lines {
  width: 100%;
  border-collapse: collapse;
  margin-bottom: 28px;
  font-size: 14px;
}
.wo-lines th {
  border-bottom: 2px solid #13211b;
  padding: 6px 8px;
  font-family: var(--type-mono);
  font-size: 10px;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  color: #13211b;
  text-align: left;
}
.wo-lines th.wo-col-qty,
.wo-lines td.wo-col-qty {
  text-align: center;
  width: 110px;
}
.wo-lines td {
  padding: 10px 8px 2px;
  vertical-align: bottom;
}
.wo-lines th:first-child,
.wo-lines td:first-child {
  width: 170px;
  white-space: nowrap;
}
.wo-lines td:nth-child(2) {
  white-space: nowrap;
}
/* Description sits on its own row under the item number, like the Excel sheet;
   the block divider lives under the description, not between the pair. */
.wo-line-desc td {
  border-bottom: 1px solid #d8d0c2;
  padding: 2px 8px 12px;
  font-size: 12.5px;
  color: #52606d;
}
.wo-mono {
  font-family: var(--type-mono);
}
/* Notes + footer sit at the bottom of the page, matching the Excel layout. */
.wo-sheet-bottom {
  margin-top: auto;
}
/* Inside the fit-to-screen preview pane the sheet keeps its natural letter size and
   the pane scales it as a whole — see FittedPrintPreview in work-order-detail.tsx. */
.wo-fit .wo-sheet {
  width: 820px;
  max-width: none;
  margin: 0;
}
.wo-notes {
  margin-bottom: 28px;
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
    /* Pagination owns the page height when printing; the on-screen letter
       aspect and bottom-pinning must not force overflow onto a second page. */
    aspect-ratio: auto;
    display: block;
  }
  tr,
  tbody {
    break-inside: avoid;
  }
}
@page {
  margin: 14mm;
}
`;

/** Set/letter pairing shown in the final-assembly match block on a Main work order. */
export interface WorkOrderMatchInfo {
  /** The short set number both married documents carry, e.g. "01". */
  setNo: string;
  /** The paired power-module order number, e.g. "PM-0726-01". Null = no PM in this set. */
  pmOrderNo: string | null;
  /** Trailer configuration letter from the config catalog, e.g. "A". Null = no trailer. */
  trailerLetter: string | null;
  /** Human name of the trailer configuration, e.g. "Dual axle · electric brakes". */
  trailerConfigName?: string | null;
}

export interface WorkOrderPrintDocumentProps {
  order: WorkOrderDetail;
  lines: WorkOrderLine[];
  /** When present (Main orders), renders the final-assembly match strip. */
  match?: WorkOrderMatchInfo | null;
}

/** One printed page for a single work order. Pure render — reused by both print routes. */
export function WorkOrderPrintDocument({ order, lines, match }: WorkOrderPrintDocumentProps) {
  return (
    <>
      <style>{PRINT_STYLES}</style>
      <article className="wo-sheet">
        <header className="wo-sheet-header">
          {/* eslint-disable-next-line @next/next/no-img-element -- self-contained print document */}
          <img className="wo-logo" src="/sop/ana-logo.png" alt="ANA" />
          <div className="wo-meta">
            <div>Order {order.orderNo}</div>
            <div>{formatOrderDate(order.orderDate)}</div>
          </div>
        </header>

        {/* Title block mirrors the Excel sheet: "<CUSTOMER> WORK ORDER", type, then model. */}
        <div>
          <div className="wo-title">{order.customer ? `${order.customer} Work Order` : "Work Order"}</div>
          <div className="wo-order-type">{WORK_ORDER_TYPE_LABELS[order.orderType]}</div>
        </div>
        {order.model ? <div className="wo-model">{order.model}</div> : <div className="wo-model" />}

        {match ? (
          <div>
            <div className="wo-match-title">Final assembly match</div>
            <div className="wo-match">
              <div className="wo-match-cell">
                <div className="wo-match-label">Gen</div>
                <div className="wo-match-value">{match.setNo}</div>
                <div className="wo-match-sub">{order.orderNo}</div>
              </div>
              <div className="wo-match-cell">
                <div className="wo-match-label">Power module</div>
                <div className="wo-match-value">{match.pmOrderNo ? match.setNo : "—"}</div>
                <div className="wo-match-sub">{match.pmOrderNo ?? "No power module in this set"}</div>
              </div>
              <div className="wo-match-cell">
                <div className="wo-match-label">Trailer</div>
                <div className="wo-match-value">{match.trailerLetter ?? "—"}</div>
                <div className="wo-match-sub">
                  {match.trailerLetter
                    ? match.trailerConfigName ?? "Pull any matching trailer"
                    : "No trailer in this set"}
                </div>
              </div>
            </div>
          </div>
        ) : null}

        <table className="wo-lines">
          <thead>
            <tr>
              <th>Item no.</th>
              <th>A# / Source</th>
              <th className="wo-col-qty">Build qty</th>
              <th className="wo-col-qty">Shipped qty</th>
            </tr>
          </thead>
          {lines.map((line) => (
            <tbody key={line.id}>
              <tr>
                <td className="wo-mono">{line.itemNo}</td>
                <td className="wo-mono">{formatSource(line)}</td>
                <td className="wo-col-qty">{line.buildQty}</td>
                <td className="wo-col-qty wo-mono">{formatShipped(line)}</td>
              </tr>
              <tr className="wo-line-desc">
                <td colSpan={4}>{line.description}</td>
              </tr>
            </tbody>
          ))}
        </table>

        <div className="wo-sheet-bottom">
          <div className="wo-notes">
            <div className="wo-notes-label">Notes</div>
            <p>{order.notes.trim() ? order.notes : "—"}</p>
          </div>
          <footer className="wo-sheet-footer">Pulse · printed {new Date().toLocaleString()}</footer>
        </div>
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
  const [match, setMatch] = useState<WorkOrderMatchInfo | null>(null);
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
      // Mains carry the final-assembly match strip; other types render without it. The lookup is
      // isolated (own catch) so a match failure degrades to no strip rather than erroring a page
      // whose order loaded fine — matching the detail view and batch route.
      const info =
        found.orderType === "head_unit" ? await getWorkOrderMatch(workspaceId, found).catch(() => null) : null;
      if (seq === loadSeqRef.current) setMatch(info);
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
          <WorkOrderPrintDocument order={order} lines={order.lines} match={match} />
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
  const [matches, setMatches] = useState<Record<string, WorkOrderMatchInfo | null>>({});
  const [failedIds, setFailedIds] = useState<string[]>([]);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [error, setError] = useState("");

  const loadSeqRef = useRef(0);

  const refresh = useCallback(async () => {
    const seq = ++loadSeqRef.current;
    if (ids.length === 0) {
      setOrders([]);
      setMatches({});
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
            // Each Main carries its own match strip; a failed match lookup degrades to no strip.
            const match =
              found && found.orderType === "head_unit"
                ? await getWorkOrderMatch(workspaceId, found).catch(() => null)
                : null;
            return { id, order: found, match };
          } catch {
            return { id, order: null, match: null };
          }
        }),
      );
      if (seq !== loadSeqRef.current) return;
      const loaded = results.filter((result) => result.order !== null);
      setOrders(loaded.map((result) => result.order as WorkOrderDetail));
      setMatches(Object.fromEntries(loaded.map((result) => [(result.order as WorkOrderDetail).id, result.match])));
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
              <WorkOrderPrintDocument key={order.id} order={order} lines={order.lines} match={matches[order.id] ?? null} />
            ))}
          </>
        )}
      </div>
    </div>
  );
}
