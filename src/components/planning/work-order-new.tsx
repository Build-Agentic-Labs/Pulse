"use client";

import { AlertTriangle, ArrowLeft, Loader2 } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { ThemedSelect, type ThemedSelectOption } from "@/components/themed-select";
import { formatDate } from "@/domain/formatting";
import { getConfig, loadConfigIndex, type ConfigDetail } from "@/lib/planning/config-store";
import {
  listSalesOrders,
  listUnconvertedLines,
  markLineConverted,
  type SalesOrderLineRow,
  type SalesOrderSummary,
} from "@/lib/planning/sales-order-store";
import {
  createDraftWorkOrderSet,
  listTrailerConfigs,
  type TrailerConfig,
  type WorkOrderLine,
} from "@/lib/planning/store";
import { PlanningShell } from "./planning-shell";
import { usePlanningWorkspace } from "./planning-workspace-provider";

/**
 * Create a work order from a SALES ORDER line rather than by typing.
 *
 * Pick the sales order → pick the unit → every field and both parts lists fill in from the SKU
 * catalog → verify → save as a draft. The official number is minted later, at approval, so a
 * draft that turns out wrong can simply be discarded without leaving a hole in the sequence
 * production builds against.
 */

/** A line's parts, assembled from its FG SKU (+ accessory SKU appended) before saving. */
type PreparedSet = {
  line: SalesOrderLineRow;
  genConfig: ConfigDetail;
  pmConfig: ConfigDetail | null;
  accConfig: ConfigDetail | null;
  /** Generator BOM followed by the accessory BOM, one continuous sequence. */
  mainLines: Array<Omit<WorkOrderLine, "id">>;
  pmLines: Array<Omit<WorkOrderLine, "id">>;
};

function toWorkOrderLines(
  configs: readonly (ConfigDetail | null)[],
  assemblyOrderNo: string,
): Array<Omit<WorkOrderLine, "id">> {
  const lines: Array<Omit<WorkOrderLine, "id">> = [];
  for (const config of configs) {
    if (!config) continue;
    for (const line of config.lines) {
      lines.push({
        itemNo: line.itemNo,
        description: line.description,
        buildQty: line.buildQty,
        shippedQty: null,
        fulfillment: "assembly",
        assemblyOrderNo,
        pullFromRef: "",
      });
    }
  }
  return lines;
}

