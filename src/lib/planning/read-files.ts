/**
 * Browser file readers for the planning workbook/item-master imports. Thin async I/O shims --
 * the parsing logic (parseTemplateSheet / parseItemMasterRows) is pure and tested separately, so
 * these are intentionally untested.
 *
 * `read-excel-file` is lazy-imported so it only ships to the browser bundle when a user actually
 * uploads a file, mirroring `src/lib/parse-bom.ts`.
 *
 * NOTE on the installed API shape (read-excel-file ^9.0.10): the package's `readSheetNames()`
 * helper was removed back in its 8.0.0 release. In this version the DEFAULT export
 * (`readXlsxFile`) reads every sheet in one call and returns `{ sheet: string; data: Row[] }[]`,
 * which already gives sheet names + cell matrices together -- no separate name lookup needed.
 * The named `readSheet` export reads a single sheet's rows (defaults to the first sheet), which
 * is what `src/lib/parse-bom.ts` already uses for the single-sheet BOM import.
 */
import type { WorkbookCell } from "./parse-workbook";

type RawRow = WorkbookCell[];

/**
 * Minimal RFC-4180-ish CSV parser: handles quoted fields, escaped quotes, and newlines inside
 * quotes. Copied from `src/lib/parse-bom.ts` (not exported there) -- keep the two in sync.
 */
function parseCsv(text: string): RawRow[] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;
  const normalized = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n");

  for (let i = 0; i < normalized.length; i += 1) {
    const char = normalized[i];

    if (inQuotes) {
      if (char === '"') {
        if (normalized[i + 1] === '"') {
          field += '"';
          i += 1;
        } else {
          inQuotes = false;
        }
      } else {
        field += char;
      }
      continue;
    }

    if (char === '"' && field === "") {
      // A quote only opens a quoted field at the field's start; a bare quote anywhere else
      // (e.g. an inches mark like 5/8") is a literal character.
      inQuotes = true;
    } else if (char === ",") {
      row.push(field);
      field = "";
    } else if (char === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else {
      field += char;
    }
  }

  // Flush the trailing field/row (no terminating newline).
  if (field !== "" || row.length > 0) {
    row.push(field);
    rows.push(row);
  }

  return rows;
}

const READ_TIMEOUT_MS = 45_000;

/**
 * The excel reader's unzip step runs in a Web Worker; if the environment blocks the worker
 * (e.g. a CSP without `worker-src blob:`), its callback never fires and the promise never
 * settles. Racing a timeout turns that silent stall into an actionable error.
 */
async function withReadTimeout<T>(read: Promise<T>, fileName: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(
      () =>
        reject(
          new Error(
            `Reading “${fileName}” timed out. If this keeps happening, check the browser console for a blocked-worker (Content-Security-Policy) error and report it.`,
          ),
        ),
      READ_TIMEOUT_MS,
    );
  });
  try {
    return await Promise.race([read, timeout]);
  } finally {
    clearTimeout(timer);
  }
}

/** Read every sheet of an uploaded .xlsx/.xls workbook into cell matrices, keyed by sheet name. */
export async function readWorkbookFile(file: File): Promise<{ sheets: Array<{ name: string; rows: WorkbookCell[][] }> }> {
  const { default: readXlsxFile } = await import("read-excel-file/browser");
  const sheets = await withReadTimeout(readXlsxFile(file), file.name);
  return {
    sheets: sheets.map((sheet) => ({ name: sheet.sheet, rows: sheet.data as WorkbookCell[][] })),
  };
}

/** Read an uploaded item-master export (.xlsx/.xls/.csv) into a single cell matrix. */
export async function readItemMasterFile(file: File): Promise<WorkbookCell[][]> {
  const isCsv = /\.csv$/i.test(file.name);
  if (isCsv) {
    const text = await file.text();
    return parseCsv(text);
  }

  const { readSheet } = await import("read-excel-file/browser");
  const rows = await withReadTimeout(readSheet(file), file.name);
  return rows as WorkbookCell[][];
}
