import { describe, expect, it } from "vitest";

import { buildBomHierarchy, detectBomFieldColumns, getMasterBom, PRODUCT_MASTER_BOM_FIELD } from "./master-bom";

describe("BOM hierarchy", () => {
  const bom = (levels: string[]) => ({ columns: ["Low-Level Code"], rows: levels.map(level => ({ "Low-Level Code": level })) });
  it("keeps sibling order and closes the previous assembly at its next sibling", () => {
    expect(buildBomHierarchy(bom(["0", "1", "1", "2", "1"]))).toEqual([
      { depth: 0, ancestors: [], hasChildren: true },
      { depth: 1, ancestors: [0], hasChildren: false },
      { depth: 1, ancestors: [0], hasChildren: true },
      { depth: 2, ancestors: [0, 2], hasChildren: false },
      { depth: 1, ancestors: [0], hasChildren: false },
    ]);
  });
  it("does not invent a hierarchy for missing or malformed levels", () => {
    for (const levels of [["0", ""], ["0", "2"], ["1", "0"], ["0", "-1"]]) expect(buildBomHierarchy(bom(levels))).toBeUndefined();
    expect(buildBomHierarchy({ columns: ["No."], rows: [{ "No.": "123" }] })).toBeUndefined();
  });
});

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