export function WorkOrderNew() {
  const router = useRouter();
  const { workspaceId, canWrite } = usePlanningWorkspace();

  const [salesOrders, setSalesOrders] = useState<SalesOrderSummary[]>([]);
  const [trailers, setTrailers] = useState<TrailerConfig[]>([]);
  const [selectedSalesOrder, setSelectedSalesOrder] = useState("");
  const [lines, setLines] = useState<SalesOrderLineRow[]>([]);
  const [prepared, setPrepared] = useState<PreparedSet | null>(null);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  // Verified/editable header fields, seeded from the resolved line.
  const [orderDate, setOrderDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [trailerLetter, setTrailerLetter] = useState("");
  const [notes, setNotes] = useState("");

  useEffect(() => {
    if (!workspaceId) return;
    let cancelled = false;
    Promise.all([listSalesOrders(workspaceId), listTrailerConfigs(workspaceId)])
      .then(([orders, trailerConfigs]) => {
        if (cancelled) return;
        setSalesOrders(orders.filter((order) => order.convertedCount < order.lineCount));
        setTrailers(trailerConfigs);
        setStatus("ready");
      })
      .catch((cause: unknown) => {
        if (cancelled) return;
        setError(cause instanceof Error ? cause.message : "Could not load sales orders.");
        setStatus("error");
      });
    return () => {
      cancelled = true;
    };
  }, [workspaceId]);

  const pickSalesOrder = useCallback(
    async (salesOrderId: string) => {
      setSelectedSalesOrder(salesOrderId);
      setPrepared(null);
      setLines([]);
      if (!workspaceId || !salesOrderId) return;
      try {
        setLines(await listUnconvertedLines(workspaceId, salesOrderId));
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : "Could not load the sales order's lines.");
      }
    },
    [workspaceId],
  );

  /** Resolve one line's SKUs into real parts lists. */
  const pickLine = useCallback(
    async (line: SalesOrderLineRow) => {
      if (!workspaceId) return;
      setError("");
      setBusy(true);
      try {
        const index = await loadConfigIndex(workspaceId);
        const genEntry = index.bySku.get(line.fgSku.trim().toUpperCase());
        if (!genEntry) {
          throw new Error(`FG SKU "${line.fgSku}" has no product configuration yet.`);
        }
        const accEntry = line.accSku ? index.bySku.get(line.accSku.trim().toUpperCase()) : undefined;
        if (line.accSku && !accEntry) {
          throw new Error(`Accessory SKU "${line.accSku}" has no product configuration yet.`);
        }

        const [genConfig, pmConfig, accConfig] = await Promise.all([
          getConfig(workspaceId, genEntry.id),
          genEntry.pmConfigId ? getConfig(workspaceId, genEntry.pmConfigId) : Promise.resolve(null),
          accEntry ? getConfig(workspaceId, accEntry.id) : Promise.resolve(null),
        ]);
        if (!genConfig) throw new Error("The generator configuration could not be loaded.");

        setPrepared({
          line,
          genConfig,
          pmConfig,
          accConfig,
          // Accessory lines are APPENDED to the generator order rather than becoming their own
          // order, so a traveler reads generator BOM first and accessories second.
          mainLines: toWorkOrderLines([genConfig, accConfig], line.assemblyOrderNo),
          pmLines: toWorkOrderLines([pmConfig], line.assemblyOrderNo),
        });
        setTrailerLetter(line.trailerLetter);
        setNotes(genConfig.notesDefault);
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : "Could not prepare that line.");
        setPrepared(null);
      } finally {
        setBusy(false);
      }
    },
    [workspaceId],
  );

  async function saveDraft() {
    if (!workspaceId || !prepared) return;
    setBusy(true);
    setError("");
    try {
      const result = await createDraftWorkOrderSet(workspaceId, {
        salesOrderLineId: prepared.line.id,
        salesOrderNo: prepared.line.soNo,
        templateId: prepared.genConfig.id,
        customer: prepared.line.customerRaw || prepared.genConfig.customer,
        model: prepared.genConfig.model || prepared.line.modelRaw,
        orderDate,
        notes,
        trailerLetter,
        lines: prepared.mainLines,
        pm: prepared.pmConfig
          ? {
              templateId: prepared.pmConfig.id,
              customer: prepared.line.customerRaw || prepared.pmConfig.customer,
              model: prepared.pmConfig.model,
              notes: prepared.pmConfig.notesDefault,
              lines: prepared.pmLines,
            }
          : null,
      });
      await markLineConverted(workspaceId, prepared.line.id, result.id);
      router.push(`/planning/work-orders/${result.id}`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not create the work order.");
      setBusy(false);
    }
  }

  const salesOrderOptions: ThemedSelectOption[] = [
    { value: "", label: "Select a sales order…" },
    ...salesOrders.map((order) => ({
      value: order.id,
      label: `${order.soNo} — ${order.customer || "no customer"} (${order.lineCount - order.convertedCount} to build)`,
    })),
  ];

  const trailerOptions: ThemedSelectOption[] = [
    { value: "", label: "No trailer" },
    ...trailers.map((trailer) => ({
      value: trailer.letter,
      label: `${trailer.letter} — ${trailer.name || "Unnamed"}`,
    })),
  ];

  return (
    <PlanningShell title="New work order" backHref="/planning">
      <section className="space-y-5">
        {status === "loading" ? (
          <div className="ui-panel p-5 text-sm text-ink-secondary">Loading sales orders…</div>
        ) : null}

        {error ? <div className="ui-panel border-danger/40 p-4 text-sm text-danger">{error}</div> : null}

        {status === "ready" && salesOrders.length === 0 ? (
          <section className="ui-panel p-5">
            <div className="ui-mono-label">Nothing to build yet</div>
            <p className="mt-3 text-sm text-ink-secondary">
              Work orders are created from a sales order line.{" "}
              <Link href="/planning/sales-orders" className="underline underline-offset-2">
                Upload a production schedule
              </Link>{" "}
              to get started.
            </p>
          </section>
        ) : null}

        {status === "ready" && salesOrders.length > 0 ? (
          <section className="ui-panel space-y-4 p-5">
            <div className="space-y-1.5">
              <span className="ui-mono-label">Sales order</span>
              <ThemedSelect
                value={selectedSalesOrder}
                options={salesOrderOptions}
                ariaLabel="Sales order"
                onChange={(value) => void pickSalesOrder(value)}
              />
            </div>

            {lines.length > 0 ? (
              <div className="space-y-1.5">
                <span className="ui-mono-label">Unit</span>
                <ul className="divide-y divide-line">
                  {lines.map((line) => (
                    <li key={line.id}>
                      <button
                        type="button"
                        className={`flex w-full items-center gap-3 px-1 py-2 text-left text-[13px] hover:bg-raised/40 ${
                          prepared?.line.id === line.id ? "text-ink" : "text-ink-secondary"
                        }`}
                        onClick={() => void pickLine(line)}
                      >
                        <span className="font-mono text-[12px] text-ink-tertiary">row {line.sourceRowNo}</span>
                        <span>{line.modelRaw || "—"}</span>
                        <span className="font-mono text-[12px]">{line.fgSku}</span>
                        {line.status === "flagged" ? (
                          <span className="ml-auto flex items-center gap-1 text-[12px] text-danger">
                            <AlertTriangle size={12} strokeWidth={1.75} />
                            {line.flags.filter((flag) => flag.blocking).length} blocking
                          </span>
                        ) : null}
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
          </section>
        ) : null}

        {prepared ? (
          <>
            <section className="ui-panel space-y-4 p-5">
              <div className="ui-mono-label">Verify</div>
              <dl className="grid gap-3 sm:grid-cols-3">
                <Field label="Sales order" value={prepared.line.soNo || "—"} mono />
                <Field label="Customer" value={prepared.line.customerRaw || "—"} />
                <Field label="Model" value={prepared.genConfig.model || prepared.line.modelRaw || "—"} />
                <Field label="FG SKU" value={prepared.genConfig.sku} mono />
                <Field label="Accessory SKU" value={prepared.accConfig?.sku ?? "—"} mono />
                <Field label="Assembly A#" value={prepared.line.assemblyOrderNo || "to enter"} mono />
              </dl>

              <div className="grid gap-4 sm:grid-cols-3">
                <label className="space-y-1.5">
                  <span className="ui-mono-label">Order date</span>
                  <input
                    type="date"
                    className="ui-input w-full"
                    value={orderDate}
                    onChange={(event) => setOrderDate(event.target.value)}
                  />
                  <span className="block text-[11px] text-ink-tertiary">
                    Decides the number series ({formatDate(orderDate)}).
                  </span>
                </label>

                <div className="space-y-1.5">
                  <span className="ui-mono-label">Trailer</span>
                  <ThemedSelect
                    value={trailerLetter}
                    options={trailerOptions}
                    ariaLabel="Trailer configuration"
                    onChange={setTrailerLetter}
                  />
                  <span className="block text-[11px] text-ink-tertiary">
                    Matched against supermarket stock at assembly.
                  </span>
                </div>

                <label className="space-y-1.5">
                  <span className="ui-mono-label">Notes</span>
                  <input className="ui-input w-full" value={notes} onChange={(event) => setNotes(event.target.value)} />
                </label>
              </div>

              {prepared.line.flags.length > 0 ? (
                <ul className="space-y-1">
                  {prepared.line.flags.map((flag) => (
                    <li
                      key={flag.code}
                      className={`text-[12px] ${flag.blocking ? "text-danger" : "text-ink-tertiary"}`}
                    >
                      {flag.code} — {flag.detail}
                    </li>
                  ))}
                </ul>
              ) : null}
            </section>

            <PartsPanel
              title={`Generator${prepared.accConfig ? " + accessories" : ""}`}
              lines={prepared.mainLines}
            />
            {prepared.pmConfig ? <PartsPanel title="Power module" lines={prepared.pmLines} /> : null}

            <div className="flex items-center gap-3">
              <button
                type="button"
                className="ui-btn-primary inline-flex h-9 items-center gap-2 px-3 text-[12px] disabled:opacity-50"
                disabled={!canWrite || busy}
                onClick={() => void saveDraft()}
              >
                {busy ? <Loader2 size={13} className="animate-spin" /> : null}
                Save as draft
              </button>
              <span className="text-[12px] text-ink-tertiary">
                The official work order number is assigned when you approve it.
              </span>
            </div>
          </>
        ) : null}

        <Link href="/planning" className="ui-btn-ghost inline-flex h-8 items-center gap-1.5 px-2 text-[12px]">
          <ArrowLeft size={14} strokeWidth={1.75} />
          Back to work orders
        </Link>
      </section>
    </PlanningShell>
  );
}

function Field({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div>
      <dt className="ui-mono-label text-ink-tertiary">{label}</dt>
      <dd className={`mt-1 text-[13px] text-ink ${mono ? "font-mono text-[12px]" : ""}`}>{value}</dd>
    </div>
  );
}

function PartsPanel({ title, lines }: { title: string; lines: readonly Omit<WorkOrderLine, "id">[] }) {
  return (
    <section className="ui-panel p-5">
      <div className="flex items-center gap-3">
        <span className="ui-mono-label">{title}</span>
        <span className="text-[12px] text-ink-tertiary">
          {lines.length} {lines.length === 1 ? "part" : "parts"}
        </span>
      </div>
      {lines.length === 0 ? (
        <p className="mt-3 text-sm text-danger">
          This configuration has no parts — the work order would be empty.
        </p>
      ) : (
        <div className="mt-3 overflow-x-auto">
          <table className="w-full border-collapse text-[13px]">
            <thead>
              <tr>
                <th className="ui-mono-label border-b border-line px-2 py-2 text-left">Item</th>
                <th className="ui-mono-label border-b border-line px-2 py-2 text-left">Description</th>
                <th className="ui-mono-label border-b border-line px-2 py-2 text-left">Qty</th>
              </tr>
            </thead>
            <tbody>
              {lines.map((line, index) => (
                <tr key={`${line.itemNo}-${index}`}>
                  <td className="border-b border-line px-2 py-1.5 font-mono text-[12px]">{line.itemNo}</td>
                  <td className="border-b border-line px-2 py-1.5 text-ink-secondary">{line.description}</td>
                  <td className="border-b border-line px-2 py-1.5">{line.buildQty}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
