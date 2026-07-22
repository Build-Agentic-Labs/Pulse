import { describe, expect, it } from "vitest";
import { detectHeaderRow, detectColumnMapping, SCHEDULE_FIELDS, type ColumnMapping } from "./schedule-columns";

const JUNE_HEADER = ["MODEL TYPE", "CUSTOMER", "BRAKE TYPE", "SO#", "FG A#", "FG SKU", "ACC SKU"];

describe("detectHeaderRow", () => {
  it("finds the header row below title and blank rows", () => {
    const rows = [
      ["JUNE PRODUCTION SCHEDULE", null, null],
      [null, null, null],
      JUNE_HEADER,
      ["EBOSS70-40", "Herc Rentals", "Electric", "S-ORD1234", "A12345", "FG-1", "ACC-1"],
    ];
    expect(detectHeaderRow(rows)).toBe(2);
  });

  it("returns -1 when no row looks like a header", () => {
    expect(detectHeaderRow([["a", "b"], ["c", "d"]])).toBe(-1);
  });

  it("ignores a row that matches only one field", () => {
    expect(detectHeaderRow([["CUSTOMER", "notes", "extra"]])).toBe(-1);
  });

  it("prefers the row matching the most fields", () => {
    const rows = [
      ["MODEL TYPE", "CUSTOMER", "misc"],
      JUNE_HEADER,
    ];
    expect(detectHeaderRow(rows)).toBe(1);
  });
});

describe("detectColumnMapping", () => {
  it("maps every June header to its field", () => {
    const mapping = detectColumnMapping(JUNE_HEADER);
    expect(mapping).toEqual<ColumnMapping>({
      model: 0,
      customer: 1,
      brake: 2,
      so: 3,
      fgAo: 4,
      fgSku: 5,
      accSku: 6,
    });
  });

  it("is case- and whitespace-insensitive", () => {
    const mapping = detectColumnMapping(["  model type ", "Customer Name"]);
    expect(mapping.model).toBe(0);
    expect(mapping.customer).toBe(1);
  });

  it("leaves an unmatched field null rather than guessing a column", () => {
    const mapping = detectColumnMapping(["MODEL TYPE", "CUSTOMER"]);
    expect(mapping.fgSku).toBeNull();
    expect(mapping.accSku).toBeNull();
    expect(mapping.so).toBeNull();
  });

  it("does not let ACC SKU steal the FG SKU column", () => {
    const mapping = detectColumnMapping(["ACC SKU", "FG SKU"]);
    expect(mapping.accSku).toBe(0);
    expect(mapping.fgSku).toBe(1);
  });

  it("does not map one column to two fields", () => {
    const mapping = detectColumnMapping(JUNE_HEADER);
    const used = SCHEDULE_FIELDS.map((field) => mapping[field]).filter((index) => index !== null);
    expect(new Set(used).size).toBe(used.length);
  });

  it("recognizes common alternate spellings", () => {
    const mapping = detectColumnMapping(["Model", "Customer", "Trailer Type", "Sales Order", "A#"]);
    expect(mapping.model).toBe(0);
    expect(mapping.customer).toBe(1);
    expect(mapping.brake).toBe(2);
    expect(mapping.so).toBe(3);
    expect(mapping.fgAo).toBe(4);
  });
});
