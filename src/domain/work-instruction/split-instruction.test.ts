import { describe, it, expect } from "vitest";
import { splitInstruction } from "./split-instruction";

describe("splitInstruction", () => {
  it("keeps a short instruction in one chunk", () => {
    expect(splitInstruction("Torque the four bolts to 45 Nm.", 100, 100)).toEqual([
      "Torque the four bolts to 45 Nm.",
    ]);
  });

  it("returns nothing for empty text", () => {
    expect(splitInstruction("", 100, 100)).toEqual([]);
  });

  it("breaks at a sentence boundary rather than mid-sentence", () => {
    // 22 and 26 characters: each sentence fits alone, the pair (49) does not.
    const text = "Seat the bracket flat. Torque the bolts to 45 Nm.";

    const chunks = splitInstruction(text, 30, 30);

    expect(chunks).toEqual(["Seat the bracket flat.", "Torque the bolts to 45 Nm."]);
  });

  it("packs as many whole sentences into a chunk as fit", () => {
    const text = "One two. Three four. Five six seven eight nine ten.";

    const chunks = splitInstruction(text, 20, 20);

    expect(chunks[0]).toBe("One two. Three four.");
  });

  it("gives the first chunk its own budget", () => {
    const text = "Alpha bravo charlie. Delta echo foxtrot. Golf hotel india.";

    const [first] = splitInstruction(text, 20, 100);

    expect(first).toBe("Alpha bravo charlie.");
  });

  it("falls back to word boundaries when one sentence exceeds the budget", () => {
    const text = "alpha bravo charlie delta echo foxtrot golf hotel india juliet";

    const chunks = splitInstruction(text, 25, 25);

    expect(chunks.length).toBeGreaterThan(1);
    for (const chunk of chunks) {
      expect(chunk.length).toBeLessThanOrEqual(25);
    }
  });

  it("never splits a word in half", () => {
    const text = "alpha bravo charlie delta echo foxtrot golf hotel india juliet kilo lima";
    const words = text.split(" ");

    const chunks = splitInstruction(text, 20, 20);

    for (const chunk of chunks) {
      for (const word of chunk.split(" ")) {
        expect(words).toContain(word);
      }
    }
  });

  it("emits an unsplittable over-long word as its own chunk", () => {
    const word = "x".repeat(50);

    const chunks = splitInstruction(`start ${word} end`, 20, 20);

    expect(chunks).toContain(word);
  });

  it("preserves every word, in order", () => {
    const text =
      "Land the positive and negative leads on the inverter studs. Observe polarity: red to plus, black to minus. " +
      "Torque each nut to 12 Nm. Apply a witness mark across the nut and stud with a paint pen. " +
      "Confirm the mark is unbroken before proceeding.";

    const chunks = splitInstruction(text, 80, 80);

    expect(chunks.join(" ").split(/\s+/)).toEqual(text.split(/\s+/));
  });

  it("does not emit empty or whitespace-only chunks", () => {
    const text = "One.   Two.    Three.     Four.";

    const chunks = splitInstruction(text, 12, 12);

    for (const chunk of chunks) {
      expect(chunk.trim()).not.toBe("");
    }
  });
});
