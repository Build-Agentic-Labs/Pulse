"use client";

import { ArrowLeft, Upload } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { formatDateTime } from "@/domain/formatting";
import {
  getImportLines,
  listImports,
  listSalesOrders,
  type SalesOrderLineRow,
  type SalesOrderSummary,
  type ScheduleImportSummary,
} from "@/lib/planning/sales-order-store";
import { ExportColumnPanel } from "./export-column-panel";
import { ScheduleUpload } from "./schedule-upload";
import { usePlanningWorkspace } from "./planning-workspace-provider";

/**
 * Sales orders: upload a monthly production schedule, and get the work-order id column back to
 * paste into it. The schedule stops being the system of record and becomes an interchange format.
 */

type View =
  | { kind: "list" }
  | { kind: "upload" }
  | { kind: "import"; scheduleImport: ScheduleImportSummary };

export function SalesOrdersWorkspace() {
  const { workspaceId, canWrite } = usePlanningWorkspace();

  const [salesOrders, setSalesOrders] = useState<SalesOrderSummary[]>([]);
  const [imports, setImports] = useState<ScheduleImportSummary[]>([]);
  const [lines, setLines] = useState<SalesOrderLineRow[]>([]);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [error, setError] = useState("");
  const [view, setView] = useState<View>({ kind: "list" });

  const refresh = useCallback(async () => {
    if (!workspaceId) return;
    try {
      const [nextOrders, nextImports] = await Promise.all([
        listSalesOrders(workspaceId),
        listImports(workspaceId),
      ]);
      setSalesOrders(nextOrders);
      setImports(nextImports);
      setStatus("ready");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not load sales orders.");
      setStatus("error");
    }
  }, [workspaceId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const openImport = useCallback(
    async (scheduleImport: ScheduleImportSummary) => {
      if (!workspaceId) return;
      setView({ kind: "import", scheduleImport });
      setError("");
      setLines([]);
      try {
        setLines(await getImportLines(workspaceId, scheduleImport.id));
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : "Could not load the import's lines.");
      }
    },
    [workspaceId],
  );

  if (status === "loading") {
    return <div className="ui-panel p-5 text-sm text-ink-secondary">Loading sales orders…</div>;
  }

  if (status === "error") {
    return (
      <section className="ui-panel p-5">
        <div className="ui-mono-label">Could not load</div>
        <p className="mt-3 text-sm text-danger">{error}</p>
      </section>
    );
  }

  if (view.kind === "upload") {
    return (
      <ScheduleUpload
        workspaceId={workspaceId ?? ""}
        canWrite={canWrite}
        onCancel={() => setView({ kind: "list" })}
        onImported={async (importId) => {
          await refresh();
          const created = (await listImports(workspaceId ?? "")).find((row) => row.id === importId);
          if (created) void openImport(created);
          else setView({ kind: "list" });
        }}
      />
    );
  }

  if (view.kind === "import") {
    return (
      <section className="space-y-4">
        <div className="flex flex-wrap items-center gap-3">
          <button
            type="button"
            className="ui-btn-ghost inline-flex h-8 items-center gap-1.5 px-2 text-[12px]"
            onClick={() => setView({ kind: "list" })}
          >
            <ArrowLeft size={14} strokeWidth={1.75} />
            Back
          </button>
          <span className="ui-mono-label text-ink-secondary">{view.scheduleImport.fileName}</span>
        </div>

        {/* A failed line load must be visible here — the export column would otherwise render an
            all-blank column and simply look like nothing has been approved yet. */}
        {error ? <div className="ui-panel border-danger/40 p-4 text-sm text-danger">{error}</div> : null}

        <ExportColumnPanel scheduleImport={view.scheduleImport} lines={lines} />

        <section className="ui-data-table-frame ui-data-table-frame-canvas overflow-x-auto">
          <table className="w-full border-collapse text-[13px]">
            <thead>
              <tr>
                <th className="ui-mono-label border-b border-line px-3 py-2.5 text-left">Row</th>
                <th className="ui-mono-label border-b border-line px-3 py-2.5 text-left">SO#</th>
                <th className="ui-mono-label border-b border-line px-3 py-2.5 text-left">Model</th>
                <th className="ui-mono-label border-b border-line px-3 py-2.5 text-left">FG SKU</th>
                <th className="ui-mono-label border-b border-line px-3 py-2.5 text-left">Status</th>
                <th className="ui-mono-label border-b border-line px-3 py-2.5 text-left">Work order</th>
              </tr>
            </thead>
            <tbody>
              {lines.map((line) => (
                <tr key={line.id}>
                  <td className="border-b border-line px-3 py-2 font-mono text-[12px] text-ink-tertiary">
                    {line.sourceRowNo}
                  </td>
                  <td className="border-b border-line px-3 py-2 font-mono text-[12px]">{line.soNo || "—"}</td>
                  <td className="border-b border-line px-3 py-2 text-ink-secondary">{line.modelRaw || "—"}</td>
                  <td className="border-b border-line px-3 py-2 font-mono text-[12px]">{line.fgSku || "—"}</td>
                  <td className="border-b border-line px-3 py-2">
                    <span className={line.status === "flagged" ? "text-danger" : "text-ink-secondary"}>
                      {line.status}
                    </span>
                    {line.flags.length > 0 ? (
                      <span className="ml-2 text-[11px] text-ink-tertiary">
                        {line.flags.map((flag) => flag.code).join(", ")}
                      </span>
                    ) : null}
                  </td>
                  <td className="border-b border-line px-3 py-2 font-mono text-[12px]">{line.orderNo || "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      </section>
    );
  }

  return (
    <section className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="ui-section-title">Sales orders</h1>
          <p className="ui-section-subtitle">
            Import the production schedule and convert approved lines into work orders.
          </p>
        </div>
        {canWrite ? (
          <button
            type="button"
            className="ui-btn-primary inline-flex h-9 items-center gap-2 px-3 text-[12px]"
            onClick={() => setView({ kind: "upload" })}
          >
            <Upload size={14} strokeWidth={1.75} />
            Upload schedule
          </button>
        ) : null}
      </div>

      <div className="ui-mono-label text-ink-secondary">
        {salesOrders.length} {salesOrders.length === 1 ? "sales order" : "sales orders"}
      </div>

      {imports.length === 0 ? (
        <section className="ui-panel p-5">
          <div className="ui-mono-label">No schedules imported yet</div>
          <p className="mt-3 text-sm text-ink-secondary">
            Upload a monthly production schedule. Each line is resolved against the product
            configuration catalog, and once its work orders are approved you get a column of
            generator ids to paste back into the sheet.
          </p>
        </section>
      ) : (
        <>
          <section className="space-y-2">
            <div className="ui-mono-label">Imports</div>
            <div className="ui-data-table-frame ui-data-table-frame-canvas overflow-x-auto">
              <table className="w-full border-collapse text-[13px]">
                <thead>
                  <tr>
                    <th className="ui-mono-label border-b border-line px-3 py-2.5 text-left">File</th>
                    <th className="ui-mono-label border-b border-line px-3 py-2.5 text-left">Sheet</th>
                    <th className="ui-mono-label border-b border-line px-3 py-2.5 text-left">Rows</th>
                    <th className="ui-mono-label border-b border-line px-3 py-2.5 text-left">Imported</th>
                  </tr>
                </thead>
                <tbody>
                  {imports.map((row) => (
                    <tr key={row.id} className="hover:bg-raised/40">
                      <td className="border-b border-line px-3 py-2.5">
                        <button
                          type="button"
                          className="text-ink underline-offset-2 hover:underline"
                          onClick={() => void openImport(row)}
                        >
                          {row.fileName}
                        </button>
                      </td>
                      <td className="border-b border-line px-3 py-2.5 text-ink-secondary">{row.sheetName}</td>
                      <td className="border-b border-line px-3 py-2.5 font-mono text-[12px] text-ink-tertiary">
                        {row.firstRowNo}–{row.lastRowNo}
                      </td>
                      <td className="border-b border-line px-3 py-2.5 text-ink-secondary">
                        {formatDateTime(row.importedAt)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          <section className="space-y-2">
            <div className="ui-mono-label">Sales orders</div>
            <div className="ui-data-table-frame ui-data-table-frame-canvas overflow-x-auto">
              <table className="w-full border-collapse text-[13px]">
                <thead>
                  <tr>
                    <th className="ui-mono-label border-b border-line px-3 py-2.5 text-left">SO#</th>
                    <th className="ui-mono-label border-b border-line px-3 py-2.5 text-left">Customer</th>
                    <th className="ui-mono-label border-b border-line px-3 py-2.5 text-left">Lines</th>
                    <th className="ui-mono-label border-b border-line px-3 py-2.5 text-left">Converted</th>
                  </tr>
                </thead>
                <tbody>
                  {salesOrders.map((order) => (
                    <tr key={order.id}>
                      <td className="border-b border-line px-3 py-2.5 font-mono text-[12px]">{order.soNo}</td>
                      <td className="border-b border-line px-3 py-2.5 text-ink-secondary">{order.customer || "—"}</td>
                      <td className="border-b border-line px-3 py-2.5 text-ink-secondary">{order.lineCount}</td>
                      <td className="border-b border-line px-3 py-2.5 text-ink-secondary">
                        {order.convertedCount} of {order.lineCount}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        </>
      )}
    </section>
  );
}
