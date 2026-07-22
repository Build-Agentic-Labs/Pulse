"use client";

import { Check, Copy } from "lucide-react";
import { useMemo, useState } from "react";
import { buildExportColumn, exportColumnText } from "@/domain/planning/export-column";
import type { ScheduleImportSummary, SalesOrderLineRow } from "@/lib/planning/sales-order-store";

/**
 * The copy-paste column handed back to the production schedule.
 *
 * Built from the import's ROW RANGE, not from the lines that happen to have orders — so a
 * skipped divider row or an unapproved line leaves a BLANK cell and everything below it stays on
 * its own spreadsheet row. The range is shown so the planner can confirm the paste target before
 * committing it.
 */
export function ExportColumnPanel({
  scheduleImport,
  lines,
}: {
  scheduleImport: ScheduleImportSummary;
  lines: readonly SalesOrderLineRow[];
}) {
  const [copied, setCopied] = useState(false);

  const column = useMemo(
    () =>
      buildExportColumn(
        lines.map((line) => ({ sourceRowNo: line.sourceRowNo, orderNo: line.orderNo })),
        { first: scheduleImport.firstRowNo, last: scheduleImport.lastRowNo },
      ),
    [lines, scheduleImport.firstRowNo, scheduleImport.lastRowNo],
  );

  async function copy() {
    try {
      await navigator.clipboard.writeText(exportColumnText(column));
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
    }
  }

  return (
    <section className="ui-panel space-y-3 p-5">
      <div>
        <div className="ui-mono-label">Work order column</div>
        <p className="mt-2 text-sm text-ink-secondary">
          {scheduleImport.fileName} — rows {scheduleImport.firstRowNo}–{scheduleImport.lastRowNo}
        </p>
        <p className="mt-1 text-[12px] text-ink-tertiary">
          {column.filled} of {column.total} rows have an approved work order. Blank cells are rows with
          no approved order yet — paste the whole block so every id lands on its own row.
        </p>
      </div>

      {column.total === 0 ? (
        <p className="text-sm text-danger">
          This import has no usable row range, so no column can be built.
        </p>
      ) : (
        <>
          <div className="max-h-[320px] overflow-auto rounded border border-line bg-canvas">
            <ol className="divide-y divide-line font-mono text-[12px]" start={scheduleImport.firstRowNo}>
              {column.cells.map((cell, index) => (
                <li
                  key={scheduleImport.firstRowNo + index}
                  className="flex items-center gap-3 px-3 py-1"
                  title={`Spreadsheet row ${scheduleImport.firstRowNo + index}`}
                >
                  <span className="w-10 shrink-0 text-right text-ink-tertiary">
                    {scheduleImport.firstRowNo + index}
                  </span>
                  <span className={cell ? "text-ink" : "text-ink-tertiary"}>{cell || "—"}</span>
                </li>
              ))}
            </ol>
          </div>

          <button
            type="button"
            className="ui-btn-primary inline-flex h-9 items-center gap-2 px-3 text-[12px]"
            onClick={() => void copy()}
          >
            {copied ? <Check size={14} strokeWidth={1.75} /> : <Copy size={14} strokeWidth={1.75} />}
            {copied ? "Copied" : `Copy ${column.total} cells`}
          </button>
        </>
      )}
    </section>
  );
}
