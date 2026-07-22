// The copy-paste column handed back to the production schedule. Pure, no I/O.
// Phase three of three: `schedule-row.ts` parses the sheet, `schedule-resolve.ts` decides what
// to build, this decides what goes back INTO the sheet.
//
// Built by walking the import's ROW RANGE -- never by listing created orders. A skipped divider
// row or a flagged line then leaves a BLANK CELL rather than shifting every id below it up one
// row. Both constructions produce identical output on a clean import and diverge exactly when
// something was skipped, which is precisely when a silent misalignment would cost a month of
// mismatched work-order ids.
//
// Every defence in this file exists because the failure mode is SILENT: a column that is one
// row short still pastes, still looks plausible, and mislabels every unit below the gap.

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
  /** How many cells carry an order number. Derived from `cells`, never counted separately. */
  filled: number;
  /** Cell count — always `last - first + 1` for a valid range. */
  total: number;
}

/**
 * Upper bound on a single export. A real monthly schedule is a few hundred rows; a full-column
 * Excel selection would be 1,048,576. Beyond this the range is treated as invalid rather than
 * allocating a million-cell array and a multi-megabyte clipboard string.
 */
export const MAX_EXPORT_ROWS = 20_000;

const EMPTY: ExportColumn = { cells: [], filled: 0, total: 0 };

/**
 * Collapse anything that would break the one-cell-per-line contract.
 *
 * A newline inside an order number turns one cell into two and shifts every row below it down;
 * a tab spills into the neighbouring schedule column. `work_orders.order_no` is free text —
 * grandfathered and hand-edited values carry no format guarantee — so this is reachable, and a
 * corrupted paste is invisible until someone builds the wrong unit.
 */
function sanitizeOrderNo(orderNo: string): string {
  return orderNo.replace(/[\r\n\t]+/g, " ").trim();
}

/** A row number must be a whole number to address a spreadsheet row at all. */
function isRowNumber(value: number): boolean {
  return Number.isInteger(value);
}

/**
 * Build the column for one import.
 *
 * `range` is an explicit argument rather than inferred from `rows` on purpose: inferring it
 * would make the empty-tail case invisible, and "rows 4–215 produce exactly 212 cells" would
 * stop being assertable without a row actually being present at 215.
 *
 * Returns an empty column — rather than throwing or looping — for any range that cannot
 * describe a real block of spreadsheet rows: inverted, non-integer (a bad `parseInt` upstream
 * yields NaN), or larger than `MAX_EXPORT_ROWS`. An empty column surfaces as "0 of 0 rows" in
 * the UI, which reads as obviously wrong; a partially-built one would not.
 *
 * Rows outside the range are ignored, non-integer row numbers are skipped, and a duplicated
 * `sourceRowNo` keeps its FIRST entry.
 */
export function buildExportColumn(rows: readonly ExportRow[], range: RowRange): ExportColumn {
  if (!isRowNumber(range.first) || !isRowNumber(range.last)) {
    return EMPTY;
  }
  if (range.last < range.first) {
    return EMPTY;
  }
  if (range.last - range.first + 1 > MAX_EXPORT_ROWS) {
    return EMPTY;
  }

  // `seen` is tracked separately from `byRow` so the first entry for a row wins even when that
  // entry is unapproved — otherwise a duplicated row whose first record has no order number
  // would silently adopt a later duplicate's number and paste an id onto the wrong unit.
  const seen = new Set<number>();
  const byRow = new Map<number, string>();
  for (const row of rows) {
    if (!isRowNumber(row.sourceRowNo)) continue;
    if (row.sourceRowNo < range.first || row.sourceRowNo > range.last) continue;
    if (seen.has(row.sourceRowNo)) continue;
    seen.add(row.sourceRowNo);

    const orderNo = sanitizeOrderNo(row.orderNo ?? "");
    if (orderNo) byRow.set(row.sourceRowNo, orderNo);
  }

  const cells: string[] = [];
  for (let rowNo = range.first; rowNo <= range.last; rowNo += 1) {
    cells.push(byRow.get(rowNo) ?? "");
  }

  // Derived from the emitted cells so `filled` cannot structurally disagree with what the user
  // is about to paste — counting matches separately is how "1 of 2 approved" ends up printed
  // over an all-blank column.
  return { cells, filled: cells.filter((cell) => cell !== "").length, total: cells.length };
}

/**
 * Newline-joined, so a single clipboard paste fills one spreadsheet column. Trailing blanks are
 * preserved as newlines: the pasted block must keep the same height as the range it came from.
 */
export function exportColumnText(column: ExportColumn): string {
  return column.cells.join("\n");
}
