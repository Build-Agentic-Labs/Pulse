"use client";

import { AlertTriangle, ArrowLeft, FileSpreadsheet, Loader2, Upload } from "lucide-react";
import Link from "next/link";
import { useMemo, useRef, useState, type ChangeEvent } from "react";
import { ThemedSelect, type ThemedSelectOption } from "@/components/themed-select";
import {
  detectColumnMapping,
  detectHeaderRow,
  SCHEDULE_FIELD_LABELS,
  SCHEDULE_FIELDS,
  type ColumnMapping,
} from "@/domain/planning/schedule-columns";
import { buildSchedulePreview, groupPreviewFlags } from "@/domain/planning/schedule-preview";
import type { ConfigIndex } from "@/domain/planning/schedule-resolve";
import { loadConfigIndex } from "@/lib/planning/config-store";
import { importSchedule, type ResolvedScheduleRow } from "@/lib/planning/sales-order-store";
import type { WorkbookCell } from "@/lib/planning/parse-workbook";
import { readWorkbookFile } from "@/lib/planning/read-files";

/**
 * Upload a monthly production schedule: pick file → pick sheet → CONFIRM the column mapping →
 * dry-run preview → import. Nothing is written until the planner confirms the preview, and the
 * write happens in this event handler — never during a render.
 */

type Stage = "idle" | "sheet" | "map" | "preview" | "importing" | "done";

type SheetData = { name: string; rows: WorkbookCell[][] };

function cellText(cell: WorkbookCell | undefined): string {
  if (cell === null || cell === undefined) return "";
  if (cell instanceof Date) return cell.toISOString().slice(0, 10);
  return String(cell).replace(/\s+/g, " ").trim();
}

