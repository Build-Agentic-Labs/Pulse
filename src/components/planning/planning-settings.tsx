"use client";

import { ChevronDown, ChevronRight, Loader2, Upload } from "lucide-react";
import { Fragment, useRef, useState, type ChangeEvent } from "react";
import { ThemedFeedbackLayer, type FeedbackToast } from "@/components/themed-feedback";
import { ThemedSelect, type ThemedSelectOption } from "@/components/themed-select";
import { WORK_ORDER_TYPE_LABELS, WORK_ORDER_TYPES, type WorkOrderType } from "@/domain/work-orders";
import type { ParsedItemMasterRow } from "@/lib/planning/parse-item-master";
import { parseItemMasterRows } from "@/lib/planning/parse-item-master";
import { parseTemplateSheet, type ParsedTemplateLine, type ParsedTemplateSheet } from "@/lib/planning/parse-workbook";
import { readItemMasterFile, readWorkbookFile } from "@/lib/planning/read-files";
import { importTemplates, upsertItemMaster } from "@/lib/planning/store";
import { usePlanningWorkspace } from "./planning-workspace-provider";
import { TemplateLibrary } from "./template-library";

const TYPE_OPTIONS: ThemedSelectOption[] = WORK_ORDER_TYPES.map((type) => ({
  value: type,
  label: WORK_ORDER_TYPE_LABELS[type],
}));

/** Monotonic id source for locally-created toasts -- module-scoped like line-workspace.tsx's toast counter. */
let toastSeq = 0;

type ItemMasterPreview = {
  fileName: string;
  items: ParsedItemMasterRow[];
  rejectedRows: number[];
  error: string | null;
};

/** One parsed sheet, editable before commit: customer/model/type are user-correctable in the preview. */
type ParsedSheetDraft = {
  sheetName: string;
  templateName: string;
  customer: string;
  model: string;
  orderType: WorkOrderType;
  notes: string;
  lines: ParsedTemplateLine[];
  warnings: string[];
};

type SkippedSheet = { sheetName: string; reason: string };

type Progress = { done: number; total: number; detail?: string };

/** Thin monochrome progress bar + caption, used while long imports run. */
function ProgressRow({ label, progress }: { label: string; progress: Progress }) {
  const percent = progress.total > 0 ? Math.round((progress.done / progress.total) * 100) : 0;
  return (
    <div className="mt-3" role="progressbar" aria-valuemin={0} aria-valuemax={progress.total} aria-valuenow={progress.done}>
      <div className="flex items-baseline justify-between gap-3">
        <span className="ui-section-subtitle text-ink">
          {label} {progress.done} / {progress.total}
          {progress.detail ? <span className="text-ink-tertiary"> · {progress.detail}</span> : null}
        </span>
        <span className="ui-mono-label text-ink-tertiary">{percent}%</span>
      </div>
      <div className="mt-1.5 h-1 overflow-hidden rounded-full bg-border-strong/40">
        <div
          className="h-full rounded-full bg-accent transition-[width] duration-200 ease-out"
          style={{ width: `${percent}%` }}
        />
      </div>
    </div>
  );
}

function draftToSheet(draft: ParsedSheetDraft): ParsedTemplateSheet {
  return {
    sheetName: draft.sheetName,
    templateName: draft.templateName,
    customer: draft.customer,
    model: draft.model,
    orderType: draft.orderType,
    notes: draft.notes,
    lines: draft.lines,
    warnings: draft.warnings,
  };
}

/**
 * Settings surface for the Planning space: item-master upload, work-order workbook import, and
 * the template library. Rendered as a full-width section inline in `WorkOrderBoard`, toggled by
 * its header gear button -- no modal, matching the brief's "no new modal idiom" constraint.
 * `canWrite` gates the entire surface (see `usePlanningWorkspace`); read-only users never see it.
 */
