"use client";

import { Loader2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ThemedSelect, type ThemedSelectOption } from "@/components/themed-select";
import {
  WORK_ORDER_TYPE_LABELS,
  WORK_ORDER_TYPES,
  suggestOrderNo,
  trailerOrderNo,
  type WorkOrderType,
} from "@/domain/work-orders";
import { createWorkOrder, listTrailerConfigs, listWorkOrders, type TrailerConfig } from "@/lib/planning/store";
import { PlanningShell } from "./planning-shell";
import { usePlanningWorkspace } from "./planning-workspace-provider";

const TYPE_OPTIONS: ThemedSelectOption[] = WORK_ORDER_TYPES.map((type) => ({
  value: type,
  label: WORK_ORDER_TYPE_LABELS[type],
}));

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

type FormState = {
  customer: string;
  model: string;
  orderType: WorkOrderType;
  orderDate: string;
  notes: string;
  /** Trailer configuration letter: optional on a Main, required on a trailer order, "" otherwise. */
  trailerLetter: string;
};

function blankForm(): FormState {
  return {
    customer: "",
    model: "",
    orderType: WORK_ORDER_TYPES[0],
    orderDate: todayIso(),
    notes: "",
    trailerLetter: "",
  };
}

/**
 * Create a blank work order. Lines and SKUs are added on the detail screen (item master
 * autocomplete); catalogs / schedule import will seed lines later. There is no MTS Excel
 * "template sheet" picker — those were layout clones, not product source of truth.
 */
