// Parses one sheet of the planner's "MTS Work Orders Master" workbook into a
// work-order template draft. Pure: takes a cell matrix, returns data + warnings.
import type { WorkOrderType } from "@/domain/work-orders";

export type WorkbookCell = string | number | boolean | Date | null;

export type ParsedTemplateLine = {
  itemNo: string;
  description: string;
  buildQty: number;
  position: number;
};

export type ParsedTemplateSheet = {
  sheetName: string;
  templateName: string;
  customer: string;
  model: string;
  orderType: WorkOrderType;
  notes: string;
  lines: ParsedTemplateLine[];
  warnings: string[];
};

const TYPE_PATTERNS: Array<[RegExp, WorkOrderType]> = [
  [/head unit/i, "head_unit"],
  [/\bacc\b|accessor/i, "accessories"],
  [/decal/i, "decal"],
  [/rework/i, "rework"],
  [/trailer/i, "trailer"],
];

function cellText(cell: WorkbookCell | undefined): string {
  if (cell === null || cell === undefined) {
    return "";
  }
  return String(cell).replace(/\s+/g, " ").trim();
}

function detectOrderType(text: string): WorkOrderType {
  for (const [pattern, type] of TYPE_PATTERNS) {
    if (pattern.test(text)) {
      return type;
    }
  }
  return "mts";
}

/**
 * Titles read like "UNITED RENTALS WORK ORDER HEAD UNIT" or "T MOBILE REWORK
 * UNIT" — the customer is everything before the marker. Best-effort: the
 * import preview lets the planner correct it per sheet.
 */
function extractCustomer(title: string): string {
  const match =
    /^(.*?)(?:\s+S-ORD\S+)?\s+(?:WORK ORDER|AO PACKAGE|REWORK|SHARE WORK ORDER|ACCESSORIES WORK ORDER|WO PACKAGE)/i.exec(
      title,
    );
  return (match ? match[1] : "").trim();
}

export function parseTemplateSheet(
  sheetName: string,
  rows: readonly (readonly WorkbookCell[])[],
): ParsedTemplateSheet | null {
  const headerRowIndex = rows.findIndex((row) =>
    row.some((cell) => cellText(cell).toUpperCase() === "ITEM NO."),
  );
  if (headerRowIndex < 0) {
    return null; // Not a template sheet (e.g. the DATA item-master export).
  }

  const headerRow = rows[headerRowIndex];
  const itemCol = headerRow.findIndex((cell) => cellText(cell).toUpperCase() === "ITEM NO.");
  const qtyCol = headerRow.findIndex((cell) => /build quantity/i.test(cellText(cell)));

  const warnings: string[] = [];
  if (qtyCol < 0) {
    warnings.push('No "Build Quantity" column found; quantities default to 1.');
  }

  const title = cellText(rows[0]?.[0]);
  const orderType = detectOrderType(`${sheetName} ${title}`);
  const customer = extractCustomer(title);

  // Model: first non-numeric single value between the title and the header row
  // (skips stray unit-count rows like a bare "7").
  let model = "";
  for (let r = 1; r < headerRowIndex; r += 1) {
    const value = cellText(rows[r]?.[0]);
    if (value !== "" && !/^\d+$/.test(value)) {
      model = value;
      break;
    }
  }

  const lines: ParsedTemplateLine[] = [];
  let notes = "";
  let r = headerRowIndex + 1;
  while (r < rows.length) {
    const row = rows[r] ?? [];
    if (cellText(row[1]) === "Notes:") {
      notes = cellText(row[3]);
      break;
    }
    const itemNo = cellText(row[itemCol]);
    if (itemNo === "") {
      r += 1;
      continue;
    }
    const description = cellText(rows[r + 1]?.[itemCol]);
    const rawQty = qtyCol >= 0 ? row[qtyCol] : null;
    const parsedQty = typeof rawQty === "number" ? rawQty : Number.parseFloat(cellText(rawQty));
    const hasQty = Number.isFinite(parsedQty) && parsedQty > 0;
    if (!hasQty) {
      warnings.push(`Line "${itemNo}": no build quantity; defaulted to 1.`);
    }
    lines.push({ itemNo, description, buildQty: hasQty ? parsedQty : 1, position: lines.length });
    r += 2; // Skip the description row.
  }

  if (lines.length === 0) {
    return null;
  }

  return {
    sheetName,
    templateName: sheetName.replace(/\s+/g, " ").trim(),
    customer,
    model,
    orderType,
    notes,
    lines,
    warnings,
  };
}
