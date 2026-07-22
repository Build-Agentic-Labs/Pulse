// Turn a sheet's cell matrix into the dry-run preview: which rows import, which are skipped,
// which are flagged, and what row range the block covers. Pure, no I/O, no React.
//
// This lives in the domain rather than the upload component because it is the step that decides
// what gets written — and because the row-range it computes is what the copy-paste column later
// walks. A one-row error here misaligns a whole month, so it must be testable in isolation.

import { isSectionHeaderRow } from "./schedule-row";
import { resolveScheduleLine, type ConfigIndex, type LineResolution } from "./schedule-resolve";
import { SCHEDULE_FIELDS, type ColumnMapping, type ScheduleField } from "./schedule-columns";

/** A cell value as the workbook reader yields it. */
export type SheetCell = string | number | boolean | Date | null | undefined;

export interface PreviewRow {
  /** 1-based spreadsheet row, as the sheet itself numbers it. */
  sourceRowNo: number;
  resolution: LineResolution;
}

export interface SchedulePreview {
  /** Importable rows, in sheet order. Divider rows are absent by design. */
  rows: PreviewRow[];
  /** Category label rows ("TRAILERS", "STOCK") skipped, never stored. */
  dividerRows: number;
  /** The 1-based block this import covers — what `buildExportColumn` walks. 0 when empty. */
  firstRowNo: number;
  lastRowNo: number;
  resolvedCount: number;
  flaggedCount: number;
}

export interface FlagGroup {
  code: string;
  count: number;
  blocking: boolean;
  /** One representative detail, so 46 identical flags read as a single line. */
  example: string;
}

function cellText(cell: SheetCell): string {
  if (cell === null || cell === undefined) return "";
  if (cell instanceof Date) return cell.toISOString().slice(0, 10);
  return String(cell).replace(/\s+/g, " ").trim();
}

/**
 * Walk the rows below the header.
 *
 * The row range spans every row that carried ANY data — including divider rows. That is
 * deliberate: the range describes the block as it sits in the spreadsheet, so the export column
 * emits a blank cell where a divider was rather than closing the gap and shifting ids upward.
 * Wholly empty trailing rows are not part of the block at all.
 */
export function buildSchedulePreview(
  rows: readonly (readonly SheetCell[])[],
  headerRowIndex: number,
  mapping: ColumnMapping,
  configIndex: ConfigIndex,
): SchedulePreview {
  const previewRows: PreviewRow[] = [];
  let dividerRows = 0;
  let firstRowNo = 0;
  let lastRowNo = 0;

  const read = (row: readonly SheetCell[], field: ScheduleField): string => {
    const column = mapping[field];
    return column === null || column === undefined ? "" : cellText(row[column]);
  };

  for (let index = headerRowIndex + 1; index < rows.length; index += 1) {
    const row = rows[index] ?? [];
    const sourceRowNo = index + 1;

    const fields = Object.fromEntries(SCHEDULE_FIELDS.map((field) => [field, read(row, field)])) as Record<
      ScheduleField,
      string
    >;

    // Emptiness is judged on the WHOLE row, not just the mapped fields. A real category divider
    // ("TRAILERS", "STOCK") carries its label in a column the mapping does not use, so testing
    // only mapped fields would classify it as blank — dropping it silently instead of counting
    // it, and under-reporting the skipped-row count the planner checks the import against.
    if (row.every((cell) => cellText(cell) === "")) {
      continue;
    }

    if (firstRowNo === 0) firstRowNo = sourceRowNo;
    lastRowNo = sourceRowNo;

    if (
      isSectionHeaderRow({
        model: fields.model,
        so: fields.so,
        customer: fields.customer,
        fgAo: fields.fgAo,
      })
    ) {
      dividerRows += 1;
      continue;
    }

    previewRows.push({ sourceRowNo, resolution: resolveScheduleLine(fields, configIndex) });
  }

  const flaggedCount = previewRows.filter((row) => row.resolution.status === "flagged").length;

  return {
    rows: previewRows,
    dividerRows,
    firstRowNo,
    lastRowNo,
    resolvedCount: previewRows.length - flaggedCount,
    flaggedCount,
  };
}

/** Collapse the preview's flags into one line per code, blocking first, then by frequency. */
export function groupPreviewFlags(rows: readonly PreviewRow[]): FlagGroup[] {
  const groups = new Map<string, { count: number; blocking: boolean; example: string }>();
  for (const row of rows) {
    for (const flag of row.resolution.flags) {
      const existing = groups.get(flag.code);
      if (existing) {
        existing.count += 1;
      } else {
        groups.set(flag.code, { count: 1, blocking: flag.blocking, example: flag.detail });
      }
    }
  }
  return [...groups.entries()]
    .map(([code, value]) => ({ code, ...value }))
    .sort((a, b) => Number(b.blocking) - Number(a.blocking) || b.count - a.count);
}
