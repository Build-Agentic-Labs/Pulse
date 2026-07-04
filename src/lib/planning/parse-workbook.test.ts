import { describe, expect, it } from "vitest";
import { parseTemplateSheet, type WorkbookCell } from "./parse-workbook";

function sheet(cells: Record<number, Record<number, WorkbookCell>>, rowCount: number): WorkbookCell[][] {
  return Array.from({ length: rowCount }, (_, r) =>
    Array.from({ length: 22 }, (_, c) => cells[r]?.[c] ?? null),
  );
}

// Mirrors "ACC 70-45 OES": header on row 8, qty col 16, shipped col 20.
const ACC_SHEET = sheet(
  {
    0: { 0: "Kiewit WORK ORDER ACCESSORIES" },
    6: { 0: "BOSS70-40" },
    8: { 2: "ITEM NO.", 16: "Build Quantity", 20: "Shipped Quantity" },
    10: { 2: "BOSS70-001", 9: "A35987", 16: 1, 20: "__________" },
    11: { 2: "ENERGY BOSS 70 DUAL AXLE SURGE TRAILER" },
    14: { 2: "5000000075", 9: "PULL FROM A35988", 16: 2, 20: "__________" },
    15: { 2: "CHARGER SOLAR BATTERY 12V KIT" },
    18: { 16: 1, 20: "__________" }, // stray qty-only row — must be skipped
    22: { 2: "7000000155", 9: "PULL FROM STOCK A35989", 16: 1, 20: "__________" },
    23: { 2: "DECAL EB70 FULL HYBRID KIT" },
    26: { 1: "Notes:", 3: "Baltimore, MD" },
  },
  30,
);

// Mirrors "HEAD UNIT 70-40 UR": header row 8 but qty col 17; a unit-count row ("7") above the model.
const HEAD_UNIT_SHEET = sheet(
  {
    0: { 0: "UNITED RENTALS WORK ORDER HEAD UNIT" },
    3: { 0: "7" },
    6: { 0: "BOSS70-40" },
    8: { 2: "ITEM NO.", 17: "Build Quantity", 21: "Shipped Quantity" },
    10: { 2: "BOSS70-20HCS", 9: "A36424", 17: 1, 21: "__________" },
    11: { 2: "ENERGY BOSS 70KVA CS HEAD UNIT ASSEMBLY" },
    14: { 2: "HYBRID", 21: "__________" }, // marker line without qty
    15: { 2: "FIT FOR HYBRID" },
    18: { 1: "Notes:", 3: "Waukesha, WI" },
  },
  22,
);

const DATA_SHEET = sheet(
  {
    0: { 0: "No.", 1: "Description", 2: "Vendor No." },
    1: { 0: "135121164", 1: "Copper Gasket", 2: "V100014" },
  },
  3,
);

describe("parseTemplateSheet", () => {
  it("parses a standard accessories sheet", () => {
    const parsed = parseTemplateSheet("ACC 70-45 OES", ACC_SHEET);
    expect(parsed).not.toBeNull();
    expect(parsed?.customer).toBe("Kiewit");
    expect(parsed?.model).toBe("BOSS70-40");
    expect(parsed?.orderType).toBe("accessories");
    expect(parsed?.notes).toBe("Baltimore, MD");
    expect(parsed?.lines).toEqual([
      { itemNo: "BOSS70-001", description: "ENERGY BOSS 70 DUAL AXLE SURGE TRAILER", buildQty: 1, position: 0 },
      { itemNo: "5000000075", description: "CHARGER SOLAR BATTERY 12V KIT", buildQty: 2, position: 1 },
      { itemNo: "7000000155", description: "DECAL EB70 FULL HYBRID KIT", buildQty: 1, position: 2 },
    ]);
  });

  it("reads quantity from the header-declared column (17 variant) and skips the unit-count row for model", () => {
    const parsed = parseTemplateSheet("HEAD UNIT 70-40 UR", HEAD_UNIT_SHEET);
    expect(parsed?.model).toBe("BOSS70-40");
    expect(parsed?.orderType).toBe("head_unit");
    expect(parsed?.customer).toBe("UNITED RENTALS");
    expect(parsed?.lines[0]?.buildQty).toBe(1);
  });

  it("defaults missing quantities to 1 with a warning", () => {
    const parsed = parseTemplateSheet("HEAD UNIT 70-40 UR", HEAD_UNIT_SHEET);
    const hybrid = parsed?.lines.find((line) => line.itemNo === "HYBRID");
    expect(hybrid?.buildQty).toBe(1);
    expect(parsed?.warnings.some((w) => w.includes("HYBRID"))).toBe(true);
  });

  it("returns null for the DATA sheet (no ITEM NO. header)", () => {
    expect(parseTemplateSheet("DATA", DATA_SHEET)).toBeNull();
  });

  it("detects rework and extracts the customer before the REWORK marker", () => {
    const rework = sheet(
      {
        0: { 0: "T MOBILE REWORK UNIT" },
        2: { 0: "BOSS70-45 SOLAR" },
        6: { 2: "ITEM NO.", 17: "Build Quantity", 21: "Shipped Quantity" },
        8: { 2: "110034-LARM ELECTRIC", 17: 2, 21: "__________" },
        9: { 2: "END UNIT AXLE ARM LEFT" },
      },
      12,
    );
    const parsed = parseTemplateSheet("REWORK", rework);
    expect(parsed?.orderType).toBe("rework");
    expect(parsed?.customer).toBe("T MOBILE");
    expect(parsed?.model).toBe("BOSS70-45 SOLAR");
  });
});
