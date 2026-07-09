"use client";

import { Loader2, Upload } from "lucide-react";
import { useEffect, useRef, useState, type ChangeEvent } from "react";
import { ThemedFeedbackLayer, type FeedbackToast } from "@/components/themed-feedback";
import type { ParsedItemMasterRow } from "@/lib/planning/parse-item-master";
import { parseItemMasterRows } from "@/lib/planning/parse-item-master";
import { readItemMasterFile } from "@/lib/planning/read-files";
import { upsertItemMaster } from "@/lib/planning/store";
import { usePlanningWorkspace } from "./planning-workspace-provider";
import { TrailerConfigsSettings } from "./trailer-configs-settings";

/** Monotonic id source for locally-created toasts -- module-scoped like line-workspace.tsx's toast counter. */
let toastSeq = 0;

type ItemMasterPreview = {
  fileName: string;
  items: ParsedItemMasterRow[];
  rejectedRows: number[];
  error: string | null;
};

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

/**
 * Settings for Planning: Business Central item master + trailer supermarket configs.
 * MTS Excel workbook → "work order template" import was removed — those sheets were layout
 * clones with hand-typed BOMs, not catalog source of truth. Print layout lives in the app.
 */
export function PlanningSettings() {
  const { workspaceId, canWrite } = usePlanningWorkspace();
  const [toasts, setToasts] = useState<FeedbackToast[]>([]);
  const rootRef = useRef<HTMLDivElement>(null);

  // The section mounts at the top of the board page; scroll it into view so opening
  // the gear never appears to do nothing when the user is scrolled down the table.
  useEffect(() => {
    rootRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, []);

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

  if (!canWrite) {
    return (
      <section className="ui-panel p-5">
        <div className="ui-mono-label">Settings</div>
        <p className="ui-section-subtitle mt-2">You have read-only access to Planning.</p>
      </section>
    );
  }

  return (
    <div ref={rootRef} className="scroll-mt-4 space-y-5">
      <section className="ui-panel p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="ui-setup-section-title">Item master</div>
            <p className="ui-setup-section-desc">
              Upload a Business Central item export (.xlsx, .xls, or .csv). Used for item-number autocomplete
              and descriptions when building work-order lines.
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

      <TrailerConfigsSettings onNotify={notify} />

      <ThemedFeedbackLayer
        toasts={toasts}
        onDismissToast={dismissToast}
        onCancelConfirm={() => undefined}
        onConfirm={() => undefined}
      />
    </div>
  );
}
