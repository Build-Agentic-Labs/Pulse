"use client";

import { Loader2, MoreHorizontal, Plus, Printer } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { useConfirm } from "@/components/confirm-provider";
import { NothingLoadingBlock } from "@/components/nothing-ui";
import { UiContextMenu, type ContextMenuItem } from "@/components/ui-context-menu";
import {
  canTransitionWorkOrder,
  missingAssemblyCount,
  nextForwardStatus,
  WORK_ORDER_STATUS_FLOW,
  WORK_ORDER_STATUS_LABELS,
  WORK_ORDER_TYPE_LABELS,
  type WorkOrderStatus,
} from "@/domain/work-orders";
import {
  addWorkOrderLine,
  deleteWorkOrderLine,
  getWorkOrder,
  saveWorkOrderLine,
  transitionWorkOrder,
  updateWorkOrderHeader,
  type WorkOrderDetail as WorkOrderRecord,
  type WorkOrderLine,
} from "@/lib/planning/store";
import { PlanningShell } from "./planning-shell";
import { usePlanningWorkspace } from "./planning-workspace-provider";
import { WorkOrderLineRow } from "./work-order-line-row";

const FORWARD_ACTION_LABELS: Partial<Record<WorkOrderStatus, string>> = {
  draft: "Release",
  released: "Start production",
  in_production: "Mark shipped",
};

/** Customer/model/date/notes stay editable through `released`; from `in_production` on they lock. */
function headerFieldsEditable(status: WorkOrderStatus): boolean {
  return status === "draft" || status === "released";
}

/** Shipped qty only makes sense once production has actually started. */
function canEditShippedQty(status: WorkOrderStatus): boolean {
  return status === "in_production" || status === "shipped";
}

/** The one status a manager may step back to from `status`, or `null` if none applies. */
function stepBackTarget(status: WorkOrderStatus): WorkOrderStatus | null {
  if (status === "cancelled") {
    return "draft"; // Revive.
  }
  const index = WORK_ORDER_STATUS_FLOW.indexOf(status as (typeof WORK_ORDER_STATUS_FLOW)[number]);
  if (index <= 0) {
    return null;
  }
  return WORK_ORDER_STATUS_FLOW[index - 1];
}

type HeaderForm = {
  orderNo: string;
  customer: string;
  model: string;
  orderDate: string;
  notes: string;
};

function headerFormFrom(order: WorkOrderRecord): HeaderForm {
  return {
    orderNo: order.orderNo,
    customer: order.customer,
    model: order.model,
    orderDate: order.orderDate,
    notes: order.notes,
  };
}

/**
 * The Planning space's work-order editor: header band (order no, customer/model/date/notes,
 * status, A#-completeness badge), status transitions, and the editable line table. Owns its own
 * `PlanningShell` (same idiom as `WorkOrderBoard` / `WorkOrderNew`).
 */
