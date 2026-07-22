import { describe, expect, it } from "vitest";
import { buildExportColumn } from "./export-column";
import { detectColumnMapping, detectHeaderRow } from "./schedule-columns";
import { buildSchedulePreview, groupPreviewFlags } from "./schedule-preview";
import { buildConfigIndex, type ConfigEntry } from "./schedule-resolve";

const GEN: ConfigEntry = {
  id: "cfg-gen",
  sku: "FG-7040-HERC",
  orderType: "head_unit",
  model: "EBOSS70-40",
  pmConfigId: "cfg-pm",
  defaultTrailerLetter: "E",
};

const index = buildConfigIndex([GEN], ["E", "S"]);

/** The real sheet shape: a title, a blank row, a header, data, and a category divider. */
const SHEET = [
  ["JUNE PRODUCTION SCHEDULE", "", "", "", "", "", "", ""],
  ["", "", "", "", "", "", "", ""],
  ["MODEL TYPE", "CUSTOMER", "BRAKE TYPE", "SO#", "FG A#", "FG SKU", "ACC SKU", "PLANNED WEEKLY BUILDS"],
  ["EBOSS70-40", "Herc Rentals", "Electric", "S-ORD1234", "A12345", "FG-7040-HERC", "", ""],
  ["", "", "", "", "", "", "", "TRAILERS"],
  ["EBOSS25-25", "Equipment Share", "Surge", "S-ORD1235", "NEED", "FG-2525-ES", "", ""],
  ["EBOSS70-40", "Kiewit", "Hydraulic", "NEED", "A12347", "FG-7040-HERC", "", ""],
];

function previewOf(rows: typeof SHEET) {
  const headerRowIndex = detectHeaderRow(rows);
  const mapping = detectColumnMapping(rows[headerRowIndex] ?? []);
  return buildSchedulePreview(rows, headerRowIndex, mapping, index);
}

describe("buildSchedulePreview", () => {
  it("imports the data rows and skips the divider", () => {
    const preview = previewOf(SHEET);
    expect(preview.rows.map((row) => row.sourceRowNo)).toEqual([4, 6, 7]);
    expect(preview.dividerRows).toBe(1);
  });

  it("spans the block INCLUDING the divider row so the export column can leave a gap", () => {
    const preview = previewOf(SHEET);
    expect(preview.firstRowNo).toBe(4);
    expect(preview.lastRowNo).toBe(7);
  });

  it("flags the row whose SKU has no configuration and resolves the ones that do", () => {
    const preview = previewOf(SHEET);
    expect(preview.resolvedCount).toBe(2);
    expect(preview.flaggedCount).toBe(1);
    const flagged = preview.rows.find((row) => row.resolution.status === "flagged");
    expect(flagged?.sourceRowNo).toBe(6);
    expect(flagged?.resolution.flags.map((flag) => flag.code)).toContain("sku-not-configured");
  });

  it("carries advisories through without blocking", () => {
    const preview = previewOf(SHEET);
    const kiewit = preview.rows.find((row) => row.sourceRowNo === 7);
    expect(kiewit?.resolution.status).toBe("resolved");
    expect(kiewit?.resolution.flags.map((flag) => flag.code)).toContain("so-missing");
  });

  it("ignores wholly blank trailing rows rather than extending the range", () => {
    const preview = previewOf([...SHEET, ["", "", "", "", "", "", "", ""], ["", "", "", "", "", "", "", ""]]);
    expect(preview.lastRowNo).toBe(7);
  });

  it("returns an empty preview when there is nothing below the header", () => {
    const preview = previewOf(SHEET.slice(0, 3));
    expect(preview.rows).toEqual([]);
    expect(preview.firstRowNo).toBe(0);
    expect(preview.lastRowNo).toBe(0);
  });

  it("reads through a REMAPPED column rather than a positional assumption", () => {
    // Model and FG SKU swapped: resolution must follow the mapping, not the column order.
    const swapped = [
      ["FG SKU", "CUSTOMER", "BRAKE TYPE", "SO#", "FG A#", "MODEL TYPE", "ACC SKU"],
      ["FG-7040-HERC", "Herc Rentals", "Electric", "S-ORD1234", "A12345", "EBOSS70-40", ""],
    ];
    const mapping = detectColumnMapping(swapped[0]);
    const preview = buildSchedulePreview(swapped, 0, mapping, index);
    expect(preview.rows[0]?.resolution.status).toBe("resolved");
    expect(preview.rows[0]?.resolution.genConfigId).toBe("cfg-gen");
  });
});

describe("preview → export column", () => {
  it("leaves the divider row blank and keeps every id on its own spreadsheet row", () => {
    const preview = previewOf(SHEET);

    // Approve only the two resolvable rows, as would happen in practice.
    const approved = preview.rows
      .filter((row) => row.resolution.status === "resolved")
      .map((row, order) => ({
        sourceRowNo: row.sourceRowNo,
        orderNo: `GEN-0726-0${order + 1}`,
      }));

    const column = buildExportColumn(approved, { first: preview.firstRowNo, last: preview.lastRowNo });

    // Rows 4..7 → four cells: row 4 approved, row 5 divider (blank), row 6 flagged (blank), row 7 approved.
    expect(column.cells).toEqual(["GEN-0726-01", "", "", "GEN-0726-02"]);
    expect(column.total).toBe(4);
    expect(column.filled).toBe(2);
  });
});

describe("groupPreviewFlags", () => {
  it("collapses repeats and puts blocking flags first", () => {
    const preview = previewOf([...SHEET, ["EBOSS25-25", "Peak", "Surge", "S-ORD9", "A1", "FG-2525-ES", "", ""]]);
    const groups = groupPreviewFlags(preview.rows);
    expect(groups[0]?.code).toBe("sku-not-configured");
    expect(groups[0]?.blocking).toBe(true);
    expect(groups[0]?.count).toBe(2);
  });
});
