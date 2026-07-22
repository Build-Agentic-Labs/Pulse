import { describe, expect, it } from "vitest";
import { buildConfigIndex, resolveScheduleLine, type ConfigEntry } from "./schedule-resolve";

const GEN: ConfigEntry = {
  id: "cfg-gen",
  sku: "FG-7040-ES",
  orderType: "head_unit",
  model: "EBOSS70-40",
  pmConfigId: "cfg-pm",
  defaultTrailerLetter: "B",
};

const ACC: ConfigEntry = {
  id: "cfg-acc",
  sku: "ACC-STD",
  orderType: "accessories",
  model: "",
  pmConfigId: null,
  defaultTrailerLetter: "",
};

const index = buildConfigIndex([GEN, ACC], ["A", "B", "C", "D", "E", "S"]);

const row = {
  model: "EBOSS70-40",
  customer: "Equipment Share",
  brake: "Electric",
  fgSku: "FG-7040-ES",
  accSku: "ACC-STD",
  so: "S-ORD1234",
  fgAo: "A12345",
};

describe("resolveScheduleLine", () => {
  it("resolves a fully configured line with no flags", () => {
    const result = resolveScheduleLine(row, index);
    expect(result.status).toBe("resolved");
    expect(result.genConfigId).toBe("cfg-gen");
    expect(result.pmConfigId).toBe("cfg-pm");
    expect(result.accConfigId).toBe("cfg-acc");
    expect(result.so).toBe("S-ORD1234");
    expect(result.assemblyOrderNo).toBe("A12345");
    expect(result.flags).toEqual([]);
  });

  it("blocks when the FG SKU has no config", () => {
    const result = resolveScheduleLine({ ...row, fgSku: "FG-NOPE" }, index);
    expect(result.status).toBe("flagged");
    expect(result.flags).toContainEqual(
      expect.objectContaining({ code: "sku-not-configured", blocking: true }),
    );
  });

  it("blocks when a stated ACC SKU has no config", () => {
    const result = resolveScheduleLine({ ...row, accSku: "ACC-NOPE" }, index);
    expect(result.status).toBe("flagged");
    expect(result.flags).toContainEqual(
      expect.objectContaining({ code: "acc-sku-not-configured", blocking: true }),
    );
  });

  it("treats a blank ACC SKU as no accessories, not an error", () => {
    const result = resolveScheduleLine({ ...row, accSku: "" }, index);
    expect(result.status).toBe("resolved");
    expect(result.accConfigId).toBeUndefined();
    expect(result.flags).toEqual([]);
  });

  it("matches SKUs case- and whitespace-insensitively", () => {
    const result = resolveScheduleLine({ ...row, fgSku: "  fg-7040-es  " }, index);
    expect(result.status).toBe("resolved");
    expect(result.genConfigId).toBe("cfg-gen");
  });

  it("takes the trailer letter from the sheet's brake when present", () => {
    expect(resolveScheduleLine(row, index).trailerLetter).toBe("E");
  });

  it("falls back to the config default and advises when the brake is blank", () => {
    const result = resolveScheduleLine({ ...row, brake: "" }, index);
    expect(result.trailerLetter).toBe("B");
    expect(result.status).toBe("resolved");
    expect(result.flags).toContainEqual(
      expect.objectContaining({ code: "trailer-letter-unspecified", blocking: false }),
    );
  });

  it("advises when the A# is missing but still resolves", () => {
    const result = resolveScheduleLine({ ...row, fgAo: "NEED" }, index);
    expect(result.status).toBe("resolved");
    expect(result.flags).toContainEqual(
      expect.objectContaining({ code: "ao-to-enter", blocking: false }),
    );
  });

  it("advises when the SO number is missing", () => {
    const result = resolveScheduleLine({ ...row, so: "NEED" }, index);
    expect(result.so).toBe("");
    expect(result.flags).toContainEqual(
      expect.objectContaining({ code: "so-missing", blocking: false }),
    );
  });

  it("advises when the sheet model disagrees with the config's model", () => {
    const result = resolveScheduleLine({ ...row, model: "EBOSS25-25" }, index);
    expect(result.flags).toContainEqual(
      expect.objectContaining({ code: "model-mismatch", blocking: false }),
    );
  });

  it("flags a resolved letter the trailer catalog does not contain", () => {
    const narrow = buildConfigIndex([GEN, ACC], ["A"]);
    const result = resolveScheduleLine(row, narrow);
    expect(result.flags).toContainEqual(
      expect.objectContaining({ code: "trailer-config-missing", blocking: false }),
    );
  });

  it("blocks a blank model", () => {
    const result = resolveScheduleLine({ ...row, model: "", fgSku: "" }, index);
    expect(result.status).toBe("flagged");
    expect(result.flags).toContainEqual(
      expect.objectContaining({ code: "blank-model", blocking: true }),
    );
  });

  it("carries the generator config's paired PM through", () => {
    const noPm = buildConfigIndex([{ ...GEN, pmConfigId: null }, ACC], ["A", "B", "E"]);
    const result = resolveScheduleLine(row, noPm);
    expect(result.pmConfigId).toBeNull();
    expect(result.status).toBe("resolved");
  });
});

describe("buildConfigIndex", () => {
  it("skips entries with a blank SKU rather than indexing them under ''", () => {
    const withLegacy = buildConfigIndex([GEN, { ...ACC, sku: "" }], ["A"]);
    const result = resolveScheduleLine({ ...row, accSku: "" }, withLegacy);
    expect(result.accConfigId).toBeUndefined();
    expect(result.status).toBe("resolved");
  });

  it("normalizes stored SKUs so lookup is case-insensitive in both directions", () => {
    const shouty = buildConfigIndex([{ ...GEN, sku: "fg-7040-es" }], ["E"]);
    const result = resolveScheduleLine({ ...row, accSku: "" }, shouty);
    expect(result.genConfigId).toBe("cfg-gen");
  });
});
