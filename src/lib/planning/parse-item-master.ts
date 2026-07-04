// Parses a Business Central item-master export (xlsx/csv cell matrix) for the
// planning item_master table. Pure: no I/O.
import type { WorkbookCell } from "./parse-workbook";

export type ParsedItemMasterRow = {
  itemNo: string;
  description: string;
  vendorNo: string | null;
};

export type ItemMasterParseResult = {
  items: ParsedItemMasterRow[];
  rejectedRows: number[];
  error: string | null;
};

function cellText(cell: WorkbookCell | undefined): string {
  if (cell === null || cell === undefined) {
    return "";
  }
  return String(cell).replace(/\s+/g, " ").trim();
}

export function parseItemMasterRows(rows: readonly (readonly WorkbookCell[])[]): ItemMasterParseResult {
  const headerIndex = rows.findIndex((row) => {
    const texts = row.map((cell) => cellText(cell).toLowerCase());
    const hasNo = texts.some((text) => text === "no." || text === "no" || text === "item no.");
    const hasDescription = texts.some((text) => text.startsWith("description"));
    return hasNo && hasDescription;
  });
  if (headerIndex < 0) {
    return { items: [], rejectedRows: [], error: 'No header row with "No." and "Description" columns found.' };
  }

  const headerTexts = rows[headerIndex].map((cell) => cellText(cell).toLowerCase());
  const itemCol = headerTexts.findIndex((text) => text === "no." || text === "no" || text === "item no.");
  const descriptionCol = headerTexts.findIndex((text) => text.startsWith("description"));
  const vendorCol = headerTexts.findIndex((text) => text.startsWith("vendor"));

  const byItemNo = new Map<string, ParsedItemMasterRow>();
  const rejectedRows: number[] = [];
  for (let r = headerIndex + 1; r < rows.length; r += 1) {
    const row = rows[r] ?? [];
    const itemNo = cellText(row[itemCol]);
    const hasAnyContent = row.some((cell) => cellText(cell) !== "");
    if (itemNo === "") {
      if (hasAnyContent) {
        rejectedRows.push(r + 1); // 1-based spreadsheet row number
      }
      continue;
    }
    const vendorNo = vendorCol >= 0 ? cellText(row[vendorCol]) : "";
    byItemNo.set(itemNo, {
      itemNo,
      description: descriptionCol >= 0 ? cellText(row[descriptionCol]) : "",
      vendorNo: vendorNo === "" ? null : vendorNo,
    });
  }

  return { items: [...byItemNo.values()], rejectedRows, error: null };
}

export function diffItemMaster(
  existingItemNos: ReadonlySet<string>,
  incoming: readonly ParsedItemMasterRow[],
): { added: number; updated: number } {
  let added = 0;
  let updated = 0;
  for (const item of incoming) {
    if (existingItemNos.has(item.itemNo)) {
      updated += 1;
    } else {
      added += 1;
    }
  }
  return { added, updated };
}
