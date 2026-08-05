import { describe, it, expect } from "vitest";
import { estimateLines } from "./estimate-lines";

const NL = "\n";

describe("estimateLines", () => {
  it("counts a short line as one", () => {
    expect(estimateLines("Torque to 45 Nm.", 58)).toBe(1);
  });

  it("counts nothing for empty text", () => {
    expect(estimateLines("", 58)).toBe(0);
  });

  it("wraps a long line by the character width", () => {
    expect(estimateLines("x".repeat(58), 58)).toBe(1);
    expect(estimateLines("x".repeat(59), 58)).toBe(2);
    expect(estimateLines("x".repeat(174), 58)).toBe(3);
  });

  it("charges a full line for every hard break, including blank ones", () => {
    // This is the whole point: a character count says 6, but pre-wrap renders 3.
    expect(estimateLines(`a${NL}b${NL}c`, 58)).toBe(3);
    expect(estimateLines(`a${NL}${NL}b`, 58)).toBe(3);
  });

  it("sums wrapping across hard lines", () => {
    const text = ["x".repeat(78), "", "x".repeat(28), "", "x".repeat(89)].join(NL);

    // 2 + 1 + 1 + 1 + 2
    expect(estimateLines(text, 58)).toBe(7);
  });

  it("matches what the browser actually rendered for a real step", () => {
    // Measured 2026-08-04 on FlexBoost CLU-SUB-10 step 1: 487 characters over 17
    // hard lines rendered as exactly 20 visual lines at 58 chars per line, in a
    // box that holds 18. The character budget said 487 was comfortably within
    // 880 and let it clip.
    const lengths = [78, 0, 28, 0, 40, 0, 89, 0, 38, 0, 48, 0, 84, 0, 31, 0, 35];
    const text = lengths.map((length) => "x".repeat(length)).join(NL);

    expect(estimateLines(text, 58)).toBe(20);
  });
});