export function WorkOrderDetail({ workOrderId }: { workOrderId: string }) {
  const confirm = useConfirm();
  const { workspaceId, canWrite, canManage } = usePlanningWorkspace();

  const [order, setOrder] = useState<WorkOrderRecord | null>(null);
  const [loadStatus, setLoadStatus] = useState<"loading" | "ready" | "error" | "not-found">("loading");
  const [error, setError] = useState("");
  const [form, setForm] = useState<HeaderForm | null>(null);
  const [transitioning, setTransitioning] = useState(false);
  const [addingLine, setAddingLine] = useState(false);
  const [menuAnchor, setMenuAnchor] = useState<DOMRect | null>(null);

  // Stale-response guard, same idiom as work-order-board.tsx's loadSeqRef: only the latest load
  // may commit state, so a slow initial fetch can't clobber a later refresh (e.g. after a failed
  // transition) or fire after unmount.
  const loadSeqRef = useRef(0);

  const refresh = useCallback(async (options?: { preserveError?: boolean }) => {
    const seq = ++loadSeqRef.current;
    if (!workspaceId || !workOrderId) {
      return;
    }
    setLoadStatus("loading");
    // `preserveError` keeps a just-set notice (e.g. "This order changed elsewhere — reloading")
    // visible through the reload; without it, this synchronous clear batches with the caller's
    // setError and the message would never paint.
    if (!options?.preserveError) {
      setError("");
    }
    try {
      const found = await getWorkOrder(workspaceId, workOrderId);
      if (seq !== loadSeqRef.current) return;
      if (!found) {
        setOrder(null);
        setForm(null);
        setLoadStatus("not-found");
        return;
      }
      setOrder(found);
      setForm(headerFormFrom(found));
      setLoadStatus("ready");
    } catch (caught) {
      if (seq !== loadSeqRef.current) return;
      setError(caught instanceof Error ? caught.message : "Could not load the work order.");
      setLoadStatus("error");
    }
  }, [workspaceId, workOrderId]);

  useEffect(() => {
    void refresh();
    return () => {
      loadSeqRef.current += 1;
    };
  }, [refresh]);

  async function saveHeaderField<K extends keyof HeaderForm & keyof WorkOrderRecord>(field: K, value: HeaderForm[K]) {
    if (!workspaceId || !order || order[field] === value) {
      return;
    }
    const previousValue = order[field];
    setOrder((current) => (current ? { ...current, [field]: value } : current));
    try {
      await updateWorkOrderHeader(workspaceId, order.id, { [field]: value } as Partial<HeaderForm>);
    } catch (caught) {
      // Roll back ONLY the failed field -- restoring the whole header form would wipe
      // un-blurred edits in sibling fields (same rationale as the line row's per-field resync).
      setOrder((current) => (current ? { ...current, [field]: previousValue } : current));
      setForm((current) => (current ? { ...current, [field]: previousValue } : current));
      setError(caught instanceof Error ? caught.message : "Could not save the work order.");
    }
  }

  const handleLineFieldSave = useCallback(
    (lineId: string, patch: Partial<Omit<WorkOrderLine, "id">>) => {
      if (!workspaceId) return;
      let previousLine: WorkOrderLine | undefined;
      setOrder((current) => {
        if (!current) return current;
        previousLine = current.lines.find((line) => line.id === lineId);
        return { ...current, lines: current.lines.map((line) => (line.id === lineId ? { ...line, ...patch } : line)) };
      });
      void saveWorkOrderLine(workspaceId, lineId, patch).catch((caught) => {
        if (previousLine) {
          const restored = previousLine;
          setOrder((current) =>
            current ? { ...current, lines: current.lines.map((line) => (line.id === lineId ? restored : line)) } : current,
          );
        }
        setError(caught instanceof Error ? caught.message : "Could not save the line.");
      });
    },
    [workspaceId],
  );

  async function handleAddLine() {
    if (!workspaceId || !order || addingLine) return;
    setAddingLine(true);
    setError("");
    const blankLine: Omit<WorkOrderLine, "id"> = {
      itemNo: "",
      description: "",
      buildQty: 1,
      shippedQty: null,
      fulfillment: "assembly",
      assemblyOrderNo: "",
      pullFromRef: "",
    };
    try {
      const id = await addWorkOrderLine(workspaceId, order.id, blankLine);
      setOrder((current) => (current ? { ...current, lines: [...current.lines, { id, ...blankLine }] } : current));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not add the line.");
    } finally {
      setAddingLine(false);
    }
  }

  async function handleDeleteLine(line: WorkOrderLine) {
    if (!workspaceId || !order) return;
    const ok = await confirm({
      title: `Delete line “${line.itemNo || "this line"}”?`,
      body: "This removes the line from the work order.",
      tone: "danger",
      confirmLabel: "Delete line",
    });
    if (!ok) return;

    const previousLines = order.lines;
    setOrder((current) => (current ? { ...current, lines: current.lines.filter((l) => l.id !== line.id) } : current));
    try {
      await deleteWorkOrderLine(workspaceId, line.id);
    } catch (caught) {
      setOrder((current) => (current ? { ...current, lines: previousLines } : current));
      setError(caught instanceof Error ? caught.message : "Could not delete the line.");
    }
  }

  async function handleTransition(to: WorkOrderStatus) {
    if (!workspaceId || !order || transitioning) return;
    setTransitioning(true);
    setError("");
    try {
      const ok = await transitionWorkOrder(workspaceId, order.id, order.status, to);
      if (!ok) {
        setError("This order changed elsewhere — reloading");
        await refresh({ preserveError: true });
        return;
      }
      await refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not update the work order's status.");
    } finally {
      setTransitioning(false);
    }
  }

  async function handleCancel() {
    if (!order) return;
    const ok = await confirm({
      title: `Cancel order ${order.orderNo}?`,
      body: "This stops the order from progressing further. A manager can restore it to draft afterward.",
      tone: "danger",
      confirmLabel: "Cancel order",
    });
    if (!ok) return;
    await handleTransition("cancelled");
  }

  const next = order ? nextForwardStatus(order.status) : null;
  const canForward =
    Boolean(order) && Boolean(next) && canWrite && canTransitionWorkOrder(order!.status, next!, { isManager: canManage });

  const stepBack = order ? stepBackTarget(order.status) : null;
  const canCancel =
    Boolean(order) && canWrite && canTransitionWorkOrder(order!.status, "cancelled", { isManager: canManage });
  const canStepBack =
    Boolean(order) &&
    canManage &&
    stepBack !== null &&
    canTransitionWorkOrder(order!.status, stepBack, { isManager: canManage });

  const menuItems: ContextMenuItem[] = [
    ...(canCancel ? [{ id: "cancel", label: "Cancel order", danger: true, onSelect: () => void handleCancel() }] : []),
    ...(canStepBack && stepBack
      ? [
          {
            id: "step-back",
            label: `Step back to ${WORK_ORDER_STATUS_LABELS[stepBack]}`,
            onSelect: () => void handleTransition(stepBack),
          },
        ]
      : []),
  ];

  const missing = order ? missingAssemblyCount(order.lines) : 0;
  const headerEditable = order ? headerFieldsEditable(order.status) : false;
  const shippedQtyEditable = order ? canEditShippedQty(order.status) : false;

  return (
    <PlanningShell
      title={order ? order.orderNo : "Work order"}
      actions={
        order ? (
          <div className="flex items-center gap-2">
            <Link href={`/planning/work-orders/${order.id}/print`} className="ui-btn-ghost h-8 gap-1.5 px-3">
              <Printer size={13} />
              Print
            </Link>
            {canForward ? (
              <button
                type="button"
                className="ui-btn-primary h-8 gap-1.5 px-3 disabled:cursor-not-allowed disabled:opacity-40"
                disabled={transitioning}
                onClick={() => void handleTransition(next!)}
              >
                {transitioning ? <Loader2 size={13} className="animate-spin" /> : null}
                {FORWARD_ACTION_LABELS[order.status]}
              </button>
            ) : null}
            {menuItems.length > 0 ? (
              <button
                type="button"
                className="ui-btn-ghost h-8 w-8 px-0"
                aria-haspopup="menu"
                aria-expanded={menuAnchor !== null}
                aria-label="More work order actions"
                onClick={(event) => setMenuAnchor((current) => (current ? null : event.currentTarget.getBoundingClientRect()))}
              >
                <MoreHorizontal size={14} />
              </button>
            ) : null}
            {menuAnchor ? (
              <UiContextMenu
                anchorRect={menuAnchor}
                items={menuItems}
                onClose={() => setMenuAnchor(null)}
                ariaLabel="Work order actions"
              />
            ) : null}
          </div>
        ) : null
      }
    >
      {loadStatus === "loading" ? (
        <NothingLoadingBlock title="Loading work order" />
      ) : loadStatus === "not-found" ? (
        <section className="ui-panel p-5">
          <p className="ui-section-subtitle text-ink-tertiary">No work order found for this id.</p>
        </section>
      ) : loadStatus === "error" ? (
        <section className="ui-panel p-5">
          <p className="ui-section-subtitle text-ink-tertiary">{error || "Could not load the work order."}</p>
          <button type="button" className="ui-btn-ghost mt-3 inline-flex h-9 px-3" onClick={() => void refresh()}>
            Retry
          </button>
        </section>
      ) : order && form ? (
        <div className="space-y-5">
          {error ? <div className="ui-notice ui-notice-warn px-4 py-3 ui-section-subtitle">{error}</div> : null}

          <section className="ui-panel space-y-4 p-5">
            <div className="flex flex-wrap items-center gap-3">
              <div>
                <div className="ui-mono-label text-ink-tertiary">Order no.</div>
                {canManage ? (
                  <input
                    className="ui-input mt-1 w-44 font-mono text-lg"
                    value={form.orderNo}
                    onChange={(event) => setForm((current) => (current ? { ...current, orderNo: event.target.value } : current))}
                    onBlur={() => void saveHeaderField("orderNo", form.orderNo.trim())}
                  />
                ) : (
                  <div className="mt-1 font-mono text-lg text-ink">{order.orderNo}</div>
                )}
              </div>
              <span className={order.status === "in_production" ? "ui-chip-accent" : "ui-chip"}>
                {WORK_ORDER_STATUS_LABELS[order.status]}
              </span>
              {missing > 0 ? <span className="text-danger">A#s incomplete — {missing} missing</span> : null}
            </div>

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div>
                <label className="ui-mono-label" htmlFor="wo-customer">
                  Customer
                </label>
                <input
                  id="wo-customer"
                  type="text"
                  className="ui-input"
                  value={form.customer}
                  disabled={!canWrite || !headerEditable}
                  onChange={(event) => setForm((current) => (current ? { ...current, customer: event.target.value } : current))}
                  onBlur={() => void saveHeaderField("customer", form.customer.trim())}
                />
              </div>
              <div>
                <label className="ui-mono-label" htmlFor="wo-model">
                  Model
                </label>
                <input
                  id="wo-model"
                  type="text"
                  className="ui-input"
                  value={form.model}
                  disabled={!canWrite || !headerEditable}
                  onChange={(event) => setForm((current) => (current ? { ...current, model: event.target.value } : current))}
                  onBlur={() => void saveHeaderField("model", form.model.trim())}
                />
              </div>
            </div>

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div>
                <label className="ui-mono-label" htmlFor="wo-date">
                  Order date
                </label>
                <input
                  id="wo-date"
                  type="date"
                  className="ui-input"
                  value={form.orderDate}
                  disabled={!canWrite || !headerEditable}
                  onChange={(event) => setForm((current) => (current ? { ...current, orderDate: event.target.value } : current))}
                  onBlur={() => void saveHeaderField("orderDate", form.orderDate)}
                />
              </div>
              <div>
                <div className="ui-mono-label">Type</div>
                <div className="mt-1 py-3 text-sm text-ink-secondary">{WORK_ORDER_TYPE_LABELS[order.orderType]}</div>
              </div>
            </div>

            <div>
              <label className="ui-mono-label" htmlFor="wo-notes">
                Notes
              </label>
              <textarea
                id="wo-notes"
                className="ui-input resize-none"
                rows={3}
                value={form.notes}
                disabled={!canWrite || !headerEditable}
                onChange={(event) => setForm((current) => (current ? { ...current, notes: event.target.value } : current))}
                onBlur={() => void saveHeaderField("notes", form.notes)}
              />
            </div>
          </section>

          <section className="ui-panel overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full min-w-[960px] border-collapse text-sm">
                <thead>
                  <tr>
                    <th className="ui-mono-label whitespace-nowrap border-b border-line px-3 py-2.5 text-left">Item no</th>
                    <th className="ui-mono-label whitespace-nowrap border-b border-line px-3 py-2.5 text-left">Description</th>
                    <th className="ui-mono-label whitespace-nowrap border-b border-line px-3 py-2.5 text-left">Build qty</th>
                    <th className="ui-mono-label whitespace-nowrap border-b border-line px-3 py-2.5 text-left">Fulfillment</th>
                    <th className="ui-mono-label whitespace-nowrap border-b border-line px-3 py-2.5 text-left">A# / Pull ref</th>
                    <th className="ui-mono-label whitespace-nowrap border-b border-line px-3 py-2.5 text-left">Shipped qty</th>
                    <th className="border-b border-line px-3 py-2.5" aria-hidden="true" />
                  </tr>
                </thead>
                <tbody>
                  {order.lines.length === 0 ? (
                    <tr>
                      <td colSpan={7} className="px-4 py-10 text-center">
                        <p className="ui-section-subtitle text-ink-tertiary">No lines yet.</p>
                      </td>
                    </tr>
                  ) : (
                    order.lines.map((line) => (
                      <WorkOrderLineRow
                        key={line.id}
                        line={line}
                        workspaceId={workspaceId}
                        canWrite={canWrite}
                        canEditShippedQty={shippedQtyEditable}
                        onFieldSave={handleLineFieldSave}
                        onDelete={(target) => void handleDeleteLine(target)}
                      />
                    ))
                  )}
                </tbody>
              </table>
            </div>
            {canWrite ? (
              <div className="border-t border-line p-3">
                <button
                  type="button"
                  className="ui-btn-ghost h-8 gap-1.5 px-3 disabled:cursor-not-allowed disabled:opacity-40"
                  disabled={addingLine}
                  onClick={() => void handleAddLine()}
                >
                  {addingLine ? <Loader2 size={13} className="animate-spin" /> : <Plus size={13} />}
                  Add line
                </button>
              </div>
            ) : null}
          </section>
        </div>
      ) : null}
    </PlanningShell>
  );
}
