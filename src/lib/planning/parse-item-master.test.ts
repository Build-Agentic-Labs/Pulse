import { describe, expect, it } from "vitest";
import { diffItemMaster, parseItemMasterRows } from "./parse-item-master";

describe("parseItemMasterRows", () => {
  it("parses the BC export shape (No. / Description / Vendor No.)", () => {
    const result = parseItemMasterRows([
      ["No.", "Description", "Vendor No."],
      ["135121164", "Copper Gasket 15/16\"", "V100014"],
      ["206160000", "End Mounting Bracket", null],
    ]);
    expect(result.error).toBeNull();
    expect(result.items).toEqual([
      { itemNo: "135121164", description: "Copper Gasket 15/16\"", vendorNo: "V100014" },
      { itemNo: "206160000", description: "End Mounting Bracket", vendorNo: null },
    ]);
    expect(result.rejectedRows).toEqual([]);
  });

  it("rejects rows without an item number, reporting 1-based row numbers", () => {
    const result = parseItemMasterRows([
      ["No.", "Description", "Vendor No."],
      [null, "Orphan description", "V1"],
      ["100", "Valid", null],
    ]);
    expect(result.items).toHaveLength(1);
    expect(result.rejectedRows).toEqual([2]);
  });

  it("dedupes repeated item numbers, last row wins", () => {
    const result = parseItemMasterRows([
      ["No.", "Description", "Vendor No."],
      ["100", "Old", null],
      ["100", "New", "V2"],
    ]);
    expect(result.items).toEqual([{ itemNo: "100", description: "New", vendorNo: "V2" }]);
  });

  it("errors when no header row is present", () => {
    const result = parseItemMasterRows([["random", "cells"]]);
    expect(result.error).toContain("header");
    expect(result.items).toEqual([]);
  });
});

describe("diffItemMaster", () => {
  it("splits incoming items into added vs updated", () => {
    const existing = new Set(["100", "200"]);
    const incoming = [
      { itemNo: "100", description: "", vendorNo: null },
      { itemNo: "300", description: "", vendorNo: null },
    ];
    expect(diffItemMaster(existing, incoming)).toEqual({ added: 1, updated: 1 });
  });
});
