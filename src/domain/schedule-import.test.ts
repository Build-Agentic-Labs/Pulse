import { describe, expect, it } from "vitest";
import {
  aoStatus,
  cleanSo,
  isSectionHeaderRow,
  normalizeBrake,
  normalizeCustomer,
  parseModel,
  buildTemplateIndex,
  parseGenTemplateName,
  parsePmSize,
  resolveLine,
  type TemplateIndex,
} from "./schedule-import";

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

describe("normalizeCustomer", () => {
  it("collapses Equipment Share spellings to the ES suffix", () => {
    expect(normalizeCustomer("EQUIPMENT SHARE")).toEqual({ canonical: "Equipment Share", suffix: "ES" });
    expect(normalizeCustomer("Equipmentshare.com")).toEqual({ canonical: "Equipment Share", suffix: "ES" });
  });

  it("collapses the three Herc spellings to HERC", () => {
    for (const spelling of ["HERC RENTALS", "HERC Rentals", "Herc Rentals"]) {
      expect(normalizeCustomer(spelling)).toEqual({ canonical: "Herc Rentals", suffix: "HERC" });
    }
  });

  it("maps United Rentals to UR", () => {
    expect(normalizeCustomer("United Rentals")).toEqual({ canonical: "United Rentals", suffix: "UR" });
  });

  it("maps both Kiewit spellings to KIEWIT", () => {
    expect(normalizeCustomer("Kiewit")).toEqual({ canonical: "Kiewit", suffix: "KIEWIT" });
    expect(normalizeCustomer("PETER KIEWIT")).toEqual({ canonical: "Kiewit", suffix: "KIEWIT" });
  });

  it("maps every CAT dealer spelling to CAT", () => {
    for (const spelling of ["RING POWER- CAT", "Quinn CAT", "Western States Equipment Company- CAT"]) {
      expect(normalizeCustomer(spelling)).toEqual({ canonical: "CAT dealer", suffix: "CAT" });
    }
  });

  it("maps REIC and OES to themselves", () => {
    expect(normalizeCustomer("REIC")).toEqual({ canonical: "REIC", suffix: "REIC" });
    expect(normalizeCustomer("OES")).toEqual({ canonical: "OES", suffix: "OES" });
  });

  it("recovers the real customer buried in a contaminated value", () => {
    expect(normalizeCustomer("IWCE tradeshow/ OES- STOCK ONCE APPROVED")).toEqual({ canonical: "OES", suffix: "OES" });
  });

  it("returns null for location text and blanks (not a customer)", () => {
    expect(normalizeCustomer("SACRAMENTO - DUE BY 6/29")).toBeNull();
    expect(normalizeCustomer("SACRAMENTO")).toBeNull();
    expect(normalizeCustomer("")).toBeNull();
    expect(normalizeCustomer("   ")).toBeNull();
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

describe("resolveLine", () => {
  // Fixture index: 70-series PM authored; 25 & 125 PM intentionally absent (D5 = skip).
  // Gen templates are customer-scoped; 25-25 has ES & HERC only (no Kiewit/CAT).
  const index: TemplateIndex = {
    gens: [
      { id: "g-7065-es", combo: "70-65", suffix: "ES" },
      { id: "g-7040-ur", combo: "70-40", suffix: "UR" },
      { id: "g-2525-es", combo: "25-25", suffix: "ES" },
      { id: "g-2525-herc", combo: "25-25", suffix: "HERC" },
    ],
    pms: [
      { id: "p-70", size: "70" },
      { id: "p-220", size: "220" },
    ],
    trailerLetters: new Set(["E", "S"]),
  };
  const codes = (r: ReturnType<typeof resolveLine>) => r.flags.map((f) => f.code);

  it("fully resolves a hybrid with a matching gen+PM template, trailer letter, and A#", () => {
    const r = resolveLine(
      { model: "BOSS70-65 Hybrid", customer: "EQUIPMENT SHARE", brake: "Surge/Hydraulic", fgAo: "A35390" },
      index,
    );
    expect(r.status).toBe("resolved");
    expect(r.genTemplateId).toBe("g-7065-es");
    expect(r.pmTemplateId).toBe("p-70");
    expect(r.trailerLetter).toBe("S");
    expect(r.aoOk).toBe(true);
    expect(r.flags).toEqual([]);
  });

  it("stays resolved but records an advisory ao-to-enter flag when the A# is missing", () => {
    const r = resolveLine(
      { model: "BOSS70-65 Hybrid", customer: "EQUIPMENT SHARE", brake: "Surge/Hydraulic", fgAo: "NEED MTS#" },
      index,
    );
    expect(r.status).toBe("resolved");
    expect(codes(r)).toEqual(["ao-to-enter"]);
    expect(r.flags.every((f) => !f.blocking)).toBe(true);
  });

  it("hard-flags a hybrid whose combo exists but customer variant does not", () => {
    const r = resolveLine({ model: "EBOSS25-25 Hybrid", customer: "Kiewit", brake: "Electric", fgAo: "A1" }, index);
    expect(r.status).toBe("flagged");
    expect(codes(r)).toContain("no-template-for-customer");
    // The 25 PM is also missing (D5 skip) — both blocking reasons enumerated.
    expect(codes(r)).toContain("pm-template-missing");
  });

  it("hard-flags a hybrid whose combo has no generator template at all", () => {
    const r = resolveLine({ model: "BOSS125-65 Hybrid", customer: "PETER KIEWIT", brake: "Electric", fgAo: "A1" }, index);
    expect(r.status).toBe("flagged");
    expect(codes(r)).toContain("no-gen-template-for-combo");
  });

  it("hard-flags a hybrid whose customer cannot be recognized", () => {
    const r = resolveLine({ model: "BOSS70-65 Hybrid", customer: "SACRAMENTO", brake: "Surge/Hydraulic", fgAo: "A1" }, index);
    expect(r.status).toBe("flagged");
    expect(codes(r)).toContain("unknown-customer");
  });

  it("hard-flags a hybrid whose PM template is not authored (25 PM skipped)", () => {
    const r = resolveLine({ model: "EBOSS25-25 Hybrid", customer: "EQUIPMENT SHARE", brake: "Electric", fgAo: "A1" }, index);
    expect(r.genTemplateId).toBe("g-2525-es"); // gen resolves
    expect(r.status).toBe("flagged"); // ...but PM missing blocks the set
    expect(codes(r)).toEqual(["pm-template-missing"]);
  });

  it("resolves a standalone power module when its size is authored, flags it when not", () => {
    expect(resolveLine({ model: "BOSS70 PM", customer: "", brake: "N/A", fgAo: "A1" }, index)).toMatchObject({
      status: "resolved",
      pmTemplateId: "p-70",
    });
    const missing = resolveLine({ model: "BOSS125 PM", customer: "", brake: "N/A", fgAo: "A1" }, index);
    expect(missing.status).toBe("flagged");
    expect(codes(missing)).toContain("pm-template-missing");
  });

  it("treats a trailer stock line as resolved; letter from brake, advisory when absent", () => {
    const withBrake = resolveLine({ model: "SDG125 trailer", customer: "", brake: "Surge/Hydraulic", fgAo: "A1" }, index);
    expect(withBrake.status).toBe("resolved");
    expect(withBrake.trailerLetter).toBe("S");

    const noBrake = resolveLine({ model: "SDG25 TRAILER", customer: "SACRAMENTO", brake: "N/A", fgAo: "A1" }, index);
    expect(noBrake.status).toBe("resolved"); // stock line, planner picks config
    expect(codes(noBrake)).toContain("trailer-letter-unspecified");
    expect(noBrake.flags.every((f) => !f.blocking)).toBe(true);
  });

  it("hard-flags unrecognized and blank models", () => {
    expect(resolveLine({ model: "PDS185EZ", customer: "", brake: "N/A", fgAo: "A1" }, index)).toMatchObject({
      status: "flagged",
    });
    expect(codes(resolveLine({ model: "PDS185EZ", customer: "", brake: "N/A", fgAo: "A1" }, index))).toContain(
      "unrecognized-model",
    );
    expect(codes(resolveLine({ model: "", customer: "", brake: "", fgAo: "" }, index))).toContain("blank-model");
  });
});

describe("parseGenTemplateName", () => {
  it("splits a customer-scoped generator name into combo + suffix", () => {
    expect(parseGenTemplateName("HEAD UNIT 25-25 ES")).toEqual({ combo: "25-25", suffix: "ES" });
    expect(parseGenTemplateName("HEAD UNIT 70-40 UR")).toEqual({ combo: "70-40", suffix: "UR" });
    expect(parseGenTemplateName("HEAD UNIT 70-65 ES")).toEqual({ combo: "70-65", suffix: "ES" });
  });
  it("keeps a multi-token suffix intact", () => {
    expect(parseGenTemplateName("HEAD UNIT 70-45 T-MOBILE")).toEqual({ combo: "70-45", suffix: "T-MOBILE" });
  });
  it("reads a generic (no-suffix) template, BOSS-prefixed", () => {
    expect(parseGenTemplateName("HEAD UNIT BOSS125-125")).toEqual({ combo: "125-125", suffix: "" });
  });
  it("returns null for names that are not generator templates (mocks, junk)", () => {
    expect(parseGenTemplateName("MOCK — Head Unit Test")).toBeNull();
    expect(parseGenTemplateName("REWORK")).toBeNull();
    expect(parseGenTemplateName("")).toBeNull();
  });
});

describe("parsePmSize", () => {
  it("reads the size from a PM model or name (either spelling)", () => {
    expect(parsePmSize("BOSS70 PM")).toBe("70");
    expect(parsePmSize("BOSS220 PM")).toBe("220");
    expect(parsePmSize("HEAD UNIT BOSS400PM")).toBe("400");
    expect(parsePmSize("HEAD UNIT 70PM")).toBe("70");
  });
  it("returns null when there is no PM size", () => {
    expect(parsePmSize("Trailer")).toBeNull();
  });
});

describe("buildTemplateIndex", () => {
  it("assembles gens (combo+suffix) and pms (size) from raw rows, skipping unparseable ones", () => {
    const index = buildTemplateIndex(
      [
        { id: "g1", name: "HEAD UNIT 70-65 ES", model: "BOSS70-65", order_type: "head_unit" },
        { id: "g2", name: "HEAD UNIT BOSS125-125", model: "BOSS125-125-XQ125", order_type: "head_unit" },
        { id: "gm", name: "MOCK — Head Unit Test", model: "BOSS70-40", order_type: "head_unit" },
        { id: "p1", name: "HEAD UNIT 70PM", model: "BOSS70 PM", order_type: "power_module" },
        { id: "p2", name: "HEAD UNIT BOSS220PM", model: "BOSS220 PM", order_type: "power_module" },
        { id: "acc", name: "ACC 70-65 ES", model: "BOSS70-65", order_type: "accessories" },
      ],
      ["E", "S"],
    );
    expect(index.gens).toEqual([
      { id: "g1", combo: "70-65", suffix: "ES", modelMismatch: false },
      { id: "g2", combo: "125-125", suffix: "", modelMismatch: false },
    ]);
    expect(index.pms).toEqual([
      { id: "p1", size: "70" },
      { id: "p2", size: "220" },
    ]);
    expect([...index.trailerLetters].sort()).toEqual(["E", "S"]);
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

describe("normalizeCustomer — false-positive & contamination hardening", () => {
  it("does not match a short suffix buried inside an unrelated word (whole-word only)", () => {
    expect(normalizeCustomer("STOCK - DOES NOT SHIP")).toBeNull(); // 'OES' inside 'DOES'
    expect(normalizeCustomer("HERCULES INDUSTRIES")).toBeNull(); // 'HERC' inside 'HERCULES'
    expect(normalizeCustomer("REICHERT EQUIPMENT")).toBeNull(); // 'REIC' inside 'REICHERT'
    expect(normalizeCustomer("Bobcat")).toBeNull(); // 'CAT' inside 'BOBCAT'
  });
  it("still recovers a real customer buried under a trailing note", () => {
    expect(normalizeCustomer("Quinn CAT - DUE BY 6/29")).toEqual({ canonical: "CAT dealer", suffix: "CAT" });
    expect(normalizeCustomer("OES- STOCK ONCE APPROVED")).toEqual({ canonical: "OES", suffix: "OES" });
  });
  it("maps the authored-but-unseen customers so their existing templates are reachable", () => {
    expect(normalizeCustomer("Peak")).toEqual({ canonical: "Peak", suffix: "PEAK" });
    expect(normalizeCustomer("T-Mobile")).toEqual({ canonical: "T-Mobile", suffix: "T-MOBILE" });
  });
});

describe("parseGenTemplateName — EBOSS prefix tolerance", () => {
  it("accepts an EBOSS-prefixed generator name (would otherwise drop from the index)", () => {
    expect(parseGenTemplateName("HEAD UNIT EBOSS25-25 ES")).toEqual({ combo: "25-25", suffix: "ES" });
  });
});

describe("parseModel — digit-adjacent PM/TRLR spellings", () => {
  it("classifies no-space PM/TRLR spellings (the shop uses these in its own template library)", () => {
    expect(parseModel("BOSS400PM")).toMatchObject({ kind: "power_module", pmSize: "400" });
    expect(parseModel("EBOSS220PM")).toMatchObject({ kind: "power_module", pmSize: "220" });
    expect(parseModel("SDG150TRLR")).toMatchObject({ kind: "trailer", trailerSize: "150" });
  });
});

describe("buildTemplateIndex — name/model combo disagreement", () => {
  it("marks a gen template whose model column contradicts its name", () => {
    const index = buildTemplateIndex(
      [
        { id: "ok", name: "HEAD UNIT 70-45 HERC", model: "BOSS70-45", order_type: "head_unit" },
        { id: "bad", name: "HEAD UNIT 70-45 OES", model: "BOSS70-40", order_type: "head_unit" },
        { id: "generic", name: "HEAD UNIT BOSS125-125", model: "BOSS125-125-XQ125", order_type: "head_unit" },
      ],
      ["E", "S"],
    );
    expect(index.gens.find((g) => g.id === "ok")?.modelMismatch).toBeFalsy();
    expect(index.gens.find((g) => g.id === "bad")?.modelMismatch).toBe(true);
    expect(index.gens.find((g) => g.id === "generic")?.modelMismatch).toBeFalsy();
  });
});

describe("resolveLine — audit follow-ups", () => {
  it("resolves but advises when the matched template's name and model disagree", () => {
    const index: TemplateIndex = {
      gens: [{ id: "oes", combo: "70-45", suffix: "OES", modelMismatch: true }],
      pms: [{ id: "p70", size: "70" }],
      trailerLetters: new Set(["E", "S"]),
    };
    const r = resolveLine({ model: "BOSS70-45 Hybrid", customer: "OES", brake: "Surge/Hydraulic", fgAo: "A1" }, index);
    expect(r.status).toBe("resolved");
    expect(r.genTemplateId).toBe("oes");
    const f = r.flags.find((x) => x.code === "template-model-mismatch");
    expect(f?.blocking).toBe(false);
  });

  it("carries the trailer size so the importer can build the right stock order", () => {
    const index: TemplateIndex = { gens: [], pms: [], trailerLetters: new Set(["E", "S"]) };
    expect(resolveLine({ model: "SDG150 TRLR", customer: "", brake: "", fgAo: "A1" }, index)).toMatchObject({
      kind: "trailer",
      trailerSize: "150",
    });
  });

  it("advises (non-blocking) when a resolved letter is not in the trailer catalog", () => {
    const index: TemplateIndex = {
      gens: [{ id: "g", combo: "70-65", suffix: "ES" }],
      pms: [{ id: "p", size: "70" }],
      trailerLetters: new Set(["E"]),
    };
    const r = resolveLine({ model: "BOSS70-65 Hybrid", customer: "EQUIPMENT SHARE", brake: "Surge/Hydraulic", fgAo: "A1" }, index);
    expect(r.trailerLetter).toBe("S");
    expect(r.status).toBe("resolved");
    expect(r.flags.find((x) => x.code === "trailer-config-missing")?.blocking).toBe(false);
  });

  it("gives a clear detail when only a generic (suffix-less) template exists", () => {
    const index: TemplateIndex = {
      gens: [{ id: "gen", combo: "125-125", suffix: "" }],
      pms: [{ id: "p125", size: "125" }],
      trailerLetters: new Set(["E", "S"]),
    };
    const r = resolveLine({ model: "BOSS125-125-XQ125 HYBRIDS", customer: "RING POWER- CAT", brake: "Electric", fgAo: "A1" }, index);
    expect(r.status).toBe("flagged");
    const f = r.flags.find((x) => x.code === "no-template-for-customer");
    expect(f?.detail).toMatch(/generic/i);
    expect(f?.detail).not.toContain("(have: )");
  });
});
