import { describe, it, expect } from "vitest";
import { formatSopNumber, parseSopNumber } from "./numbering";

describe("SOP numbering", () => {
  it("formats TYPE-DEPT-NNN with zero padding", () => {
    expect(formatSopNumber("qas", "sop", 14)).toBe("SOP-QAS-014");
    expect(formatSopNumber("MFG", "WI", 7)).toBe("WI-MFG-007");
    expect(formatSopNumber("QAS", "SOP", 1234)).toBe("SOP-QAS-1234");
  });

  it("parses a valid number", () => {
    expect(parseSopNumber("SOP-QAS-014")).toEqual({ dept: "QAS", type: "SOP", seq: 14 });
    expect(parseSopNumber("wi-mfg-007")).toEqual({ dept: "MFG", type: "WI", seq: 7 });
  });

  it("returns null for non-matching strings", () => {
    expect(parseSopNumber("SOP-QA-legacy")).toBeNull();
    expect(parseSopNumber("random text")).toBeNull();
    expect(parseSopNumber("")).toBeNull();
  });

  it("round-trips format → parse", () => {
    const parsed = parseSopNumber(formatSopNumber("MEC", "FRM", 42));
    expect(parsed).toEqual({ dept: "MEC", type: "FRM", seq: 42 });
  });
});
