"use client";

import { Loader2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { ThemedSelect, type ThemedSelectOption } from "@/components/themed-select";
import { WORK_ORDER_TYPE_LABELS, type WorkOrderType } from "@/domain/work-orders";
import { createWorkOrder, type TrailerConfig } from "@/lib/planning/store";

/**
 * Create an order that does NOT come from a sales order line.
 *
 * Trailers are the reason this exists: decision D3 keeps them as a supermarket, built against a
 * standing `TRL-MMYY-{LETTER}` order per configuration per month rather than one per unit. No
 * schedule line produces them, so the sales-order flow never will — and without this the monthly
 * trailer orders could not be created at all. Rework and make-to-stock are the same shape.
 *
 * These take their official number at creation (the legacy `createWorkOrder` path). That is
 * correct and not an N1 violation: N1 defers numbering so a DISCARDED draft leaves no hole, and
 * these are issued deliberately, one per month, not speculatively per schedule row.
 */

/** Types that legitimately have no sales-order line behind them. */
const STANDALONE_TYPES: readonly WorkOrderType[] = ["trailer", "accessories", "decal", "rework", "mts"];

const TYPE_OPTIONS: ThemedSelectOption[] = STANDALONE_TYPES.map((type) => ({
  value: type,
  label: WORK_ORDER_TYPE_LABELS[type],
}));

export function StandaloneWorkOrderForm({
  workspaceId,
  canWrite,
  trailers,
}: {
  workspaceId: string;
  canWrite: boolean;
  trailers: readonly TrailerConfig[];
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [orderType, setOrderType] = useState<WorkOrderType>("trailer");
  const [customer, setCustomer] = useState("");
  const [model, setModel] = useState("");
  const [trailerLetter, setTrailerLetter] = useState("");
  const [orderDate, setOrderDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const isTrailer = orderType === "trailer";

  const trailerOptions: ThemedSelectOption[] = [
    { value: "", label: isTrailer ? "Select a configuration…" : "No trailer" },
    ...trailers.map((trailer) => ({
      value: trailer.letter,
      label: `${trailer.letter} — ${trailer.name || "Unnamed"}`,
    })),
  ];

  async function create() {
    if (!workspaceId) return;
    setBusy(true);
    setError("");
    try {
      const result = await createWorkOrder(workspaceId, {
        templateId: null,
        customer,
        model,
        orderType,
        orderDate,
        notes,
        lines: [],
        trailerLetter,
      });
      router.push(`/planning/work-orders/${result.id}`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not create the order.");
      setBusy(false);
    }
  }

  if (!open) {
    return (
      <button
        type="button"
        className="ui-btn-ghost h-8 px-2 text-[12px] text-ink-tertiary hover:text-ink"
        onClick={() => setOpen(true)}
      >
        Need a trailer, rework or stock order instead?
      </button>
    );
  }

  return (
    <section className="ui-panel space-y-4 p-5">
      <div className="flex items-center gap-3">
        <span className="ui-mono-label">Order without a sales order</span>
        <span className="flex-1" />
        <button type="button" className="ui-btn-ghost h-8 px-2 text-[12px]" onClick={() => setOpen(false)}>
          Close
        </button>
      </div>

      <p className="text-[12px] text-ink-tertiary">
        Trailers are built to a supermarket — one standing order per configuration per month, which
        generators then draw from by letter. These are numbered immediately.
      </p>

      {error ? <p className="text-sm text-danger">{error}</p> : null}

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-1.5">
          <span className="ui-mono-label">Type</span>
          <ThemedSelect
            value={orderType}
            options={TYPE_OPTIONS}
            ariaLabel="Order type"
            onChange={(value) => setOrderType(value as WorkOrderType)}
          />
        </div>

        <div className="space-y-1.5">
          <span className="ui-mono-label">{isTrailer ? "Trailer configuration" : "Trailer"}</span>
          <ThemedSelect
            value={trailerLetter}
            options={trailerOptions}
            disabled={!isTrailer}
            ariaLabel="Trailer configuration"
            onChange={setTrailerLetter}
          />
        </div>

        <label className="space-y-1.5">
          <span className="ui-mono-label">Customer</span>
          <input className="ui-input w-full" value={customer} onChange={(event) => setCustomer(event.target.value)} />
        </label>

        <label className="space-y-1.5">
          <span className="ui-mono-label">Model</span>
          <input className="ui-input w-full" value={model} onChange={(event) => setModel(event.target.value)} />
        </label>

        <label className="space-y-1.5">
          <span className="ui-mono-label">Order date</span>
          <input
            type="date"
            className="ui-input w-full"
            value={orderDate}
            onChange={(event) => setOrderDate(event.target.value)}
          />
        </label>

        <label className="space-y-1.5">
          <span className="ui-mono-label">Notes</span>
          <input className="ui-input w-full" value={notes} onChange={(event) => setNotes(event.target.value)} />
        </label>
      </div>

      <button
        type="button"
        className="ui-btn-primary inline-flex h-9 items-center gap-2 px-3 text-[12px] disabled:opacity-50"
        disabled={!canWrite || busy || (isTrailer && trailerLetter === "")}
        onClick={() => void create()}
      >
        {busy ? <Loader2 size={13} className="animate-spin" /> : null}
        Create order
      </button>
      {isTrailer && trailerLetter === "" ? (
        <span className="ml-3 text-[12px] text-ink-tertiary">A trailer order needs its configuration letter.</span>
      ) : null}
    </section>
  );
}