export function PlanningSettings() {
  const { workspaceId, canWrite } = usePlanningWorkspace();
  const [toasts, setToasts] = useState<FeedbackToast[]>([]);
  const [templateReloadToken, setTemplateReloadToken] = useState(0);

  function notify(toast: Omit<FeedbackToast, "id">) {
    toastSeq += 1;
    setToasts((current) => [...current, { ...toast, id: toastSeq }]);
  }

  function dismissToast(id: number) {
    setToasts((current) => current.filter((toast) => toast.id !== id));
  }

  // ── item master ──────────────────────────────────────────────────────────
  const itemMasterInputRef = useRef<HTMLInputElement>(null);
  const [itemMasterReading, setItemMasterReading] = useState(false);
  const [itemMasterPreview, setItemMasterPreview] = useState<ItemMasterPreview | null>(null);
  const [itemMasterApplying, setItemMasterApplying] = useState(false);
  const [applyProgress, setApplyProgress] = useState<Progress | null>(null);

  async function handleItemMasterFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.currentTarget.files?.[0];
    event.currentTarget.value = "";
    if (!file) return;
    setItemMasterReading(true);
    setItemMasterPreview(null);
    try {
      const rows = await readItemMasterFile(file);
      const result = parseItemMasterRows(rows);
      setItemMasterPreview({
        fileName: file.name,
        items: result.items,
        rejectedRows: result.rejectedRows,
        error: result.error,
      });
    } catch (caught) {
      setItemMasterPreview({
        fileName: file.name,
        items: [],
        rejectedRows: [],
        error: caught instanceof Error ? caught.message : "Could not read that file.",
      });
    } finally {
      setItemMasterReading(false);
    }
  }

  async function applyItemMaster() {
    if (!itemMasterPreview || itemMasterPreview.error || itemMasterPreview.items.length === 0 || itemMasterApplying) {
      return;
    }
    setItemMasterApplying(true);
    setApplyProgress({ done: 0, total: itemMasterPreview.items.length });
    try {
      const { added, updated } = await upsertItemMaster(workspaceId, itemMasterPreview.items, (done, total) =>
        setApplyProgress({ done, total }),
      );
      notify({ title: "Item master updated", body: `${added} added, ${updated} updated.`, tone: "success" });
      setItemMasterPreview(null);
    } catch (caught) {
      notify({
        title: "Item master import failed",
        body: caught instanceof Error ? caught.message : "Could not save the item master.",
        tone: "danger",
      });
    } finally {
      setItemMasterApplying(false);
      setApplyProgress(null);
    }
  }

  // ── workbook import ──────────────────────────────────────────────────────
  const workbookInputRef = useRef<HTMLInputElement>(null);
  const [workbookReading, setWorkbookReading] = useState(false);
  const [workbookError, setWorkbookError] = useState("");
  const [parsedSheets, setParsedSheets] = useState<ParsedSheetDraft[]>([]);
  const [skippedSheets, setSkippedSheets] = useState<SkippedSheet[]>([]);
  const [expandedWarnings, setExpandedWarnings] = useState<ReadonlySet<string>>(new Set());
  const [importing, setImporting] = useState(false);
  const [importProgress, setImportProgress] = useState<Progress | null>(null);

  async function handleWorkbookFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.currentTarget.files?.[0];
    event.currentTarget.value = "";
    if (!file) return;
    setWorkbookReading(true);
    setWorkbookError("");
    setParsedSheets([]);
    setSkippedSheets([]);
    setExpandedWarnings(new Set());
    try {
      const { sheets } = await readWorkbookFile(file);
      const parsed: ParsedSheetDraft[] = [];
      const skipped: SkippedSheet[] = [];
      for (const sheet of sheets) {
        const result = parseTemplateSheet(sheet.name, sheet.rows);
        if (!result) {
          skipped.push({ sheetName: sheet.name, reason: "No work-order item table found on this sheet." });
          continue;
        }
        parsed.push({
          sheetName: result.sheetName,
          templateName: result.templateName,
          customer: result.customer,
          model: result.model,
          orderType: result.orderType,
          notes: result.notes,
          lines: result.lines,
          warnings: result.warnings,
        });
      }
      setParsedSheets(parsed);
      setSkippedSheets(skipped);
      if (parsed.length === 0 && skipped.length === 0) {
        setWorkbookError("That workbook has no sheets.");
      }
    } catch (caught) {
      setWorkbookError(caught instanceof Error ? caught.message : "Could not read that workbook.");
    } finally {
      setWorkbookReading(false);
    }
  }

  function updateParsedSheet(
    sheetName: string,
    patch: Partial<Pick<ParsedSheetDraft, "customer" | "model" | "orderType">>,
  ) {
    setParsedSheets((current) =>
      current.map((sheet) => (sheet.sheetName === sheetName ? { ...sheet, ...patch } : sheet)),
    );
  }

  function toggleWarnings(sheetName: string) {
    setExpandedWarnings((current) => {
      const next = new Set(current);
      if (next.has(sheetName)) {
        next.delete(sheetName);
      } else {
        next.add(sheetName);
      }
      return next;
    });
  }

  async function handleImportTemplates() {
    if (parsedSheets.length === 0 || importing) return;
    setImporting(true);
    setImportProgress({ done: 0, total: parsedSheets.length });
    try {
      const sheets = parsedSheets.map(draftToSheet);
      const { imported, failed } = await importTemplates(workspaceId, sheets, (done, total, sheetName) =>
        setImportProgress({ done, total, detail: sheetName }),
      );
      if (failed.length === 0) {
        notify({
          title: "Templates imported",
          body: `Imported ${imported} template${imported === 1 ? "" : "s"}.`,
          tone: "success",
        });
        setParsedSheets([]);
        setSkippedSheets([]);
      } else {
        notify({
          title: `Imported ${imported}, ${failed.length} failed`,
          body: failed.map((failure) => `${failure.sheetName}: ${failure.message}`).join("\n"),
          tone: "warning",
        });
        // Keep only the failed sheets in the preview so the user can retry after fixing them.
        const failedNames = new Set(failed.map((failure) => failure.sheetName));
        setParsedSheets((current) => current.filter((sheet) => failedNames.has(sheet.sheetName)));
      }
      setTemplateReloadToken((token) => token + 1);
    } catch (caught) {
      notify({
        title: "Import failed",
        body: caught instanceof Error ? caught.message : "Could not import the workbook.",
        tone: "danger",
      });
    } finally {
      setImporting(false);
      setImportProgress(null);
    }
  }

  if (!canWrite) {
    return (
      <section className="ui-panel p-5">
        <div className="ui-mono-label">Settings</div>
        <p className="ui-section-subtitle mt-2">You have read-only access to Planning.</p>
      </section>
    );
  }

  return (
    <div className="space-y-5">
      <section className="ui-panel p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="ui-setup-section-title">Item master</div>
            <p className="ui-setup-section-desc">
              Upload a Business Central item export (.xlsx, .xls, or .csv) to add or update items.
            </p>
          </div>
          <button
            type="button"
            className="ui-btn-ghost h-9 shrink-0 gap-2 px-3 disabled:cursor-not-allowed disabled:opacity-40"
            onClick={() => itemMasterInputRef.current?.click()}
            disabled={itemMasterReading}
          >
            <Upload size={14} />
            {itemMasterReading ? "Reading…" : "Upload item master"}
          </button>
        </div>
        <input
          ref={itemMasterInputRef}
          type="file"
          accept=".xlsx,.xls,.csv"
          className="hidden"
          onChange={(event) => void handleItemMasterFile(event)}
        />

        {itemMasterReading ? (
          <p className="ui-section-subtitle mt-4 flex items-center gap-2 border-t border-line pt-4 text-ink">
            <Loader2 size={13} className="animate-spin" /> Reading the file and parsing items…
          </p>
        ) : null}

        {applyProgress ? <ProgressRow label="Saving items…" progress={applyProgress} /> : null}

        {itemMasterPreview ? (
          <div className="mt-4 border-t border-line pt-4">
            {itemMasterPreview.error ? (
              <div className="ui-notice ui-notice-bad px-4 py-3 ui-section-subtitle">{itemMasterPreview.error}</div>
            ) : (
              <>
                <p className="ui-section-subtitle text-ink">
                  {itemMasterPreview.items.length} item{itemMasterPreview.items.length === 1 ? "" : "s"} parsed
                  {itemMasterPreview.rejectedRows.length > 0
                    ? ` · ${itemMasterPreview.rejectedRows.length} row${
                        itemMasterPreview.rejectedRows.length === 1 ? "" : "s"
                      } rejected (rows ${itemMasterPreview.rejectedRows.join(", ")})`
                    : ""}
                </p>

                {itemMasterPreview.items.length > 0 ? (
                  <div className="mt-3 overflow-x-auto rounded-md border border-line">
                    <table className="w-full min-w-[520px] border-collapse text-sm">
                      <thead>
                        <tr>
                          <th className="ui-mono-label whitespace-nowrap border-b border-line px-3 py-2 text-left">
                            Item no
                          </th>
                          <th className="ui-mono-label whitespace-nowrap border-b border-line px-3 py-2 text-left">
                            Description
                          </th>
                          <th className="ui-mono-label whitespace-nowrap border-b border-line px-3 py-2 text-left">
                            Vendor no
                          </th>
                        </tr>
                      </thead>
                      <tbody>
                        {itemMasterPreview.items.slice(0, 5).map((item) => (
                          <tr key={item.itemNo} className="border-b border-line/60 last:border-b-0">
                            <td className="whitespace-nowrap px-3 py-2 font-mono text-ink">{item.itemNo}</td>
                            <td className="max-w-[320px] truncate px-3 py-2 text-ink" title={item.description}>
                              {item.description}
                            </td>
                            <td className="whitespace-nowrap px-3 py-2 text-ink-secondary">{item.vendorNo ?? "—"}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : null}

                <div className="mt-3 flex justify-end">
                  <button
                    type="button"
                    className="ui-btn-primary h-9 px-4 disabled:cursor-not-allowed disabled:opacity-40"
                    disabled={itemMasterApplying || itemMasterPreview.items.length === 0}
                    onClick={() => void applyItemMaster()}
                  >
                    {itemMasterApplying ? <Loader2 size={13} className="mr-1.5 inline animate-spin" /> : null}
                    {itemMasterApplying ? "Applying…" : "Apply"}
                  </button>
                </div>
              </>
            )}
          </div>
        ) : null}
      </section>

      <section className="ui-panel p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="ui-setup-section-title">Work-order workbook import</div>
            <p className="ui-setup-section-desc">
              Upload a work-order master workbook (.xlsx or .xls); each sheet becomes a template.
            </p>
          </div>
          <button
            type="button"
            className="ui-btn-ghost h-9 shrink-0 gap-2 px-3 disabled:cursor-not-allowed disabled:opacity-40"
            onClick={() => workbookInputRef.current?.click()}
            disabled={workbookReading}
          >
            <Upload size={14} />
            {workbookReading ? "Reading…" : "Import work-order workbook"}
          </button>
        </div>
        <input
          ref={workbookInputRef}
          type="file"
          accept=".xlsx,.xls"
          className="hidden"
          onChange={(event) => void handleWorkbookFile(event)}
        />

        {workbookReading ? (
          <p className="ui-section-subtitle mt-4 flex items-center gap-2 border-t border-line pt-4 text-ink">
            <Loader2 size={13} className="animate-spin" /> Reading the workbook and parsing every sheet — this can take a
            few seconds on a large file…
          </p>
        ) : null}

        {importProgress ? <ProgressRow label="Importing templates…" progress={importProgress} /> : null}

        {workbookError ? (
          <div className="mt-4 ui-notice ui-notice-bad px-4 py-3 ui-section-subtitle">{workbookError}</div>
        ) : null}

        {parsedSheets.length > 0 ? (
          <div className="mt-4 border-t border-line pt-4">
            <p className="ui-section-subtitle text-ink">
              {parsedSheets.length} sheet{parsedSheets.length === 1 ? "" : "s"} parsed
              {skippedSheets.length > 0
                ? ` · ${skippedSheets.length} skipped`
                : ""}
            </p>
            <div className="mt-3 overflow-x-auto rounded-md border border-line">
              <table className="w-full min-w-[820px] border-collapse text-sm">
                <thead>
                  <tr>
                    <th className="ui-mono-label whitespace-nowrap border-b border-line px-3 py-2 text-left">Sheet</th>
                    <th className="ui-mono-label whitespace-nowrap border-b border-line px-3 py-2 text-left">
                      Customer
                    </th>
                    <th className="ui-mono-label whitespace-nowrap border-b border-line px-3 py-2 text-left">Model</th>
                    <th className="ui-mono-label whitespace-nowrap border-b border-line px-3 py-2 text-left">Type</th>
                    <th className="ui-mono-label whitespace-nowrap border-b border-line px-3 py-2 text-left">Lines</th>
                    <th className="ui-mono-label whitespace-nowrap border-b border-line px-3 py-2 text-left">
                      Warnings
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {parsedSheets.map((sheet) => {
                    const warningsOpen = expandedWarnings.has(sheet.sheetName);
                    return (
                      <Fragment key={sheet.sheetName}>
                        <tr className="border-b border-line/60 align-top last:border-b-0">
                          <td className="max-w-[200px] truncate px-3 py-2 font-mono text-ink" title={sheet.sheetName}>
                            {sheet.sheetName}
                          </td>
                          <td className="px-3 py-2">
                            <input
                              type="text"
                              className="ui-input"
                              value={sheet.customer}
                              onChange={(event) => updateParsedSheet(sheet.sheetName, { customer: event.target.value })}
                            />
                          </td>
                          <td className="px-3 py-2">
                            <input
                              type="text"
                              className="ui-input"
                              value={sheet.model}
                              onChange={(event) => updateParsedSheet(sheet.sheetName, { model: event.target.value })}
                            />
                          </td>
                          <td className="w-40 px-3 py-2">
                            <ThemedSelect
                              value={sheet.orderType}
                              onChange={(value) => updateParsedSheet(sheet.sheetName, { orderType: value as WorkOrderType })}
                              options={TYPE_OPTIONS}
                              ariaLabel={`Type for ${sheet.sheetName}`}
                              className="w-full"
                            />
                          </td>
                          <td className="whitespace-nowrap px-3 py-2 text-ink-secondary">{sheet.lines.length}</td>
                          <td className="whitespace-nowrap px-3 py-2">
                            {sheet.warnings.length === 0 ? (
                              <span className="text-ink-tertiary">—</span>
                            ) : (
                              <button
                                type="button"
                                className="ui-btn-ghost inline-flex h-7 items-center gap-1 px-2 text-xs"
                                onClick={() => toggleWarnings(sheet.sheetName)}
                              >
                                {warningsOpen ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
                                {sheet.warnings.length} warning{sheet.warnings.length === 1 ? "" : "s"}
                              </button>
                            )}
                          </td>
                        </tr>
                        {warningsOpen ? (
                          <tr className="border-b border-line/60 last:border-b-0">
                            <td colSpan={6} className="bg-surface-muted px-3 py-2">
                              <ul className="list-disc space-y-0.5 pl-4 text-xs text-ink-secondary">
                                {sheet.warnings.map((warning, index) => (
                                  <li key={index}>{warning}</li>
                                ))}
                              </ul>
                            </td>
                          </tr>
                        ) : null}
                      </Fragment>
                    );
                  })}
                </tbody>
              </table>
            </div>

            <div className="mt-3 flex justify-end">
              <button
                type="button"
                className="ui-btn-primary h-9 px-4 disabled:cursor-not-allowed disabled:opacity-40"
                disabled={importing}
                onClick={() => void handleImportTemplates()}
              >
                {importing ? <Loader2 size={13} className="mr-1.5 inline animate-spin" /> : null}
                {importing ? "Importing…" : `Import ${parsedSheets.length} template${parsedSheets.length === 1 ? "" : "s"}`}
              </button>
            </div>
          </div>
        ) : null}

        {skippedSheets.length > 0 ? (
          <div className="mt-4 border-t border-line pt-4">
            <div className="ui-mono-label text-ink-tertiary">Skipped ({skippedSheets.length})</div>
            <ul className="mt-2 space-y-1 text-xs text-ink-secondary">
              {skippedSheets.map((sheet) => (
                <li key={sheet.sheetName} className="flex items-baseline gap-2">
                  <span className="font-mono text-ink">{sheet.sheetName}</span>
                  <span className="text-ink-tertiary">{sheet.reason}</span>
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </section>

      <TemplateLibrary reloadToken={templateReloadToken} onNotify={notify} />

      <ThemedFeedbackLayer
        toasts={toasts}
        onDismissToast={dismissToast}
        onCancelConfirm={() => undefined}
        onConfirm={() => undefined}
      />
    </div>
  );
}