export function WorkOrderNew() {
  const router = useRouter();
  const { workspaceId, canWrite } = usePlanningWorkspace();

  const [existingOrderNos, setExistingOrderNos] = useState<string[]>([]);
  const [trailerConfigs, setTrailerConfigs] = useState<TrailerConfig[]>([]);
  const [loadStatus, setLoadStatus] = useState<"loading" | "ready" | "error">("loading");
  const [form, setForm] = useState<FormState>(blankForm);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  const loadSeqRef = useRef(0);

  const refresh = useCallback(async () => {
    const seq = ++loadSeqRef.current;
    if (!workspaceId) {
      setExistingOrderNos([]);
      setTrailerConfigs([]);
      setLoadStatus("ready");
      return;
    }
    setLoadStatus("loading");
    setError("");
    try {
      const [orders, configs] = await Promise.all([
        listWorkOrders(workspaceId),
        listTrailerConfigs(workspaceId),
      ]);
      if (seq !== loadSeqRef.current) return;
      setExistingOrderNos(orders.map((order) => order.orderNo));
      setTrailerConfigs(configs);
      setLoadStatus("ready");
    } catch (caught) {
      if (seq !== loadSeqRef.current) return;
      setError(caught instanceof Error ? caught.message : "Could not load planning data.");
      setLoadStatus("error");
    }
  }, [workspaceId]);

  useEffect(() => {
    void refresh();
    return () => {
      loadSeqRef.current += 1;
    };
  }, [refresh]);

  const isHeadUnit = form.orderType === "head_unit";
  const requiresTrailerLetter = form.orderType === "trailer";
  const showTrailerSelect = isHeadUnit || requiresTrailerLetter;

  const trailerLetterOptions = useMemo<ThemedSelectOption[]>(() => {
    const configOptions = trailerConfigs.map((config) => ({
      value: config.letter,
      label: `${config.letter} — ${config.name || "Unnamed"}`,
    }));
    const placeholder = requiresTrailerLetter
      ? { value: "", label: "Select a configuration…" }
      : { value: "", label: "No trailer" };
    return [placeholder, ...configOptions];
  }, [trailerConfigs, requiresTrailerLetter]);

  const suggestedOrderNo = useMemo(
    () =>
      form.orderType === "trailer"
        ? trailerOrderNo(form.orderDate, form.trailerLetter || "?")
        : suggestOrderNo(existingOrderNos, form.orderDate, form.orderType),
    [existingOrderNos, form.orderDate, form.orderType, form.trailerLetter],
  );

  const trailerLetterValid = /^[A-Z]$/.test(form.trailerLetter);
  const canSubmit =
    canWrite &&
    Boolean(workspaceId) &&
    form.customer.trim() !== "" &&
    form.orderDate.trim() !== "" &&
    !saving &&
    loadStatus === "ready" &&
    (!requiresTrailerLetter || trailerLetterValid);

  async function handleCreate() {
    if (!workspaceId || !canSubmit) return;
    setSaving(true);
    setError("");
    try {
      const result = await createWorkOrder(workspaceId, {
        templateId: null,
        customer: form.customer.trim(),
        model: form.model.trim(),
        orderType: form.orderType,
        orderDate: form.orderDate,
        notes: form.notes,
        lines: [],
        trailerLetter: form.trailerLetter,
        pm: null,
      });
      router.push(`/planning/work-orders/${result.id}`);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not create the work order.");
      setSaving(false);
    }
  }

  return (
    <PlanningShell title="New work order" backHref="/planning">
      <div className="mx-auto max-w-xl space-y-5">
        <div>
          <h1 className="ui-section-title">New work order</h1>
          <p className="ui-section-subtitle">
            Fill in the header, then add line items on the next screen. The printed sheet layout is fixed —
            product SKUs come from the item master (and catalogs later), not from Excel template copies.
          </p>
        </div>

        {error ? <div className="ui-notice ui-notice-warn px-4 py-3 ui-section-subtitle">{error}</div> : null}

        <section className="ui-panel space-y-4 p-5">
          {!canWrite ? (
            <div className="ui-notice ui-notice-warn px-3 py-2 ui-section-subtitle">
              You have read-only access to Planning; ask an editor to create this order.
            </div>
          ) : null}

          <div>
            <label className="ui-mono-label" htmlFor="wo-new-customer">
              Customer
            </label>
            <input
              id="wo-new-customer"
              type="text"
              className="ui-input"
              value={form.customer}
              onChange={(event) => setForm((current) => ({ ...current, customer: event.target.value }))}
              disabled={!canWrite || saving}
              autoComplete="organization"
            />
          </div>

          <div>
            <label className="ui-mono-label" htmlFor="wo-new-model">
              Model
            </label>
            <input
              id="wo-new-model"
              type="text"
              className="ui-input"
              value={form.model}
              onChange={(event) => setForm((current) => ({ ...current, model: event.target.value }))}
              disabled={!canWrite || saving}
            />
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <label className="ui-mono-label">Type</label>
              <ThemedSelect
                value={form.orderType}
                onChange={(value) =>
                  setForm((current) => ({
                    ...current,
                    orderType: value as WorkOrderType,
                    // Drop trailer letter when switching to a type that doesn't use it.
                    trailerLetter:
                      value === "head_unit" || value === "trailer" ? current.trailerLetter : "",
                  }))
                }
                options={TYPE_OPTIONS}
                ariaLabel="Work order type"
                disabled={!canWrite || saving}
                className="mt-1 w-full"
              />
            </div>

            <div>
              <label className="ui-mono-label" htmlFor="wo-new-date">
                Order date
              </label>
              <input
                id="wo-new-date"
                type="date"
                className="ui-input"
                value={form.orderDate}
                onChange={(event) => setForm((current) => ({ ...current, orderDate: event.target.value }))}
                disabled={!canWrite || saving}
              />
            </div>
          </div>

          {showTrailerSelect ? (
            <div>
              <label className="ui-mono-label">
                Trailer {requiresTrailerLetter ? "configuration" : "configuration (optional)"}
              </label>
              {trailerConfigs.length === 0 ? (
                <p className="ui-section-subtitle mt-1 text-ink-tertiary">
                  No trailer configurations yet — add them in Settings → Trailer configurations.
                </p>
              ) : (
                <ThemedSelect
                  value={form.trailerLetter}
                  onChange={(value) => setForm((current) => ({ ...current, trailerLetter: value }))}
                  options={trailerLetterOptions}
                  ariaLabel="Trailer configuration"
                  disabled={!canWrite || saving}
                  className="mt-1 w-full"
                />
              )}
            </div>
          ) : null}

          <div>
            <label className="ui-mono-label" htmlFor="wo-new-notes">
              Notes
            </label>
            <textarea
              id="wo-new-notes"
              className="ui-input resize-none"
              rows={3}
              value={form.notes}
              onChange={(event) => setForm((current) => ({ ...current, notes: event.target.value }))}
              disabled={!canWrite || saving}
            />
          </div>

          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line pt-4">
            <div>
              <div className="ui-mono-label text-ink-tertiary">Order no. (suggested)</div>
              <div className="font-mono text-sm text-ink">{suggestedOrderNo}</div>
            </div>
            <p className="ui-section-subtitle text-right text-ink-tertiary">Starts with no lines — add items next.</p>
          </div>

          <div className="flex justify-end">
            <button
              type="button"
              className="ui-btn-primary h-9 gap-1.5 px-4 disabled:cursor-not-allowed disabled:opacity-40"
              disabled={!canSubmit}
              onClick={() => void handleCreate()}
            >
              {saving ? <Loader2 size={14} className="animate-spin" /> : null}
              {saving ? "Creating…" : "Create work order"}
            </button>
          </div>
        </section>
      </div>
    </PlanningShell>
  );
}
