// The copy-paste column handed back to the production schedule. Pure, no I/O.
// Phase three of three: `schedule-row.ts` parses the sheet, `schedule-resolve.ts` decides what
// to build, this decides what goes back INTO the sheet.
//
// Built by walking the import's ROW RANGE -- never by listing created orders. A skipped divider
// row or a flagged line then leaves a BLANK CELL rather than shifting every id below it up one
// row. Both constructions produce identical output on a clean import and diverge exactly when
// something was skipped, which is precisely when a silent misalignment would cost a month of
// mismatched work-order ids.

export interface ExportRow {
  /** 1-based row in the source spreadsheet. */
  sourceRowNo: number;
  /** The approved GEN order number, or null/"" when the row has no approved order yet. */
  orderNo: string | null;
}

export interface RowRange {
  first: number;
  last: number;
}

export interface ExportColumn {
  /** One cell per row in the range, in row order. Empty string = nothing to paste. */
  cells: readonly string[];
  /** How many cells carry an order number. */
  filled: number;
  /** Cell count — always `last - first + 1` for a valid range. */
  total: number;
}

/**
 * Build the column for one import.
 *
 * `range` is an explicit argument rather than inferred from `rows` on purpose: inferring it
 * would make the empty-tail case invisible, and "rows 4–215 produce exactly 212 cells" would
 * stop being assertable without a row actually being present at 215.
 *
 * Rows outside the range are ignored, a duplicated `sourceRowNo` keeps its FIRST entry, and an
 * inverted range yields an empty column instead of throwing.
 */
export function buildExportColumn(rows: readonly ExportRow[], range: RowRange): ExportColumn {
  if (range.last < range.first) {
    return { cells: [], filled: 0, total: 0 };
  }

  // `seen` is tracked separately from `byRow` so the first entry for a row wins even when that
  // entry is unapproved — otherwise a duplicated row whose first record has no order number
  // would silently adopt a later duplicate's number and paste an id onto the wrong unit.
  const seen = new Set<number>();
  const byRow = new Map<number, string>();
  for (const row of rows) {
    if (row.sourceRowNo < range.first || row.sourceRowNo > range.last) continue;
    if (seen.has(row.sourceRowNo)) continue;
    seen.add(row.sourceRowNo);
    if (row.orderNo) byRow.set(row.sourceRowNo, row.orderNo);
  }

  const cells: string[] = [];
  for (let rowNo = range.first; rowNo <= range.last; rowNo += 1) {
    cells.push(byRow.get(rowNo) ?? "");
  }

  return { cells, filled: byRow.size, total: cells.length };
}

/**
 * Newline-joined, so a single clipboard paste fills one spreadsheet column. Trailing blanks are
 * preserved as newlines: the pasted block must keep the same height as the range it came from.
 */
export function exportColumnText(column: ExportColumn): string {
  return column.cells.join("\n");
}
