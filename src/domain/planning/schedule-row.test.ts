import { describe, expect, it } from "vitest";
import { aoStatus, cleanSo, isSectionHeaderRow, normalizeBrake, parseModel } from "./schedule-row";

describe("parseModel", () => {
  it("reads a hybrid combo — first two numbers are PM then SDG generator", () => {
    expect(parseModel("BOSS70-65 Hybrid")).toEqual({
      kind: "hybrid",
      combo: "70-65",
      pmSize: "70",
      genSize: "65",
      raw: "BOSS70-65 Hybrid",
    });
  });

  it("treats the leading E in EBOSS as noise (same family)", () => {
    expect(parseModel("EBOSS25-25 Hybrid")).toMatchObject({ kind: "hybrid", combo: "25-25", pmSize: "25", genSize: "25" });
    expect(parseModel("EBOSS70-40 Hybrid")).toMatchObject({ kind: "hybrid", combo: "70-40" });
  });

  it("takes only the first two numbers when a variant tag trails (XQ125)", () => {
    expect(parseModel("BOSS125-125-XQ125 HYBRIDS")).toMatchObject({ kind: "hybrid", combo: "125-125", pmSize: "125", genSize: "125" });
  });

  it("recognizes a hybrid even without the 'Hybrid' word", () => {
    expect(parseModel("BOSS70-45")).toMatchObject({ kind: "hybrid", combo: "70-45" });
    expect(parseModel("BOSS125-65 Hybrid")).toMatchObject({ kind: "hybrid", combo: "125-65" });
  });

  it("reads a standalone power module (both 'Power Module' and 'PM' spellings)", () => {
    expect(parseModel("BOSS70 Power Module")).toMatchObject({ kind: "power_module", pmSize: "70" });
    expect(parseModel("BOSS70 PM")).toMatchObject({ kind: "power_module", pmSize: "70" });
    expect(parseModel("EBOSS220 PM")).toMatchObject({ kind: "power_module", pmSize: "220" });
    expect(parseModel("BOSS400 PM")).toMatchObject({ kind: "power_module", pmSize: "400" });
    expect(parseModel("BOSS125 PM")).toMatchObject({ kind: "power_module", pmSize: "125" });
    expect(parseModel("BOSS500 PM")).toMatchObject({ kind: "power_module", pmSize: "500" });
  });

  it("reads a trailer line (TRAILER / TRLR, any case)", () => {
    expect(parseModel("SDG25 TRAILER")).toMatchObject({ kind: "trailer", trailerSize: "25" });
    expect(parseModel("SDG150 TRLR")).toMatchObject({ kind: "trailer", trailerSize: "150" });
    expect(parseModel("SDG125 trailer")).toMatchObject({ kind: "trailer", trailerSize: "125" });
  });

  it("flags unrecognized products as 'other' (not part of the GEN/PM/TRL set model)", () => {
    expect(parseModel("PDS185EZ")).toMatchObject({ kind: "other" });
    expect(parseModel("SDG65S")).toMatchObject({ kind: "other" });
  });

  it("reports a blank model", () => {
    expect(parseModel("")).toMatchObject({ kind: "blank" });
    expect(parseModel("   ")).toMatchObject({ kind: "blank" });
  });
});


describe("normalizeBrake", () => {
  it("maps electric spellings to E", () => {
    expect(normalizeBrake("Electric")).toBe("E");
    expect(normalizeBrake("Electrical")).toBe("E");
  });
  it("folds surge and plain hydraulic into S (only two trailers exist)", () => {
    expect(normalizeBrake("Surge/Hydraulic")).toBe("S");
    expect(normalizeBrake("SURGE")).toBe("S");
    expect(normalizeBrake("Hydraulic")).toBe("S");
  });
  it("treats N/A, blanks, and encoding garble as none (no trailer)", () => {
    expect(normalizeBrake("N/A")).toBe("none");
    expect(normalizeBrake("NA")).toBe("none");
    expect(normalizeBrake("")).toBe("none");
    expect(normalizeBrake("�NA")).toBe("none");
  });
});

describe("cleanSo", () => {
  it("keeps a clean sales order untouched", () => {
    expect(cleanSo("S-ORD145933")).toEqual({ so: "S-ORD145933", flag: false });
  });
  it("strips trailing transfer text after the sales order", () => {
    expect(cleanSo("S-ORD144307 TO5745")).toEqual({ so: "S-ORD144307", flag: false });
  });
  it("keeps a bare transfer order (trailer stock) without flagging", () => {
    expect(cleanSo("TO5829")).toEqual({ so: "TO5829", flag: false });
  });
  it("flags NEED and blank as no-SO", () => {
    expect(cleanSo("NEED SO#")).toEqual({ so: "", flag: true });
    expect(cleanSo("")).toEqual({ so: "", flag: true });
    expect(cleanSo("   ")).toEqual({ so: "", flag: true });
  });
});

describe("aoStatus", () => {
  it("accepts an A-number", () => {
    expect(aoStatus("A35390")).toBe("ok");
    expect(aoStatus(" a34739 ")).toBe("ok");
  });
  it("flags NEED text and blanks (A# to enter)", () => {
    expect(aoStatus("NEED MTS#")).toBe("flag");
    expect(aoStatus("")).toBe("flag");
    expect(aoStatus("NEED MTS# NEED NEW STYLE BATTERY PACK")).toBe("flag");
  });
});


describe("isSectionHeaderRow", () => {
  it("treats a divider row (no unit data — model/SO/customer/A# all blank) as a section header to skip", () => {
    expect(isSectionHeaderRow({ model: "", so: "", customer: "", fgAo: "" })).toBe(true);
    expect(isSectionHeaderRow({ model: "  ", so: " ", customer: "", fgAo: "" })).toBe(true);
  });
  it("does NOT skip a real line, even one with a blank model but unit data present", () => {
    // A blank model WITH an SO / customer / A# is a data error to flag, not a divider to drop.
    expect(isSectionHeaderRow({ model: "", so: "S-ORD145933", customer: "", fgAo: "" })).toBe(false);
    expect(isSectionHeaderRow({ model: "", so: "", customer: "HERC RENTALS", fgAo: "" })).toBe(false);
    expect(isSectionHeaderRow({ model: "", so: "", customer: "", fgAo: "A35390" })).toBe(false);
    expect(isSectionHeaderRow({ model: "BOSS70-65 Hybrid", so: "", customer: "", fgAo: "" })).toBe(false);
  });
});


describe("parseModel — digit-adjacent PM/TRLR spellings", () => {
  it("classifies no-space PM/TRLR spellings (the shop uses these in its own template library)", () => {
    expect(parseModel("BOSS400PM")).toMatchObject({ kind: "power_module", pmSize: "400" });
    expect(parseModel("EBOSS220PM")).toMatchObject({ kind: "power_module", pmSize: "220" });
    expect(parseModel("SDG150TRLR")).toMatchObject({ kind: "trailer", trailerSize: "150" });
  });
});

