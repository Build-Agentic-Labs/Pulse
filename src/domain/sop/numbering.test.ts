import { describe, it, expect } from "vitest";
import { formatSopNumber, parseSopNumber } from "./numbering";

describe("SOP numbering", () => {
  it("formats DEPT-TYPE-NNN with zero padding", () => {
    expect(formatSopNumber("qa", "sop", 14)).toBe("QA-SOP-014");
    expect(formatSopNumber("ENG", "WI", 7)).toBe("ENG-WI-007");
    expect(formatSopNumber("QA", "SOP", 1234)).toBe("QA-SOP-1234");
  });

  it("parses a valid number", () => {
    expect(parseSopNumber("QA-SOP-014")).toEqual({ dept: "QA", type: "SOP", seq: 14 });
    expect(parseSopNumber("eng-wi-007")).toEqual({ dept: "ENG", type: "WI", seq: 7 });
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
