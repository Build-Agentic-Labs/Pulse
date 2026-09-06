/**
 * Splits a step's instruction text across continuation cards.
 *
 * A work instruction card is a fixed slot on a printed sheet, so long text has
 * to go somewhere. Flagging it and asking the author to split the step by hand
 * pushes document structure onto the person least able to see the page
 * geometry; splitting it here keeps the authored step intact and lets the
 * document paginate itself, the same way prose flows in the SOP print preview.
 *
 * Two rules, both learned from real data:
 *
 * 1. The budget is in VISUAL LINES, not characters — see `estimate-lines.ts`.
 *    A character budget silently clipped a 487-character step that happened to
 *    be 17 hard lines.
 * 2. Hard line breaks are PRESERVED. Operators author steps as blank-line
 *    separated sub-actions; reflowing them into a paragraph to save space
 *    destroys the structure they wrote and makes the card harder to work from.
 *    Only a single line too tall to fit on its own is broken further, at a
 *    sentence boundary where possible and a word boundary where not.
 *
 * A token wider than the card survives as its own chunk — the renderer marks
 * that card overflowing, which is the one case a human has to resolve.
 */

import { instructionBlocks } from "../instruction-bullets";
import { estimateLines, NEWLINE } from "./estimate-lines";

/** What one card's text box can hold. Both figures are measured in the browser. */
export interface CardTextBudget {
  /** Visual lines the box holds. */
  lines: number;
  /** Characters that fit on one visual line. */
  charsPerLine: number;
}

/** Sentence-ending punctuation followed by whitespace. */
const SENTENCE_BREAK = /(?<=[.!?:;])\s+/;

/** Greedily pack pieces into chunks, never exceeding the budget for that chunk's position. */
function pack(pieces: string[], joiner: string, budgetAt: (index: number) => CardTextBudget): string[] {
  return pieces.reduce<string[]>((chunks, piece) => {
    if (chunks.length === 0) {
      return [piece];
    }
    const index = chunks.length - 1;
    const { lines, charsPerLine } = budgetAt(index);
    const merged = `${chunks[index]}${joiner}${piece}`;

    if (estimateLines(merged, charsPerLine) <= lines) {
      return [...chunks.slice(0, -1), merged];
    }
    return [...chunks, piece];
  }, []);
}

/** Break one over-tall line down: sentences first, then words, then give up. */
function breakLine(line: string, budgetAt: (index: number) => CardTextBudget, structured = true): string[] {
  const block = instructionBlocks(line)[0];
  if (structured && block && block.kind !== "text") {
    // Repeat the item identity when even a whole continuation card cannot hold it.
    const bodyBudget = (index: number) => {
      const budget = budgetAt(index);
      return {lines: Math.max(1, budget.lines - 1), charsPerLine: Math.max(1, budget.charsPerLine - (block.marker?.length ?? 1) - 14)};
    };
    return breakLine(block.body, bodyBudget, false).map((body,index) =>
      `${block.marker} ${index ? "(continued) " : ""}${body}`,
    );
  }
  const sentences = line.split(SENTENCE_BREAK).filter((part) => part.trim() !== "");
  const packedSentences = pack(sentences, " ", budgetAt);

  return packedSentences.flatMap((chunk, index) => {
    const { lines, charsPerLine } = budgetAt(index);
    if (estimateLines(chunk, charsPerLine) <= lines) {
      return [chunk];
    }
    return pack(chunk.split(/\s+/).filter(Boolean), " ", budgetAt);
  });
}

export function splitInstruction(text: string, first: CardTextBudget, rest: CardTextBudget): string[] {
  const trimmed = text.trim();
  if (!trimmed) {
    return [];
  }

  const budgetAt = (index: number) => (index === 0 ? first : rest);
  if (estimateLines(trimmed, first.charsPerLine) <= first.lines) {
    return [trimmed];
  }

  // Hard lines are the unit of packing, so they survive into the output joined
  // by the same newline the author typed.
  const lines = instructionBlocks(trimmed).map(block => block.raw);
  const pieces = lines.flatMap((line, index) => {
    const { lines: budgetLines, charsPerLine } = budgetAt(index === 0 ? 0 : 1);
    return estimateLines(line, charsPerLine) <= budgetLines ? [line] : breakLine(line, budgetAt);
  });

  return pack(pieces, NEWLINE, budgetAt)
    .map((chunk) => chunk.replace(/^\s+|\s+$/g, ""))
    .filter((chunk) => chunk !== "");
}