export function ScheduleUpload({
  workspaceId,
  canWrite,
  onImported,
  onCancel,
}: {
  workspaceId: string;
  canWrite: boolean;
  onImported: (importId: string) => void;
  onCancel: () => void;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [stage, setStage] = useState<Stage>("idle");
  const [error, setError] = useState("");
  const [fileName, setFileName] = useState("");
  const [sheets, setSheets] = useState<SheetData[]>([]);
  const [sheetName, setSheetName] = useState("");
  const [headerRowIndex, setHeaderRowIndex] = useState(-1);
  const [mapping, setMapping] = useState<ColumnMapping | null>(null);
  const [configIndex, setConfigIndex] = useState<ConfigIndex | null>(null);

  const sheet = sheets.find((candidate) => candidate.name === sheetName) ?? null;
  const headerRow = sheet && headerRowIndex >= 0 ? sheet.rows[headerRowIndex] : null;

  async function onPickFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    setError("");
    setFileName(file.name);
    try {
      const [workbook, index] = await Promise.all([readWorkbookFile(file), loadConfigIndex(workspaceId)]);
      setSheets(workbook.sheets);
      setConfigIndex(index);
      const first = workbook.sheets[0];
      if (workbook.sheets.length === 1 && first) {
        selectSheet(first);
      } else {
        setStage("sheet");
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not read that workbook.");
      setStage("idle");
    } finally {
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  function selectSheet(next: SheetData) {
    setSheetName(next.name);
    const detected = detectHeaderRow(next.rows);
    setHeaderRowIndex(detected);
    setMapping(detected >= 0 ? detectColumnMapping(next.rows[detected] ?? []) : blankMapping());
    setStage("map");
  }

  /**
   * The dry run. All of the row-walking and resolution lives in `buildSchedulePreview` — a pure
   * domain function with its own tests — because a one-row error here misaligns a whole month,
   * and that is not something to leave untestable inside a component.
   */
  const preview = useMemo(() => {
    if (stage !== "preview" && stage !== "importing" && stage !== "done") return null;
    if (!sheet || !mapping || !configIndex || headerRowIndex < 0) return null;

    const built = buildSchedulePreview(sheet.rows, headerRowIndex, mapping, configIndex);
    return {
      ...built,
      flagGroups: groupPreviewFlags(built.rows),
      resolvedRows: built.rows.map<ResolvedScheduleRow>((row) => ({
        sourceRowNo: row.sourceRowNo,
        so: row.resolution.so,
        customer: row.resolution.customer,
        fgSku: row.resolution.fgSku,
        accSku: row.resolution.accSku,
        trailerLetter: row.resolution.trailerLetter,
        model: row.resolution.model,
        assemblyOrderNo: row.resolution.assemblyOrderNo,
        status: row.resolution.status,
        flags: row.resolution.flags,
      })),
    };
  }, [stage, sheet, mapping, configIndex, headerRowIndex]);

  async function runImport() {
    if (!preview || !sheet) return;
    setStage("importing");
    setError("");
    try {
      const result = await importSchedule(workspaceId, {
        fileName,
        sheetName: sheet.name,
        firstRowNo: preview.firstRowNo,
        lastRowNo: preview.lastRowNo,
        rowCount: preview.rows.length + preview.dividerRows,
        rows: preview.resolvedRows,
      });
      setStage("done");
      onImported(result.importId);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not import the schedule.");
      setStage("preview");
    }
  }

  const mappedCount = mapping ? SCHEDULE_FIELDS.filter((field) => mapping[field] !== null).length : 0;
  const canPreview = mapping !== null && mapping.model !== null && mapping.fgSku !== null;

  return (
    <section className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <button type="button" className="ui-btn-ghost inline-flex h-8 items-center gap-1.5 px-2 text-[12px]" onClick={onCancel}>
          <ArrowLeft size={14} strokeWidth={1.75} />
          Back
        </button>
        <span className="ui-mono-label text-ink-secondary">Upload production schedule</span>
      </div>

      {error ? (
        <div className="ui-panel border-danger/40 p-4 text-sm text-danger">{error}</div>
      ) : null}

      {stage === "idle" ? (
        <section className="ui-panel p-5">
          <div className="ui-mono-label">Choose a workbook</div>
          <p className="mt-2 text-sm text-ink-secondary">
            An .xlsx production schedule. Every sheet is read at once so you can pick which one holds
            the units.
          </p>
          <input
            ref={fileRef}
            type="file"
            accept=".xlsx,.xls"
            className="hidden"
            onChange={(event) => void onPickFile(event)}
          />
          <button
            type="button"
            className="ui-btn-primary mt-4 inline-flex h-9 items-center gap-2 px-3 text-[12px] disabled:opacity-50"
            disabled={!canWrite}
            onClick={() => fileRef.current?.click()}
          >
            <Upload size={14} strokeWidth={1.75} />
            Select file
          </button>
        </section>
      ) : null}

      {stage === "sheet" ? (
        <section className="ui-panel p-5">
          <div className="ui-mono-label">Which sheet?</div>
          <p className="mt-2 text-sm text-ink-secondary">{fileName}</p>
          <ul className="mt-3 space-y-1.5">
            {sheets.map((candidate) => (
              <li key={candidate.name}>
                <button
                  type="button"
                  className="ui-btn-ghost flex w-full items-center gap-2 px-3 py-2 text-left text-[13px]"
                  onClick={() => selectSheet(candidate)}
                >
                  <FileSpreadsheet size={14} strokeWidth={1.75} className="text-ink-tertiary" />
                  <span className="text-ink">{candidate.name}</span>
                  <span className="ml-auto text-[12px] text-ink-tertiary">{candidate.rows.length} rows</span>
                </button>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {stage === "map" && mapping ? (
        <section className="ui-panel space-y-4 p-5">
          <div>
            <div className="ui-mono-label">Confirm the columns</div>
            <p className="mt-2 text-sm text-ink-secondary">
              {fileName} · {sheetName} ·{" "}
              {headerRowIndex >= 0 ? `header detected on row ${headerRowIndex + 1}` : "no header row detected"} ·{" "}
              {mappedCount} of {SCHEDULE_FIELDS.length} fields matched
            </p>
            <p className="mt-2 flex items-start gap-2 text-[12px] text-ink-tertiary">
              <AlertTriangle size={13} strokeWidth={1.75} className="mt-0.5 shrink-0" />
              <span>
                Check these before importing. A renamed header would otherwise load the whole month into
                the wrong fields — and every value would still look plausible.
              </span>
            </p>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            {SCHEDULE_FIELDS.map((field) => (
              <div key={field} className="space-y-1.5">
                <span className="ui-mono-label">{SCHEDULE_FIELD_LABELS[field]}</span>
                <ThemedSelect
                  value={mapping[field] === null ? "" : String(mapping[field])}
                  options={columnOptions(headerRow)}
                  ariaLabel={`Column for ${SCHEDULE_FIELD_LABELS[field]}`}
                  onChange={(value) =>
                    setMapping({ ...mapping, [field]: value === "" ? null : Number(value) })
                  }
                />
              </div>
            ))}
          </div>

          <div className="flex items-center gap-3">
            <button
              type="button"
              className="ui-btn-primary h-9 px-3 text-[12px] disabled:opacity-50"
              disabled={!canPreview}
              onClick={() => setStage("preview")}
            >
              Preview import
            </button>
            {!canPreview ? (
              <span className="text-[12px] text-ink-tertiary">Model type and FG SKU are required.</span>
            ) : null}
          </div>
        </section>
      ) : null}

      {(stage === "preview" || stage === "importing" || stage === "done") && preview ? (
        <section className="ui-panel space-y-4 p-5">
          <div>
            <div className="ui-mono-label">Dry run — nothing written yet</div>
            <p className="mt-2 text-sm text-ink-secondary">
              {fileName} · {sheetName} · rows {preview.firstRowNo}–{preview.lastRowNo}
            </p>
          </div>

          <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Stat label="Rows read" value={preview.rows.length + preview.dividerRows} />
            <Stat label="Divider rows skipped" value={preview.dividerRows} />
            <Stat label="Resolved" value={preview.resolvedCount} />
            <Stat label="Flagged" value={preview.flaggedCount} tone={preview.flaggedCount > 0 ? "danger" : undefined} />
          </dl>

          {preview.flagGroups.length > 0 ? (
            <div className="space-y-2">
              <div className="ui-mono-label">Flags</div>
              <ul className="space-y-1.5">
                {preview.flagGroups.map((group) => (
                  <li key={group.code} className="flex items-start gap-2 text-[13px]">
                    <span className={`font-mono text-[11px] ${group.blocking ? "text-danger" : "text-ink-tertiary"}`}>
                      {group.count}×
                    </span>
                    <span className="text-ink-secondary">
                      <span className="text-ink">{group.code}</span> — {group.example}
                      {group.blocking ? (
                        <>
                          {" "}
                          <Link href="/planning/configuration" className="underline underline-offset-2">
                            configure it
                          </Link>
                        </>
                      ) : null}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          <div className="flex items-center gap-3">
            <button
              type="button"
              className="ui-btn-primary inline-flex h-9 items-center gap-2 px-3 text-[12px] disabled:opacity-50"
              disabled={stage !== "preview" || !canWrite || preview.rows.length === 0}
              onClick={() => void runImport()}
            >
              {stage === "importing" ? <Loader2 size={13} className="animate-spin" /> : null}
              Import {preview.rows.length} {preview.rows.length === 1 ? "line" : "lines"}
            </button>
            <button type="button" className="ui-btn-ghost h-9 px-3 text-[12px]" onClick={() => setStage("map")}>
              Back to columns
            </button>
          </div>
        </section>
      ) : null}
    </section>
  );
}

function Stat({ label, value, tone }: { label: string; value: number; tone?: "danger" }) {
  return (
    <div>
      <dt className="ui-mono-label text-ink-tertiary">{label}</dt>
      <dd className={`mt-1 text-[18px] ${tone === "danger" ? "text-danger" : "text-ink"}`}>{value}</dd>
    </div>
  );
}

function blankMapping(): ColumnMapping {
  return Object.fromEntries(SCHEDULE_FIELDS.map((field) => [field, null])) as ColumnMapping;
}

function columnOptions(headerRow: readonly WorkbookCell[] | null): ThemedSelectOption[] {
  const options: ThemedSelectOption[] = [{ value: "", label: "Not in this sheet" }];
  (headerRow ?? []).forEach((cell, index) => {
    const text = cellText(cell);
    options.push({ value: String(index), label: text ? `${columnLetter(index)} — ${text}` : columnLetter(index) });
  });
  return options;
}

/** 0 → A, 25 → Z, 26 → AA. Spreadsheet column letters, so the mapping reads like the sheet. */
function columnLetter(index: number): string {
  let n = index;
  let letters = "";
  do {
    letters = String.fromCharCode(65 + (n % 26)) + letters;
    n = Math.floor(n / 26) - 1;
  } while (n >= 0);
  return letters;
}
