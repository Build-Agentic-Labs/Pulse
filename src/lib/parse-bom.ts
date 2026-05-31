import type { MasterBom } from "@/domain/master-bom";

type RawRow = Array<string | number | boolean | Date | null | undefined>;

function cellToString(value: string | number | boolean | Date | null | undefined): string {
  if (value == null) {
    return "";
  }
  if (value instanceof Date) {
    return value.toISOString().slice(0, 10);
  }
  return String(value).trim();
}

/** Turn the first row into unique, non-empty column names. */
function normalizeHeaders(headerRow: RawRow): string[] {
  const seen = new Map<string, number>();
  return headerRow.map((cell, index) => {
    let name = cellToString(cell);
    if (!name) {
      name = `Column ${index + 1}`;
    }
    const count = seen.get(name) ?? 0;
    seen.set(name, count + 1);
    return count === 0 ? name : `${name} (${count + 1})`;
  });
}

function rowsToMasterBom(matrix: RawRow[], fileName: string): MasterBom {
  const nonEmpty = matrix.filter((row) => row.some((cell) => cellToString(cell) !== ""));
  if (nonEmpty.length === 0) {
    return { fileName, uploadedAt: new Date().toISOString(), columns: [], rows: [] };
  }

  const columns = normalizeHeaders(nonEmpty[0]);
  const rows = nonEmpty.slice(1).map((row) =>
    columns.reduce<Record<string, string>>((accumulator, column, index) => {
      accumulator[column] = cellToString(row[index]);
      return accumulator;
    }, {}),
  );

  return { fileName, uploadedAt: new Date().toISOString(), columns, rows };
}

/** Minimal RFC-4180-ish CSV parser: handles quoted fields, escaped quotes, and newlines inside quotes. */
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

    if (char === '"') {
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

/** Parse an uploaded .xlsx/.xls/.csv file into a normalized master BOM (all columns kept). */
export async function parseBomFile(file: File): Promise<MasterBom> {
  const name = file.name;
  const isCsv = /\.csv$/i.test(name);

  if (isCsv) {
    const text = await file.text();
    return rowsToMasterBom(parseCsv(text), name);
  }

  // Lazy-load the browser Excel reader so it only ships when a user actually uploads.
  // `readSheet` returns a single sheet's rows as an array of cell arrays.
  const { readSheet } = await import("read-excel-file/browser");
  const matrix = (await readSheet(file)) as unknown as RawRow[];
  return rowsToMasterBom(matrix, name);
}
