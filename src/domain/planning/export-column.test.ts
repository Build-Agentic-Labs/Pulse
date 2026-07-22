import { describe, expect, it } from "vitest";
import { buildExportColumn, exportColumnText } from "./export-column";

describe("buildExportColumn", () => {
  it("emits one cell per row in the range, in row order", () => {
    const column = buildExportColumn(
      [
        { sourceRowNo: 4, orderNo: "GEN-0726-01" },
        { sourceRowNo: 5, orderNo: "GEN-0726-02" },
      ],
      { first: 4, last: 5 },
    );
    expect(column.cells).toEqual(["GEN-0726-01", "GEN-0726-02"]);
    expect(column.total).toBe(2);
    expect(column.filled).toBe(2);
  });

  it("leaves a blank cell for a row with no record at all (a divider row)", () => {
    const column = buildExportColumn(
      [
        { sourceRowNo: 4, orderNo: "GEN-0726-01" },
        { sourceRowNo: 6, orderNo: "GEN-0726-02" },
      ],
      { first: 4, last: 6 },
    );
    expect(column.cells).toEqual(["GEN-0726-01", "", "GEN-0726-02"]);
    expect(column.filled).toBe(2);
    expect(column.total).toBe(3);
  });

  it("leaves a blank cell for a row whose order is not yet approved", () => {
    const column = buildExportColumn(
      [
        { sourceRowNo: 4, orderNo: "GEN-0726-01" },
        { sourceRowNo: 5, orderNo: null },
      ],
      { first: 4, last: 5 },
    );
    expect(column.cells).toEqual(["GEN-0726-01", ""]);
    expect(column.filled).toBe(1);
  });

  it("is insensitive to input ordering", () => {
    const column = buildExportColumn(
      [
        { sourceRowNo: 6, orderNo: "GEN-0726-03" },
        { sourceRowNo: 4, orderNo: "GEN-0726-01" },
        { sourceRowNo: 5, orderNo: "GEN-0726-02" },
      ],
      { first: 4, last: 6 },
    );
    expect(column.cells).toEqual(["GEN-0726-01", "GEN-0726-02", "GEN-0726-03"]);
  });

  it("ignores rows outside the range rather than shifting the column", () => {
    const column = buildExportColumn(
      [
        { sourceRowNo: 3, orderNo: "GEN-0726-99" },
        { sourceRowNo: 4, orderNo: "GEN-0726-01" },
        { sourceRowNo: 9, orderNo: "GEN-0726-98" },
      ],
      { first: 4, last: 5 },
    );
    expect(column.cells).toEqual(["GEN-0726-01", ""]);
    expect(column.total).toBe(2);
    expect(column.filled).toBe(1);
  });

  it("keeps the first value when a source row number is duplicated", () => {
    const column = buildExportColumn(
      [
        { sourceRowNo: 4, orderNo: "GEN-0726-01" },
        { sourceRowNo: 4, orderNo: "GEN-0726-02" },
      ],
      { first: 4, last: 4 },
    );
    expect(column.cells).toEqual(["GEN-0726-01"]);
    expect(column.filled).toBe(1);
  });

  it("does not let a later duplicate fill a row whose first entry was unapproved", () => {
    const column = buildExportColumn(
      [
        { sourceRowNo: 4, orderNo: null },
        { sourceRowNo: 4, orderNo: "GEN-0726-02" },
      ],
      { first: 4, last: 4 },
    );
    expect(column.cells).toEqual([""]);
    expect(column.filled).toBe(0);
  });

  it("produces a single cell for a one-row range", () => {
    const column = buildExportColumn([{ sourceRowNo: 7, orderNo: "GEN-0726-01" }], { first: 7, last: 7 });
    expect(column.cells).toEqual(["GEN-0726-01"]);
  });

  it("produces an all-blank column of the right length when nothing is approved", () => {
    const column = buildExportColumn([], { first: 4, last: 8 });
    expect(column.cells).toEqual(["", "", "", "", ""]);
    expect(column.total).toBe(5);
    expect(column.filled).toBe(0);
  });

  it("returns an empty column for an inverted range rather than throwing", () => {
    const column = buildExportColumn([], { first: 8, last: 4 });
    expect(column.cells).toEqual([]);
    expect(column.total).toBe(0);
    expect(column.filled).toBe(0);
  });

  it("treats an empty-string order number as unapproved, not as a value", () => {
    const column = buildExportColumn([{ sourceRowNo: 4, orderNo: "" }], { first: 4, last: 4 });
    expect(column.cells).toEqual([""]);
    expect(column.filled).toBe(0);
  });

  it("keeps a June-sized range exactly the length of the spreadsheet block", () => {
    // The real acceptance case: 212 importable rows out of a 4..215 block, with only some
    // approved. The column must still be 212 cells so a single paste lands on the right rows.
    const rows = [
      { sourceRowNo: 4, orderNo: "GEN-0726-01" },
      { sourceRowNo: 100, orderNo: "GEN-0726-02" },
      { sourceRowNo: 215, orderNo: "GEN-0726-03" },
    ];
    const column = buildExportColumn(rows, { first: 4, last: 215 });
    expect(column.total).toBe(212);
    expect(column.cells).toHaveLength(212);
    expect(column.filled).toBe(3);
    expect(column.cells[0]).toBe("GEN-0726-01");
    expect(column.cells[96]).toBe("GEN-0726-02");
    expect(column.cells[211]).toBe("GEN-0726-03");
  });
});

describe("exportColumnText", () => {
  it("joins cells with newlines so one paste fills a spreadsheet column", () => {
    const column = buildExportColumn(
      [
        { sourceRowNo: 4, orderNo: "GEN-0726-01" },
        { sourceRowNo: 6, orderNo: "GEN-0726-02" },
      ],
      { first: 4, last: 6 },
    );
    expect(exportColumnText(column)).toBe("GEN-0726-01\n\nGEN-0726-02");
  });

  it("returns an empty string for an empty column", () => {
    expect(exportColumnText(buildExportColumn([], { first: 8, last: 4 }))).toBe("");
  });

  it("preserves trailing blanks as newlines so the paste block keeps its height", () => {
    const column = buildExportColumn([{ sourceRowNo: 4, orderNo: "GEN-0726-01" }], { first: 4, last: 6 });
    expect(exportColumnText(column)).toBe("GEN-0726-01\n\n");
  });
});
