import { describe, expect, it } from "vitest";

import { canonicalToolKey, formatToolName, TOOL_ACRONYMS } from "./tool-name-format";

describe("formatToolName", () => {
  it("title-cases simple names", () => {
    expect(formatToolName("torque wrench")).toBe("Torque Wrench");
    expect(formatToolName("ratchet")).toBe("Ratchet");
    expect(formatToolName("socket")).toBe("Socket");
  });

  it("trims and collapses internal whitespace", () => {
    expect(formatToolName("  torque   wrench  ")).toBe("Torque Wrench");
    expect(formatToolName("torque\twrench")).toBe("Torque Wrench");
  });

  it("returns empty string for blank input", () => {
    expect(formatToolName("")).toBe("");
    expect(formatToolName("   ")).toBe("");
  });

  it("lowercases small words except when first", () => {
    expect(formatToolName("tap and die set")).toBe("Tap and Die Set");
    expect(formatToolName("box of tools")).toBe("Box of Tools");
    expect(formatToolName("and wrench")).toBe("And Wrench");
  });

  it("preserves digit-led sizes and units verbatim", () => {
    expect(formatToolName("10mm socket")).toBe("10mm Socket");
    expect(formatToolName("1/2in impact gun")).toBe("1/2in Impact Gun");
    expect(formatToolName("loctite 243")).toBe("Loctite 243");
  });

  it("uppercases the leading letter run of letter-led codes", () => {
    expect(formatToolName("m6 hex driver")).toBe("M6 Hex Driver");
    expect(formatToolName("t30 torx bit")).toBe("T30 Torx Bit");
  });

  it("preserves known acronyms regardless of typed case", () => {
    expect(formatToolName("hss end mill")).toBe("HSS End Mill");
    expect(formatToolName("HSS end mill")).toBe("HSS End Mill");
    expect(formatToolName("cres bolt")).toBe("CRES Bolt");
    expect(formatToolName("npt tap")).toBe("NPT Tap");
  });

  it("keeps short all-caps tokens (<=4) as acronyms", () => {
    expect(formatToolName("ACME thread gauge")).toBe("ACME Thread Gauge");
    expect(formatToolName("TORX bit")).toBe("TORX Bit");
  });

  it("title-cases long shouted words", () => {
    expect(formatToolName("WRENCH")).toBe("Wrench");
    expect(formatToolName("TORQUE WRENCH")).toBe("Torque Wrench");
    expect(formatToolName("SOCKET")).toBe("Socket");
  });

  it("title-cases across hyphens", () => {
    expect(formatToolName("t-handle allen")).toBe("T-Handle Allen");
    expect(formatToolName("allen-key")).toBe("Allen-Key");
  });

  it("handles punctuation tokens", () => {
    expect(formatToolName("loctite / adhesive")).toBe("Loctite / Adhesive");
  });

  it("handles mixed real-world names", () => {
    expect(formatToolName("1/2in TORQUE wrench")).toBe("1/2in Torque Wrench");
    expect(formatToolName("m6 hss tap")).toBe("M6 HSS Tap");
  });

  it("is idempotent", () => {
    const samples = [
      "torque wrench",
      "10mm socket",
      "m6 hex driver",
      "HSS End Mill",
      "1/2in TORQUE wrench",
      "ACME Thread Gauge",
      "t-handle allen",
    ];
    for (const sample of samples) {
      const once = formatToolName(sample);
      expect(formatToolName(once)).toBe(once);
    }
  });

  it("exposes the manufacturing acronym allowlist", () => {
    expect(TOOL_ACRONYMS.has("HSS")).toBe(true);
    expect(TOOL_ACRONYMS.has("CRES")).toBe(true);
  });

  it("collapses the space between a number and its unit", () => {
    expect(formatToolName("10 mm socket")).toBe("10mm Socket");
    expect(formatToolName("1/2 in drive")).toBe("1/2in Drive");
  });

  it("normalizes inch punctuation and spelling to 'in'", () => {
    expect(formatToolName('3/8" ratchet')).toBe("3/8in Ratchet");
    expect(formatToolName("1/2 inch drive")).toBe("1/2in Drive");
    expect(formatToolName("1/2 inches drive")).toBe("1/2in Drive");
  });

  it("keeps a dimension-separator x lowercase", () => {
    expect(formatToolName('2" x 4" stock')).toBe("2in x 4in Stock");
  });

  it("strips zero-width and soft-hyphen characters", () => {
    expect(formatToolName("Socket​")).toBe("Socket");
    expect(formatToolName("So­cket")).toBe("Socket");
  });

  it("stays idempotent for the new normalizations", () => {
    for (const sample of ["10 mm socket", '3/8" ratchet', "1/2 inch drive"]) {
      const once = formatToolName(sample);
      expect(formatToolName(once)).toBe(once);
    }
  });
});

describe("canonicalToolKey", () => {
  it("is case- and whitespace-insensitive", () => {
    expect(canonicalToolKey("torque  wrench")).toBe("torque wrench");
    expect(canonicalToolKey("Torque Wrench")).toBe("torque wrench");
    expect(canonicalToolKey("  TORQUE   wrench ")).toBe("torque wrench");
  });

  it("equates whitespace and case variants of the same tool", () => {
    expect(canonicalToolKey("torque  wrench")).toBe(canonicalToolKey("Torque Wrench"));
    expect(canonicalToolKey("10mm   socket")).toBe(canonicalToolKey("10mm Socket"));
  });

  it("normalizes acronym casing", () => {
    expect(canonicalToolKey("HSS")).toBe("hss");
    expect(canonicalToolKey("hss")).toBe("hss");
  });

  it("folds size/unit/punctuation variants to one key", () => {
    expect(canonicalToolKey("10 mm socket")).toBe(canonicalToolKey("10mm Socket"));
    expect(canonicalToolKey('1/2" drive')).toBe(canonicalToolKey("1/2in drive"));
    expect(canonicalToolKey("1/2 inch drive")).toBe(canonicalToolKey("1/2in drive"));
  });

  it("folds hyphen and space variants to one key", () => {
    expect(canonicalToolKey("t-handle")).toBe(canonicalToolKey("t handle"));
    expect(canonicalToolKey("allen-key")).toBe(canonicalToolKey("allen key"));
  });

  it("never merges different sizes", () => {
    expect(canonicalToolKey("10mm socket")).not.toBe(canonicalToolKey("12mm socket"));
    expect(canonicalToolKey("1/2in drive")).not.toBe(canonicalToolKey("3/8in drive"));
  });
});
