import { describe, expect, it } from "vitest";

import { detectBomFieldColumns, getMasterBom, PRODUCT_MASTER_BOM_FIELD } from "./master-bom";

describe("detectBomFieldColumns", () => {
  it("maps a real-world BOM header layout", () => {
    const result = detectBomFieldColumns([
      "Item Filter",
      "Type",
      "No.",
      "Description",
      "Warning",
      "Qty. per Parent",
      "Unit of Measure Code",
      "Replenishment System",
    ]);
    expect(result).toEqual({ partNumber: "No.", description: "Description", quantity: "Qty. per Parent" });
  });

  it("never assigns the same column to two fields", () => {
    // "Item Number" matches both part-number ("number") and could be grabbed by
    // quantity hints; each column must be claimed at most once.
    const result = detectBomFieldColumns(["Item Number", "Qty"]);
    expect(result.partNumber).toBe("Item Number");
    expect(result.quantity).toBe("Qty");
    expect(result.partNumber).not.toBe(result.quantity);
  });
});

describe("getMasterBom", () => {
  it("returns undefined when nothing is stored", () => {
    expect(getMasterBom(undefined)).toBeUndefined();
    expect(getMasterBom({})).toBeUndefined();
  });

  it("normalizes every row to the column set with string cells", () => {
    const bom = getMasterBom({
      [PRODUCT_MASTER_BOM_FIELD]: {
        fileName: "bom.xlsx",
        columns: ["No.", "Qty"],
        rows: [{ "No.": "P1", Qty: 4 }, { "No.": "P2" }],
      },
    });
    expect(bom?.columns).toEqual(["No.", "Qty"]);
    expect(bom?.rows).toEqual([
      { "No.": "P1", Qty: "4" },
      { "No.": "P2", Qty: "" },
    ]);
  });
});
