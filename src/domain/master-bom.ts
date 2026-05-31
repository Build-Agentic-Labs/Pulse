// A product-level "master BOM": an uploaded bill of materials (xlsx/csv) that is
// stored verbatim (all columns) and later feeds the part picker when assigning
// parts to a work instruction. Persisted on `product.customFields`.

export const PRODUCT_MASTER_BOM_FIELD = "masterBom";

export interface MasterBom {
  fileName?: string;
  uploadedAt?: string; // ISO timestamp
  columns: string[]; // header names, in upload order
  rows: Array<Record<string, string>>; // each row: column name -> cell text
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

/** Read + validate a master BOM out of `product.customFields`. Returns undefined when none is stored. */
export function getMasterBom(customFields?: Record<string, unknown>): MasterBom | undefined {
  const raw = customFields?.[PRODUCT_MASTER_BOM_FIELD];
  if (!isRecord(raw)) {
    return undefined;
  }

  const columns = Array.isArray(raw.columns)
    ? raw.columns.filter((column): column is string => typeof column === "string")
    : [];
  if (columns.length === 0) {
    return undefined;
  }

  const rows = Array.isArray(raw.rows)
    ? raw.rows
        .filter(isRecord)
        .map((row) =>
          columns.reduce<Record<string, string>>((accumulator, column) => {
            const value = row[column];
            accumulator[column] = value == null ? "" : String(value);
            return accumulator;
          }, {}),
        )
    : [];

  return {
    fileName: typeof raw.fileName === "string" ? raw.fileName : undefined,
    uploadedAt: typeof raw.uploadedAt === "string" ? raw.uploadedAt : undefined,
    columns,
    rows,
  };
}

/** Produce a plain-JSON copy safe to persist on customFields. */
export function serializeMasterBom(bom: MasterBom): MasterBom {
  return {
    fileName: bom.fileName,
    uploadedAt: bom.uploadedAt,
    columns: [...bom.columns],
    rows: bom.rows.map((row) =>
      bom.columns.reduce<Record<string, string>>((accumulator, column) => {
        accumulator[column] = row[column] ?? "";
        return accumulator;
      }, {}),
    ),
  };
}

const PART_NUMBER_HINTS = ["part number", "part no", "part #", "partno", "part", "no.", "number", "item no", "item number"];
const DESCRIPTION_HINTS = ["description", "desc", "name", "title"];
const QUANTITY_HINTS = ["quantity per", "quantity", "qty per", "qty", "count"];

function matchColumn(columns: string[], hints: string[]): string | undefined {
  const normalized = columns.map((column) => ({ column, key: column.trim().toLowerCase() }));
  // Prefer an exact hint match, then a contains match, in hint priority order.
  for (const hint of hints) {
    const exact = normalized.find((entry) => entry.key === hint);
    if (exact) {
      return exact.column;
    }
  }
  for (const hint of hints) {
    const partial = normalized.find((entry) => entry.key.includes(hint));
    if (partial) {
      return partial.column;
    }
  }
  return undefined;
}

/** Best-guess mapping of upload columns to the core part fields, used by the part picker. */
export function detectBomFieldColumns(columns: string[]) {
  return {
    partNumber: matchColumn(columns, PART_NUMBER_HINTS),
    description: matchColumn(columns, DESCRIPTION_HINTS),
    quantity: matchColumn(columns, QUANTITY_HINTS),
  };
}
