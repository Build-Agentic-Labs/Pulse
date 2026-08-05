import { describe, it, expect } from "vitest";
import { estimateLines } from "./estimate-lines";
import { splitInstruction } from "./split-instruction";

const NL = "\n";
/** A roomy budget, so a test only exercises what it means to. */
const wide = { lines: 100, charsPerLine: 58 };
const budget = (lines: number, charsPerLine = 58) => ({ lines, charsPerLine });

describe("splitInstruction", () => {
  it("keeps a short instruction in one chunk", () => {
    expect(splitInstruction("Torque the four bolts to 45 Nm.", wide, wide)).toEqual([
      "Torque the four bolts to 45 Nm.",
    ]);
  });

  it("returns nothing for empty text", () => {
    expect(splitInstruction("", wide, wide)).toEqual([]);
  });

  it("preserves the author's hard line breaks inside a chunk", () => {
    // Operators write steps as blank-line-separated sub-actions. Reflowing them
    // into a paragraph would destroy the structure they authored.
    const text = `Split part 35 apart${NL}${NL}Use a flat head to separate${NL}${NL}Apply grease to part 35`;

    expect(splitInstruction(text, wide, wide)).toEqual([text]);
  });

  it("splits on a line budget, not a character count", () => {
    // Six hard lines, tiny character count — a char budget would never split.
    const text = ["a", "b", "c", "d", "e", "f"].join(NL);

    const chunks = splitInstruction(text, budget(3), budget(3));

    expect(chunks).toHaveLength(2);
    expect(chunks[0]).toBe(`a${NL}b${NL}c`);
    expect(chunks[1]).toBe(`d${NL}e${NL}f`);
  });

  it("never returns a chunk taller than its budget", () => {
    const text = Array.from({ length: 40 }, (_, index) => `line ${index}`).join(NL);

    const chunks = splitInstruction(text, budget(5), budget(9));

    expect(estimateLines(chunks[0], 58)).toBeLessThanOrEqual(5);
    for (const chunk of chunks.slice(1)) {
      expect(estimateLines(chunk, 58)).toBeLessThanOrEqual(9);
    }
  });

  it("gives the first chunk its own budget", () => {
    const text = Array.from({ length: 12 }, (_, index) => `line ${index}`).join(NL);

    const [first] = splitInstruction(text, budget(2), budget(100));

    expect(estimateLines(first, 58)).toBe(2);
  });

  it("accounts for wrapping when packing", () => {
    // Each line wraps to 2 visual lines, so only two fit in a 4-line budget.
    const wrapped = "x".repeat(80);
    const text = [wrapped, wrapped, wrapped].join(NL);

    const chunks = splitInstruction(text, budget(4), budget(4));

    expect(chunks).toHaveLength(2);
    expect(estimateLines(chunks[0], 58)).toBe(4);
  });

  it("breaks a single over-tall line at a sentence boundary", () => {
    const text = "Seat the bracket flat. Torque the bolts to 45 Nm. Mark the nut.";

    const chunks = splitInstruction(text, budget(1, 30), budget(1, 30));

    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks[0]).toBe("Seat the bracket flat.");
  });

  it("falls back to word boundaries and never splits a word", () => {
    const words = "alpha bravo charlie delta echo foxtrot golf hotel india juliet".split(" ");

    const chunks = splitInstruction(words.join(" "), budget(1, 25), budget(1, 25));

    for (const chunk of chunks) {
      for (const word of chunk.split(/\s+/)) {
        expect(words).toContain(word);
      }
    }
  });

  it("emits an unsplittable over-wide word as its own chunk", () => {
    const word = "x".repeat(120);

    expect(splitInstruction(`start ${word} end`, budget(1, 20), budget(1, 20))).toContain(word);
  });

  it("preserves every word, in order", () => {
    const text = [
      "Land the positive and negative leads on the inverter studs.",
      "",
      "Observe polarity: red to plus, black to minus.",
      "Torque each nut to 12 Nm.",
    ].join(NL);

    const chunks = splitInstruction(text, budget(2), budget(2));

    expect(chunks.join(" ").split(/\s+/).filter(Boolean)).toEqual(text.split(/\s+/).filter(Boolean));
  });

  it("does not emit empty or whitespace-only chunks", () => {
    const text = `One.${NL}${NL}${NL}Two.${NL}${NL}${NL}Three.`;

    for (const chunk of splitInstruction(text, budget(2), budget(2))) {
      expect(chunk.trim()).not.toBe("");
    }
  });
});
