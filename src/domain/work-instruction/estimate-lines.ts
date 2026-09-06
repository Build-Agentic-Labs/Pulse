import { instructionBlocks } from "../instruction-bullets";
/**
 * How many visual lines a block of instruction text will occupy in a card.
 *
 * A card is a fixed-height box, so what has to fit is LINES, not characters.
 * The two are only interchangeable for text that flows: `.wi-card-instruction`
 * is `white-space: pre-wrap`, so every hard line break in the authored step —
 * including the blank lines people use to separate sub-actions — costs a full
 * line no matter how few characters sit on it.
 *
 * This was found the hard way (2026-08-04) on FlexBoost CLU-SUB-10: a 487-
 * character step passed a 880-character budget and was silently clipped,
 * because those 487 characters were 17 hard lines that rendered as 20 visual
 * lines into a box that holds 18.
 *
 * Deliberately an estimate, not a measurement: the domain layer stays pure, so
 * it models wrapping arithmetically from a `charsPerLine` figure measured once
 * in the browser per card shape. Validated against the real render — see the
 * test — and it agrees exactly there. It will drift for text that is unusually
 * wide- or narrow-charactered, which is what the safety margin on each budget
 * is for.
 */

/** Newline as a code unit, so the literal cannot be mangled by tooling. */
const NEWLINE = String.fromCharCode(10);

export function estimateLines(text: string, charsPerLine: number): number {
  if (!text) return 0;
  const width = Math.max(1, charsPerLine);
  return Math.ceil(instructionBlocks(text).reduce((total, block) => {
    if (block.kind === "text") return total + Math.max(1, Math.ceil(block.body.length / width));
    const bodyWidth = Math.max(1, width - (block.marker?.length ?? 1) - 2);
    return total + block.body.split("\n").reduce((lines, line) => lines + Math.max(1,Math.ceil(line.length / bodyWidth)),0) + 0.2;
  },0));
}

export { NEWLINE };
